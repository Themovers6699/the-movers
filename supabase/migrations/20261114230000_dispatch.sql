-- Run after 02_estimates.sql. Keeps existing records and RLS enabled.
BEGIN;
CREATE TABLE IF NOT EXISTS public.trucks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),active boolean NOT NULL DEFAULT true,
 UNIQUE(company_id,id),UNIQUE(company_id,name)
);
ALTER TABLE public.trucks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trucks FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.trucks TO authenticated;
GRANT ALL ON public.trucks TO service_role;
DROP POLICY IF EXISTS trucks_office ON public.trucks;
CREATE POLICY trucks_office ON public.trucks FOR ALL TO authenticated USING(app_private.is_office(company_id)) WITH CHECK(app_private.is_office(company_id));
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS truck_id uuid;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS scheduled_minutes integer NOT NULL DEFAULT 120 CHECK(scheduled_minutes BETWEEN 15 AND 10080);
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 0;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='jobs_truck_tenant_fk' AND conrelid='public.jobs'::regclass) THEN ALTER TABLE public.jobs ADD CONSTRAINT jobs_truck_tenant_fk FOREIGN KEY(company_id,truck_id) REFERENCES public.trucks(company_id,id); END IF; END $$;
CREATE OR REPLACE FUNCTION app_private.bump_job_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.row_version:=OLD.row_version+1;RETURN NEW;END; $$;
DROP TRIGGER IF EXISTS job_version ON public.jobs;
CREATE TRIGGER job_version BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION app_private.bump_job_version();
REVOKE ALL ON FUNCTION app_private.bump_job_version() FROM PUBLIC,anon,authenticated;
INSERT INTO public.trucks(company_id,name) SELECT id,'Truck 1' FROM public.companies WHERE slug='the-movers' ON CONFLICT(company_id,name) DO NOTHING;
INSERT INTO public.trucks(company_id,name) SELECT id,'Truck 2' FROM public.companies WHERE slug='the-movers' ON CONFLICT(company_id,name) DO NOTHING;
CREATE OR REPLACE FUNCTION app_private.write_job_quote(target_company uuid, payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j uuid; c uuid; r public.crew_rates%ROWTYPE; s public.company_settings%ROWTYPE;
 crew integer; mins integer; billed integer; miles numeric; rate bigint; service bigint;
 total bigint; deposit bigint; flat bigint; d date; model text; outtown boolean; old_status text;
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 IF length(btrim(coalesce(payload->>'customer_name',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Customer name is required (maximum 200 characters)'; END IF;
 IF length(btrim(coalesce(payload->>'pick_up_address','')))=0 OR length(btrim(coalesce(payload->>'drop_off_address','')))=0 THEN RAISE EXCEPTION 'Both addresses are required'; END IF;
 j:=nullif(payload->>'id','')::uuid;
 IF j IS NOT NULL THEN
 SELECT customer_id,status INTO c,old_status FROM public.jobs WHERE company_id=target_company AND id=j FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Estimate not found'; END IF;
 IF old_status NOT IN ('estimate','booked') THEN RAISE EXCEPTION 'Only estimates and booked jobs can be edited here'; END IF;
 END IF;
 SELECT * INTO STRICT s FROM public.company_settings WHERE company_id=target_company;
 crew:=(payload->>'crew_size')::integer;
 SELECT * INTO STRICT r FROM public.crew_rates WHERE company_id=target_company AND crew_size=crew;
 d:=(payload->>'move_date')::date; IF d IS NULL THEN RAISE EXCEPTION 'Move date required'; END IF;
 model:=payload->>'pricing_model'; outtown:=coalesce((payload->>'out_of_town')::boolean,false);
 IF model IS NULL OR model NOT IN ('hourly','flat') OR (outtown AND model<>'flat') THEN RAISE EXCEPTION 'Out-of-town moves require a flat rate'; END IF;
 IF model='hourly' THEN
 mins:=(payload->>'estimated_minutes')::integer;
 miles:=(payload->>'round_trip_miles')::numeric;
 IF mins IS NULL OR mins<1 OR mins>10080 OR miles IS NULL OR miles<0 OR miles>100000 THEN RAISE EXCEPTION 'Enter valid estimated time and round-trip miles'; END IF;
 miles:=round(miles,2);
 billed:=greatest(s.minimum_minutes,ceil(mins::numeric/s.billing_increment_minutes)::integer*s.billing_increment_minutes);
 rate:=CASE WHEN extract(isodow FROM d) IN (6,7) THEN r.weekend_rate_cents ELSE r.weekday_rate_cents END;
 service:=ceil((r.service_base_cents+miles*r.service_cents_per_mile)/r.round_service_up_to_cents)*r.round_service_up_to_cents;
 total:=round(rate*billed::numeric/60)+service;
 ELSE
 flat:=(payload->>'flat_rate_cents')::bigint;
 IF flat IS NULL OR flat<=0 OR flat>100000000 THEN RAISE EXCEPTION 'Enter a positive flat rate'; END IF;
 total:=flat; service:=0;
 END IF;
 deposit:=CASE WHEN outtown THEN round(total*s.out_of_town_deposit_percent/100) ELSE s.standard_deposit_cents END;
 IF j IS NULL AND nullif(payload->>'customer_id','') IS NOT NULL THEN
 c:=(payload->>'customer_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=c AND company_id=target_company) THEN RAISE EXCEPTION 'Customer not found in this company'; END IF;
 END IF;
 IF c IS NULL THEN
 INSERT INTO public.customers(company_id,name,email,phone) VALUES(target_company,btrim(payload->>'customer_name'),nullif(btrim(payload->>'email'),''),nullif(btrim(payload->>'phone'),'')) RETURNING id INTO c;
 ELSE
 UPDATE public.customers SET name=btrim(payload->>'customer_name'),email=nullif(btrim(payload->>'email'),''),phone=nullif(btrim(payload->>'phone'),'') WHERE company_id=target_company AND id=c;
 END IF;
 IF j IS NULL THEN
 INSERT INTO public.jobs(company_id,customer_id,customer_name,move_date,pick_up_address,drop_off_address,move_type,crew_size,pricing_model,hourly_rate_cents,flat_rate_cents,service_charge_cents,quoted_total_cents,deposit_required_cents,minimum_minutes,billing_increment_minutes)
 VALUES(target_company,c,btrim(payload->>'customer_name'),d,btrim(payload->>'pick_up_address'),btrim(payload->>'drop_off_address'),payload->>'move_type',crew,model,rate,flat,service,total,deposit,s.minimum_minutes,s.billing_increment_minutes) RETURNING id INTO j;
 END IF;
 UPDATE public.jobs SET customer_id=c,customer_name=btrim(payload->>'customer_name'),move_date=d,arrival_time=nullif(payload->>'arrival_time','')::time,pick_up_address=btrim(payload->>'pick_up_address'),drop_off_address=btrim(payload->>'drop_off_address'),move_type=payload->>'move_type',access_instructions=coalesce(payload->>'access_instructions',''),crew_size=crew,pricing_model=model,hourly_rate_cents=rate,flat_rate_cents=flat,service_charge_cents=service,quoted_total_cents=total,deposit_required_cents=deposit,minimum_minutes=s.minimum_minutes,billing_increment_minutes=s.billing_increment_minutes,estimated_minutes=mins,round_trip_miles=miles,out_of_town=outtown WHERE company_id=target_company AND id=j;
 RETURN j;
END;
$$;
REVOKE ALL ON FUNCTION app_private.write_job_quote(uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_dispatch_job(target_company uuid,payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.jobs%ROWTYPE;j uuid;t uuid;mins integer;person uuid;ids uuid[];start_at timestamp;end_at timestamp;label text;
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 -- Serialize resource changes per company; stale edits are rejected below.
 PERFORM pg_advisory_xact_lock(hashtextextended(target_company::text,0));
 j:=(payload->>'id')::uuid;
 SELECT * INTO old FROM public.jobs WHERE company_id=target_company AND id=j FOR UPDATE;
 IF NOT FOUND OR old.status<>'booked' THEN RAISE EXCEPTION 'Only booked jobs can be edited'; END IF;
 IF (payload->>'row_version')::integer IS DISTINCT FROM old.row_version THEN RAISE EXCEPTION 'This job changed in another window. Close it and reopen before editing.'; END IF;
 t:=nullif(payload->>'truck_id','')::uuid;mins:=(payload->>'scheduled_minutes')::integer;
 IF mins IS NULL OR mins<15 OR mins>10080 THEN RAISE EXCEPTION 'Scheduled duration must be between 0.25 and 168 hours'; END IF;
 SELECT coalesce(array_agg(DISTINCT x::uuid),ARRAY[]::uuid[]) INTO ids FROM jsonb_array_elements_text(coalesce(payload->'crew_ids','[]'::jsonb)) AS x;
 IF cardinality(ids)>(payload->>'crew_size')::integer THEN RAISE EXCEPTION 'Assigned movers exceed the quoted crew size'; END IF;
 IF t IS NOT NULL THEN
 SELECT name INTO label FROM public.trucks WHERE company_id=target_company AND id=t AND active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Select an active truck from this company'; END IF;
 END IF;
 FOREACH person IN ARRAY ids LOOP
 IF NOT EXISTS(SELECT 1 FROM public.company_members WHERE company_id=target_company AND user_id=person AND active AND role IN ('mover','crew_leader')) THEN RAISE EXCEPTION 'Select active crew from this company'; END IF;
 END LOOP;
 IF (t IS NOT NULL OR cardinality(ids)>0) AND nullif(payload->>'arrival_time','') IS NULL THEN RAISE EXCEPTION 'Set an arrival time before assigning a truck or crew'; END IF;
 start_at:=(payload->>'move_date')::date+nullif(payload->>'arrival_time','')::time;
 end_at:=start_at+make_interval(mins=>mins);
 IF EXISTS(SELECT 1 FROM public.jobs other WHERE other.company_id=target_company AND other.id<>j AND other.status IN ('booked','in_progress') AND other.arrival_time IS NOT NULL
 AND other.move_date+other.arrival_time<end_at AND other.move_date+other.arrival_time+make_interval(mins=>other.scheduled_minutes)>start_at
 AND ((t IS NOT NULL AND other.truck_id=t) OR EXISTS(SELECT 1 FROM public.job_assignments a WHERE a.company_id=target_company AND a.job_id=other.id AND a.user_id=ANY(ids)))) THEN RAISE EXCEPTION 'Scheduling conflict: a selected truck or mover is already assigned during this time. Change the time or resources.'; END IF;
 PERFORM app_private.write_job_quote(target_company,payload);
 UPDATE public.jobs SET truck_id=t,truck_label=label,scheduled_minutes=mins WHERE company_id=target_company AND id=j;
 DELETE FROM public.job_assignments WHERE company_id=target_company AND job_id=j;
 INSERT INTO public.job_assignments(company_id,job_id,user_id,crew_display_name) SELECT target_company,j,m.user_id,m.display_name FROM public.company_members m WHERE m.company_id=target_company AND m.user_id=ANY(ids);
 RETURN j;
END; $$;
REVOKE ALL ON FUNCTION public.save_dispatch_job(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_dispatch_job(uuid,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.cancel_dispatch_job(target_company uuid,target_job uuid,expected_version integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_company::text,0));
 UPDATE public.jobs SET status='cancelled' WHERE company_id=target_company AND id=target_job AND status='booked' AND row_version=expected_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'Job changed or is no longer booked. Reopen it and try again.'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.cancel_dispatch_job(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_dispatch_job(uuid,uuid,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT 'Dispatch update ready' AS result;
