-- Cancelled jobs list (owner request 2026-11-28). Run after 20261128000000_written_proposal.sql. Safe to run again.
--  * jobs.cancelled_at / cancelled_by, set automatically whenever a job becomes cancelled (any route), cleared if it
--    is ever un-cancelled. Jobs cancelled before this change get the time from the change history.
--  * search_cancelled_jobs(): office-only, newest cancellation first, searchable by name, phone, email or address,
--    like the customer search.
BEGIN;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS cancelled_by uuid;

CREATE OR REPLACE FUNCTION app_private.job_cancel_stamp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NEW.status='cancelled' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'cancelled') THEN
  NEW.cancelled_at:=coalesce(NEW.cancelled_at,now()); NEW.cancelled_by:=coalesce(NEW.cancelled_by,(SELECT auth.uid()));
 ELSIF NEW.status<>'cancelled' THEN
  NEW.cancelled_at:=NULL; NEW.cancelled_by:=NULL;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.job_cancel_stamp() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS job_cancel_stamp ON public.jobs;
CREATE TRIGGER job_cancel_stamp BEFORE INSERT OR UPDATE OF status ON public.jobs FOR EACH ROW EXECUTE FUNCTION app_private.job_cancel_stamp();

-- Earlier cancellations: take the time and person from the change history (else the move date at noon).
UPDATE public.jobs j SET cancelled_at=coalesce(h.at,(j.move_date+time '12:00') AT TIME ZONE 'America/Chicago'),cancelled_by=h.actor
FROM (SELECT j2.id,(SELECT a.at FROM public.audit_log a WHERE a.table_name='jobs' AND a.row_id=j2.id::text AND a.action='UPDATE' AND a.new_row->>'status'='cancelled' AND a.old_row->>'status' IS DISTINCT FROM 'cancelled' ORDER BY a.at DESC LIMIT 1) at,
             (SELECT a.actor FROM public.audit_log a WHERE a.table_name='jobs' AND a.row_id=j2.id::text AND a.action='UPDATE' AND a.new_row->>'status'='cancelled' AND a.old_row->>'status' IS DISTINCT FROM 'cancelled' ORDER BY a.at DESC LIMIT 1) actor
      FROM public.jobs j2 WHERE j2.status='cancelled' AND j2.cancelled_at IS NULL) h
WHERE j.id=h.id;
CREATE INDEX IF NOT EXISTS jobs_cancelled_idx ON public.jobs(company_id,cancelled_at DESC) WHERE status='cancelled';

CREATE OR REPLACE FUNCTION public.search_cancelled_jobs(target_company uuid, query text DEFAULT '', max_rows integer DEFAULT 200)
RETURNS TABLE(id uuid, customer_id uuid, customer_name text, phone text, email text, move_date date, arrival_time time, arrival_window_end time,
 pick_up_address text, drop_off_address text, quoted_total_cents integer, cancelled_at timestamptz, cancelled_by_name text, total_matches bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE q text; pat text; digits text;
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 q := btrim(coalesce(query,''));
 pat := '%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%';
 digits := regexp_replace(q,'[^0-9]','','g');
 IF length(digits)=11 AND left(digits,1)='1' THEN digits := substring(digits from 2); END IF;
 RETURN QUERY
 SELECT j.id,j.customer_id,j.customer_name,c.phone,c.email,j.move_date,j.arrival_time,j.arrival_window_end,j.pick_up_address,j.drop_off_address,
  j.quoted_total_cents::integer,j.cancelled_at,m.display_name,count(*) OVER ()
 FROM public.jobs j
 LEFT JOIN public.customers c ON c.company_id=j.company_id AND c.id=j.customer_id
 LEFT JOIN public.company_members m ON m.company_id=j.company_id AND m.user_id=j.cancelled_by
 WHERE j.company_id=target_company AND j.status='cancelled' AND (
  q='' OR j.customer_name ILIKE pat OR c.name ILIKE pat OR c.email ILIKE pat
  OR (length(digits)>=3 AND (regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') LIKE '%'||digits||'%' OR regexp_replace(coalesce(c.phone2,''),'[^0-9]','','g') LIKE '%'||digits||'%'))
  OR j.pick_up_address ILIKE pat OR j.drop_off_address ILIKE pat
  OR EXISTS(SELECT 1 FROM public.job_stops s WHERE s.company_id=j.company_id AND s.job_id=j.id AND s.address ILIKE pat))
 ORDER BY j.cancelled_at DESC NULLS LAST, j.move_date DESC, j.id
 LIMIT greatest(1,least(coalesce(max_rows,200),500));
END;
$$;
REVOKE ALL ON FUNCTION public.search_cancelled_jobs(uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.search_cancelled_jobs(uuid,text,integer) TO authenticated;
-- Restore a cancelled job to booked, on its own date or a new one (owner request 2026-11-28). Same truck/crew
-- conflict check as the job editor; a new date re-applies the weekday/weekend rate (via reschedule_job).
CREATE OR REPLACE FUNCTION public.restore_cancelled_job(target_company uuid, target_job uuid, expected_version integer, new_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j public.jobs%ROWTYPE; d date; ids uuid[]; start_at timestamp; end_at timestamp; v integer; moved jsonb;
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_company::text,0));
 SELECT * INTO j FROM public.jobs WHERE company_id=target_company AND id=target_job FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
 IF j.status<>'cancelled' THEN RAISE EXCEPTION 'This job is not cancelled'; END IF;
 IF expected_version IS DISTINCT FROM j.row_version THEN RAISE EXCEPTION 'This job changed in another window. Refresh and try again.'; END IF;
 d:=coalesce(new_date,j.move_date);
 IF d<app_private.company_today(target_company) THEN RAISE EXCEPTION 'The move date (%) has passed. Choose a new date to restore this job.', to_char(d,'Mon DD, YYYY'); END IF;
 SELECT coalesce(array_agg(user_id),ARRAY[]::uuid[]) INTO ids FROM public.job_assignments WHERE company_id=target_company AND job_id=target_job;
 IF j.arrival_time IS NOT NULL AND (j.truck_id IS NOT NULL OR cardinality(ids)>0) THEN
  start_at:=d+j.arrival_time; end_at:=start_at+make_interval(mins=>j.scheduled_minutes);
  IF EXISTS(SELECT 1 FROM public.jobs other WHERE other.company_id=target_company AND other.id<>target_job AND other.status IN ('booked','in_progress') AND other.arrival_time IS NOT NULL
   AND other.move_date+other.arrival_time<end_at AND other.move_date+other.arrival_time+make_interval(mins=>other.scheduled_minutes)>start_at
   AND ((j.truck_id IS NOT NULL AND other.truck_id=j.truck_id) OR EXISTS(SELECT 1 FROM public.job_assignments a WHERE a.company_id=target_company AND a.job_id=other.id AND a.user_id=ANY(ids))))
  THEN RAISE EXCEPTION 'Scheduling conflict on %: the truck or a crew member is already booked at that time. Choose another date, or restore it and change the time or crew.', to_char(d,'Mon DD'); END IF;
 END IF;
 UPDATE public.jobs SET status='booked' WHERE company_id=target_company AND id=target_job RETURNING row_version INTO v;
 IF d<>j.move_date THEN moved:=public.reschedule_job(target_company,target_job,d,v); END IF;
 RETURN jsonb_build_object('move_date',d,'moved',d<>j.move_date,'old_date',j.move_date,'rate',moved);
END;
$$;
REVOKE ALL ON FUNCTION public.restore_cancelled_job(uuid,uuid,integer,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.restore_cancelled_job(uuid,uuid,integer,date) TO authenticated;NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Cancelled jobs list and restore ready' AS result;
