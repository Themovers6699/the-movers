-- Crew visibility window, unlimited crew, drag-and-drop rescheduling (owner requests 2026-11-27).
-- Run after 20261127010000_owner_on_crew.sql. Safe to run again; keeps all data.
--  * Crew see an assigned job from N days before its move date (company_settings.crew_visibility_days, default 3 =
--    72 hours). In-progress, completed and cancelled jobs stay visible. Enforced in can_view_job(), so it covers the
--    crew screens, stops, notes, photos and assignments alike. Office sees everything as before.
--  * No upper limit on assigned crew (the price stays based on the quoted crew size).
--  * reschedule_job(): move a booked job to another day (dispatch calendar drag-and-drop) with the same truck/crew
--    conflict check as the job editor; weekday/weekend hourly rate re-applied; totals and deposit recomputed.
BEGIN;
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS crew_visibility_days integer NOT NULL DEFAULT 3;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='crew_visibility_days_range' AND conrelid='public.company_settings'::regclass) THEN
  ALTER TABLE public.company_settings ADD CONSTRAINT crew_visibility_days_range CHECK (crew_visibility_days BETWEEN 0 AND 60);
 END IF;
END $$;

CREATE OR REPLACE FUNCTION app_private.can_view_job(c uuid,j uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT app_private.is_office(c) OR (
  app_private.is_member(c)
  AND EXISTS(SELECT 1 FROM public.job_assignments a WHERE a.company_id=c AND a.job_id=j AND a.user_id=(SELECT auth.uid()))
  AND EXISTS(SELECT 1 FROM public.jobs x WHERE x.company_id=c AND x.id=j AND (x.status IN ('in_progress','completed','cancelled')
     OR x.move_date <= app_private.company_today(c) + coalesce((SELECT s.crew_visibility_days FROM public.company_settings s WHERE s.company_id=c),3)))
 );
$$;

-- Same as 20261127010000 without the crew-size cap.
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
 -- No upper limit on crew (owner decision 2026-11-27): extra people can be sent; the price stays on the quoted crew size.
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

CREATE OR REPLACE FUNCTION public.reschedule_job(target_company uuid, target_job uuid, new_date date, expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j public.jobs%ROWTYPE; after public.jobs%ROWTYPE; r public.crew_rates%ROWTYPE; ids uuid[]; start_at timestamp; end_at timestamp;
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_company::text,0));
 SELECT * INTO j FROM public.jobs WHERE company_id=target_company AND id=target_job FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
 IF j.status<>'booked' THEN RAISE EXCEPTION 'Only booked jobs can be moved (this one is %)', replace(j.status,'_',' '); END IF;
 IF expected_version IS DISTINCT FROM j.row_version THEN RAISE EXCEPTION 'This job changed in another window. Refresh the calendar and try again.'; END IF;
 IF new_date IS NULL THEN RAISE EXCEPTION 'Choose a date'; END IF;
 IF new_date=j.move_date THEN RETURN jsonb_build_object('changed',false); END IF;
 SELECT coalesce(array_agg(user_id),ARRAY[]::uuid[]) INTO ids FROM public.job_assignments WHERE company_id=target_company AND job_id=target_job;
 IF j.arrival_time IS NOT NULL AND (j.truck_id IS NOT NULL OR cardinality(ids)>0) THEN
  start_at:=new_date+j.arrival_time; end_at:=start_at+make_interval(mins=>j.scheduled_minutes);
  IF EXISTS(SELECT 1 FROM public.jobs other WHERE other.company_id=target_company AND other.id<>target_job AND other.status IN ('booked','in_progress') AND other.arrival_time IS NOT NULL
   AND other.move_date+other.arrival_time<end_at AND other.move_date+other.arrival_time+make_interval(mins=>other.scheduled_minutes)>start_at
   AND ((j.truck_id IS NOT NULL AND other.truck_id=j.truck_id) OR EXISTS(SELECT 1 FROM public.job_assignments a WHERE a.company_id=target_company AND a.job_id=other.id AND a.user_id=ANY(ids))))
  THEN RAISE EXCEPTION 'Scheduling conflict on %: the truck or a crew member is already booked at that time. Open the job to change the time or crew.', to_char(new_date,'Mon DD'); END IF;
 END IF;
 UPDATE public.jobs SET move_date=new_date WHERE company_id=target_company AND id=target_job;
 IF j.pricing_model='hourly' THEN
  SELECT * INTO r FROM public.crew_rates WHERE company_id=target_company AND crew_size=j.crew_size;
  IF FOUND THEN
   UPDATE public.jobs SET hourly_rate_cents=CASE WHEN extract(isodow FROM new_date) IN (6,7) THEN r.weekend_rate_cents ELSE r.weekday_rate_cents END
   WHERE company_id=target_company AND id=target_job;
  END IF;
 END IF;
 PERFORM app_private.apply_pricing_extras(target_company,target_job,'{}'::jsonb,j.service_charge_manual,j.service_charge_cents);
 SELECT * INTO after FROM public.jobs WHERE company_id=target_company AND id=target_job;
 RETURN jsonb_build_object('changed',true,'old_date',j.move_date,'new_date',after.move_date,'old_rate_cents',j.hourly_rate_cents,'new_rate_cents',after.hourly_rate_cents,
  'old_total_cents',j.quoted_total_cents,'new_total_cents',after.quoted_total_cents,'row_version',after.row_version);
END;
$$;
REVOKE ALL ON FUNCTION public.reschedule_job(uuid,uuid,date,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_job(uuid,uuid,date,integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Crew window and rescheduling ready' AS result;