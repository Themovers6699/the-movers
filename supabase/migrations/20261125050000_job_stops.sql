-- Phase 1B: job stops, arrival windows, service type, truck needed. Run after 20261125040000. Safe to run again.
--  * job_stops: 2-5 ordered stops per job (first = pick-up, last = drop-off), each with location type, bedrooms,
--    floor, unit and access notes. Existing jobs get 2 stops from their pick-up/drop-off addresses.
--  * jobs.pick_up_address / drop_off_address stay = first / last stop (calendar, lists, crew view, search keep working)
--  * jobs.arrival_window_end (window start is the existing arrival_time), service_type, truck_needed
--  * save_estimate / save_dispatch_job wrappers now also apply these (originals in app_private.*_v1 unchanged)
BEGIN;

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS arrival_window_end time;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS service_type text NOT NULL DEFAULT 'full_move';
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS truck_needed boolean NOT NULL DEFAULT true;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='jobs_service_type_valid' AND conrelid='public.jobs'::regclass) THEN
  ALTER TABLE public.jobs ADD CONSTRAINT jobs_service_type_valid CHECK (service_type IN ('full_move','load_only','unload_only','pack_only','same_complex'));
 END IF;

END $$;

CREATE TABLE IF NOT EXISTS public.job_stops (
 company_id uuid NOT NULL,
 job_id uuid NOT NULL,
 position smallint NOT NULL CHECK (position BETWEEN 1 AND 5),
 kind text NOT NULL CHECK (kind IN ('pickup','dropoff')),
 address text NOT NULL CHECK (length(btrim(address)) BETWEEN 1 AND 300),
 location_type text CHECK (location_type IN ('house','townhouse','apartment','high_rise','storage','office','warehouse','retail','other')),
 bedrooms smallint CHECK (bedrooms BETWEEN 0 AND 10),
 floor smallint CHECK (floor BETWEEN -5 AND 200),
 unit text CHECK (length(unit)<=40),
 access_notes text CHECK (length(access_notes)<=1000),
 PRIMARY KEY (company_id,job_id,position),
 FOREIGN KEY (company_id,job_id) REFERENCES public.jobs(company_id,id)
);
CREATE INDEX IF NOT EXISTS job_stops_address_idx ON public.job_stops(company_id,job_id);
ALTER TABLE public.job_stops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_stops FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.job_stops TO authenticated;
GRANT ALL ON public.job_stops TO service_role;
DROP POLICY IF EXISTS job_stops_read ON public.job_stops;
-- Office sees all; crew see the stops of jobs assigned to them (needed for move day).
CREATE POLICY job_stops_read ON public.job_stops FOR SELECT TO authenticated USING (app_private.can_view_job(company_id,job_id));
DROP TRIGGER IF EXISTS audit_row ON public.job_stops;
CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON public.job_stops FOR EACH ROW EXECUTE FUNCTION app_private.audit_row();

-- Existing jobs: two stops from their current addresses (only jobs without stops yet).
INSERT INTO public.job_stops(company_id,job_id,position,kind,address)
SELECT j.company_id,j.id,1,'pickup',btrim(j.pick_up_address) FROM public.jobs j
 WHERE length(btrim(j.pick_up_address))>0 AND NOT EXISTS(SELECT 1 FROM public.job_stops s WHERE s.company_id=j.company_id AND s.job_id=j.id);
INSERT INTO public.job_stops(company_id,job_id,position,kind,address)
SELECT j.company_id,j.id,2,'dropoff',btrim(j.drop_off_address) FROM public.jobs j
 WHERE length(btrim(j.drop_off_address))>0 AND NOT EXISTS(SELECT 1 FROM public.job_stops s WHERE s.company_id=j.company_id AND s.job_id=j.id AND s.position=2);

-- Normalised stop list as JSON (same shape for the incoming payload and the stored rows, so they can be compared).
CREATE OR REPLACE FUNCTION app_private.stored_stops(target_company uuid, job uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('position',position,'kind',kind,'address',address,'location_type',location_type,
  'bedrooms',bedrooms,'floor',floor,'unit',unit,'access_notes',access_notes) ORDER BY position),'[]'::jsonb)
 FROM public.job_stops WHERE company_id=target_company AND job_id=job;
$$;
REVOKE ALL ON FUNCTION app_private.stored_stops(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION app_private.apply_job_details(target_company uuid, job uuid, payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer; newset jsonb; st jsonb; svc text; tn boolean; wend time; astart time; k integer;
BEGIN
 IF payload ? 'stops' THEN
  IF jsonb_typeof(payload->'stops')<>'array' THEN RAISE EXCEPTION 'Invalid stops'; END IF;
  n := jsonb_array_length(payload->'stops');
  IF n<2 OR n>5 THEN RAISE EXCEPTION 'A job needs 2 to 5 addresses'; END IF;
  SELECT jsonb_agg(jsonb_build_object('position',ord,'kind',e->>'kind','address',btrim(coalesce(e->>'address','')),
    'location_type',nullif(e->>'location_type',''),'bedrooms',nullif(e->>'bedrooms','')::smallint,'floor',nullif(e->>'floor','')::smallint,
    'unit',nullif(btrim(coalesce(e->>'unit','')),''),'access_notes',nullif(btrim(coalesce(e->>'access_notes','')),'')) ORDER BY ord)
   INTO newset FROM jsonb_array_elements(payload->'stops') WITH ORDINALITY x(e,ord);
  k := 0;
  FOR st IN SELECT * FROM jsonb_array_elements(newset) LOOP
   k := k+1;
   IF st->>'kind' NOT IN ('pickup','dropoff') THEN RAISE EXCEPTION 'Stop %: choose pick-up or drop-off', k; END IF;
   IF length(st->>'address') NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'Stop %: enter the address', k; END IF;
   IF st->>'location_type' IS NOT NULL AND st->>'location_type' NOT IN ('house','townhouse','apartment','high_rise','storage','office','warehouse','retail','other') THEN RAISE EXCEPTION 'Stop %: unknown location type', k; END IF;
   IF (st->>'bedrooms')::int NOT BETWEEN 0 AND 10 THEN RAISE EXCEPTION 'Stop %: bedrooms must be Studio to 10', k; END IF;
   IF (st->>'floor')::int NOT BETWEEN -5 AND 200 THEN RAISE EXCEPTION 'Stop %: floor must be between -5 and 200', k; END IF;
   IF length(st->>'unit')>40 OR length(st->>'access_notes')>1000 THEN RAISE EXCEPTION 'Stop %: unit or notes too long', k; END IF;
  END LOOP;
  IF newset->0->>'kind'<>'pickup' THEN RAISE EXCEPTION 'The first address must be a pick-up'; END IF;
  IF newset->(n-1)->>'kind'<>'dropoff' THEN RAISE EXCEPTION 'The last address must be a drop-off'; END IF;
  IF app_private.stored_stops(target_company,job) IS DISTINCT FROM newset THEN -- only touch (and audit) real changes
   DELETE FROM public.job_stops WHERE company_id=target_company AND job_id=job;
   INSERT INTO public.job_stops(company_id,job_id,position,kind,address,location_type,bedrooms,floor,unit,access_notes)
   SELECT target_company,job,(e->>'position')::smallint,e->>'kind',e->>'address',e->>'location_type',(e->>'bedrooms')::smallint,(e->>'floor')::smallint,e->>'unit',e->>'access_notes'
   FROM jsonb_array_elements(newset) e;
  END IF;
  UPDATE public.jobs SET pick_up_address=newset->0->>'address', drop_off_address=newset->(n-1)->>'address'
   WHERE company_id=target_company AND id=job AND (pick_up_address IS DISTINCT FROM newset->0->>'address' OR drop_off_address IS DISTINCT FROM newset->(n-1)->>'address');
 END IF;
 IF payload ? 'service_type' THEN
  svc := coalesce(nullif(payload->>'service_type',''),'full_move');
  IF svc NOT IN ('full_move','load_only','unload_only','pack_only','same_complex') THEN RAISE EXCEPTION 'Unknown service type'; END IF;
  UPDATE public.jobs SET service_type=svc WHERE company_id=target_company AND id=job AND service_type IS DISTINCT FROM svc;
 END IF;
 IF payload ? 'truck_needed' THEN
  tn := coalesce((payload->>'truck_needed')::boolean,true);
  UPDATE public.jobs SET truck_needed=tn WHERE company_id=target_company AND id=job AND truck_needed IS DISTINCT FROM tn;
 END IF;
 IF payload ? 'arrival_window_end' THEN
  wend := nullif(payload->>'arrival_window_end','')::time;
  SELECT arrival_time INTO astart FROM public.jobs WHERE company_id=target_company AND id=job;
  IF wend IS NOT NULL AND (astart IS NULL OR wend<=astart) THEN RAISE EXCEPTION 'The arrival window must end after it starts'; END IF;
  UPDATE public.jobs SET arrival_window_end=wend WHERE company_id=target_company AND id=job AND arrival_window_end IS DISTINCT FROM wend;
 END IF;
 -- Checked last, on the final state of this save (the truck may have been assigned/unassigned above).
 IF EXISTS(SELECT 1 FROM public.jobs WHERE company_id=target_company AND id=job AND NOT truck_needed AND truck_id IS NOT NULL) THEN
  RAISE EXCEPTION 'This job is marked "no truck needed", so it cannot have a truck assigned. Unassign the truck or mark a truck as needed.';
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION app_private.apply_job_details(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_estimate(target_company uuid, payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j uuid;
BEGIN
 j := app_private.save_estimate_v1(target_company, payload);
 PERFORM app_private.apply_job_details(target_company, j, payload);
 PERFORM app_private.apply_customer_fields(target_company, j, payload);
 RETURN j;
END;
$$;
CREATE OR REPLACE FUNCTION public.save_dispatch_job(target_company uuid, payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j uuid;
BEGIN
 j := app_private.save_dispatch_job_v1(target_company, payload);
 PERFORM app_private.apply_job_details(target_company, j, payload);
 PERFORM app_private.apply_customer_fields(target_company, j, payload);
 RETURN j;
END;
$$;
REVOKE ALL ON FUNCTION public.save_estimate(uuid,jsonb), public.save_dispatch_job(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_estimate(uuid,jsonb), public.save_dispatch_job(uuid,jsonb) TO authenticated;

-- Customer search now also matches any stop address (same as 20261125030000 otherwise).
CREATE OR REPLACE FUNCTION public.search_customers(target_company uuid, query text DEFAULT '', max_rows integer DEFAULT 200)
RETURNS TABLE(id uuid, name text, first_name text, last_name text, email text, phone text, phone2 text, referral_source text,
 tags text[], office_notes text, job_count bigint, last_move_date date, total_matches bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE q text; pat text; digits text;
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 q := btrim(coalesce(query,''));
 pat := '%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%';
 digits := regexp_replace(q,'[^0-9]','','g');
 IF length(digits)=11 AND left(digits,1)='1' THEN digits := substring(digits from 2); END IF;
 RETURN QUERY
 SELECT c.id,c.name,c.first_name,c.last_name,c.email,c.phone,c.phone2,c.referral_source,c.tags,c.office_notes,
  (SELECT count(*) FROM public.jobs j WHERE j.company_id=c.company_id AND j.customer_id=c.id),
  (SELECT max(j.move_date) FROM public.jobs j WHERE j.company_id=c.company_id AND j.customer_id=c.id AND j.status<>'cancelled'),
  count(*) OVER ()
 FROM public.customers c
 WHERE c.company_id=target_company AND (
  q='' OR c.name ILIKE pat OR c.email ILIKE pat
  OR (length(digits)>=3 AND (regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') LIKE '%'||digits||'%' OR regexp_replace(coalesce(c.phone2,''),'[^0-9]','','g') LIKE '%'||digits||'%'))
  OR EXISTS(SELECT 1 FROM public.jobs j WHERE j.company_id=c.company_id AND j.customer_id=c.id AND (j.pick_up_address ILIKE pat OR j.drop_off_address ILIKE pat))
  OR EXISTS(SELECT 1 FROM public.job_stops s JOIN public.jobs j ON j.company_id=s.company_id AND j.id=s.job_id
            WHERE j.company_id=c.company_id AND j.customer_id=c.id AND s.address ILIKE pat))
 ORDER BY c.last_name NULLS LAST, c.first_name, c.id
 LIMIT greatest(1,least(coalesce(max_rows,200),500));
END;
$$;
REVOKE ALL ON FUNCTION public.search_customers(uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.search_customers(uuid,text,integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Job stops ready' AS result;
