-- The owner can be assigned to jobs as crew (owner decision 2026-11-24: salaried owner works jobs; labor cost $0).
-- Run after 20261127000000_crew_app.sql. Safe to run again. Identical to the original dispatch save
-- (20261114230000, moved to app_private.save_dispatch_job_v1 in 20261125030000) except that 'owner' is accepted as crew.
BEGIN;
CREATE OR REPLACE FUNCTION app_private.save_dispatch_job_v1(target_company uuid,payload jsonb)
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
 IF NOT EXISTS(SELECT 1 FROM public.company_members WHERE company_id=target_company AND user_id=person AND active AND role IN ('mover','crew_leader','owner')) THEN RAISE EXCEPTION 'Select active crew (movers, crew leaders or the owner) from this company'; END IF;
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
REVOKE ALL ON FUNCTION app_private.save_dispatch_job_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Owner can be crew' AS result;
