-- One-address jobs (owner request 2026-11-25): load-only (pick-up), unload-only (drop-off) and pack-only jobs may have
-- a single address; full moves and same-complex jobs still need a pick-up and a drop-off. Run after 20261125060000.
-- Safe to run again. Same function as 20261125050000 apart from the address-count rules. With one address,
-- jobs.pick_up_address and drop_off_address both hold it.
BEGIN;
CREATE OR REPLACE FUNCTION app_private.apply_job_details(target_company uuid, job uuid, payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer; newset jsonb; st jsonb; svc text; tn boolean; wend time; astart time; k integer; min_n integer;
BEGIN
 -- Service type of this save (falls back to the job's current one): load/unload/pack-only jobs may have one address.
 svc := coalesce(nullif(payload->>'service_type',''),(SELECT service_type FROM public.jobs WHERE company_id=target_company AND id=job),'full_move');
 min_n := CASE WHEN svc IN ('load_only','unload_only','pack_only') THEN 1 ELSE 2 END;
 IF payload ? 'stops' THEN
  IF jsonb_typeof(payload->'stops')<>'array' THEN RAISE EXCEPTION 'Invalid stops'; END IF;
  n := jsonb_array_length(payload->'stops');
  IF n<min_n OR n>5 THEN RAISE EXCEPTION '%', CASE WHEN min_n=1 THEN 'This job needs 1 to 5 addresses' ELSE 'A full move or same-complex job needs 2 to 5 addresses (a pick-up and a drop-off)' END; END IF;
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
  IF n=1 THEN
   IF svc='load_only' AND newset->0->>'kind'<>'pickup' THEN RAISE EXCEPTION 'A load-only job''s address must be a pick-up'; END IF;
   IF svc='unload_only' AND newset->0->>'kind'<>'dropoff' THEN RAISE EXCEPTION 'An unload-only job''s address must be a drop-off'; END IF;
  ELSE
   IF newset->0->>'kind'<>'pickup' THEN RAISE EXCEPTION 'The first address must be a pick-up'; END IF;
   IF newset->(n-1)->>'kind'<>'dropoff' THEN RAISE EXCEPTION 'The last address must be a drop-off'; END IF;
  END IF;
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
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'One-address jobs ready' AS result;
