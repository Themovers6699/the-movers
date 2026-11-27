-- Phase 2A: crew job screens. Run after 20261126010000_import_fields.sql. Safe to run again; keeps all data.
-- Owner decisions (2026-11-27): crew leaders see prices and customer contact; movers see job basics only (date,
-- window, customer name, addresses + access notes, crew, truck) and NEVER prices or customer phone/email.
--  * Crew no longer read jobs / add-on lines directly (that exposed prices to movers). They use crew_jobs() and
--    crew_job_detail(), which return only what their role may see. The price list stays readable by office and leaders.
--  * start_job() / finish_job(): crew leader (assigned) or office. Leaders can't start a job before its move date.
--  * job_notes: crew/office notes on a job, permanent (no edit/delete), audited.
--  * job_photos.category (before / after / damage / other).
BEGIN;

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS actual_start_at timestamptz;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS actual_end_at timestamptz;
ALTER TABLE public.job_photos ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='job_photos_category_valid' AND conrelid='public.job_photos'::regclass) THEN
  ALTER TABLE public.job_photos ADD CONSTRAINT job_photos_category_valid CHECK (category IN ('before','after','damage','other'));
 END IF;
END $$;

-- Narrow direct reads (office keeps everything; crew go through the functions below).
DROP POLICY IF EXISTS job_read ON public.jobs;
CREATE POLICY job_read ON public.jobs FOR SELECT TO authenticated USING (app_private.is_office(company_id));
DROP POLICY IF EXISTS job_line_items_read ON public.job_line_items;
CREATE POLICY job_line_items_read ON public.job_line_items FOR SELECT TO authenticated USING (
 app_private.is_office(company_id) OR (app_private.has_role(company_id,ARRAY['crew_leader']) AND app_private.can_view_job(company_id,job_id)));
DROP POLICY IF EXISTS price_items_read ON public.price_items;
CREATE POLICY price_items_read ON public.price_items FOR SELECT TO authenticated USING (app_private.has_role(company_id,ARRAY['owner','office_admin','crew_leader']));

CREATE TABLE IF NOT EXISTS public.job_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 job_id uuid NOT NULL,
 author uuid NOT NULL DEFAULT auth.uid(),
 body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (company_id,job_id) REFERENCES public.jobs(company_id,id),
 FOREIGN KEY (company_id,author) REFERENCES public.company_members(company_id,user_id)
);
CREATE INDEX IF NOT EXISTS job_notes_job_idx ON public.job_notes(company_id,job_id,created_at);
ALTER TABLE public.job_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_notes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.job_notes TO authenticated;
GRANT ALL ON public.job_notes TO service_role;
DROP POLICY IF EXISTS job_notes_read ON public.job_notes;
CREATE POLICY job_notes_read ON public.job_notes FOR SELECT TO authenticated USING (app_private.can_view_job(company_id,job_id));
DROP TRIGGER IF EXISTS audit_row ON public.job_notes;
CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON public.job_notes FOR EACH ROW EXECUTE FUNCTION app_private.audit_row();

CREATE OR REPLACE FUNCTION app_private.is_job_leader(c uuid, j uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT app_private.has_role(c,ARRAY['crew_leader']) AND EXISTS(SELECT 1 FROM public.job_assignments a WHERE a.company_id=c AND a.job_id=j AND a.user_id=(SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION app_private.is_job_leader(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_job_leader(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.company_today(c uuid)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT (now() AT TIME ZONE coalesce((SELECT timezone FROM public.companies WHERE id=c),'America/Chicago'))::date;
$$;
REVOKE ALL ON FUNCTION app_private.company_today(uuid) FROM PUBLIC,anon,authenticated;

-- My assigned jobs (office: all jobs) in a date range, basics only (safe for every role).
CREATE OR REPLACE FUNCTION public.crew_jobs(target_company uuid, from_date date, to_date date)
RETURNS TABLE(id uuid, move_date date, arrival_time time, arrival_window_end time, status text, service_type text, truck_needed boolean,
 truck_name text, customer_name text, first_address text, last_address text, stop_count integer, crew_names text[], i_am_leader boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT app_private.is_member(target_company) THEN RAISE EXCEPTION 'Company access required'; END IF;
 IF to_date - from_date > 400 THEN RAISE EXCEPTION 'Choose a shorter date range'; END IF;
 RETURN QUERY
 SELECT j.id,j.move_date,j.arrival_time,j.arrival_window_end,j.status,j.service_type,j.truck_needed,
  coalesce(t.name,j.truck_label),j.customer_name,j.pick_up_address,j.drop_off_address,
  (SELECT count(*)::int FROM public.job_stops s WHERE s.company_id=j.company_id AND s.job_id=j.id),
  coalesce((SELECT array_agg(a.crew_display_name ORDER BY a.crew_display_name) FROM public.job_assignments a WHERE a.company_id=j.company_id AND a.job_id=j.id),'{}'),
  app_private.is_office(target_company) OR app_private.is_job_leader(target_company,j.id)
 FROM public.jobs j LEFT JOIN public.trucks t ON t.company_id=j.company_id AND t.id=j.truck_id
 WHERE j.company_id=target_company AND j.status IN ('booked','in_progress','completed','cancelled')
  AND j.move_date BETWEEN from_date AND to_date AND app_private.can_view_job(target_company,j.id)
 ORDER BY j.move_date, j.arrival_time NULLS LAST;
END;
$$;
REVOKE ALL ON FUNCTION public.crew_jobs(uuid,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crew_jobs(uuid,date,date) TO authenticated;

-- One job for the crew screen. Leaders (and office) also get customer contact, pricing and add-ons.
CREATE OR REPLACE FUNCTION public.crew_job_detail(target_company uuid, target_job uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE j public.jobs%ROWTYPE; leader boolean; out jsonb; c public.customers%ROWTYPE;
BEGIN
 IF NOT app_private.can_view_job(target_company,target_job) THEN RAISE EXCEPTION 'This job is not assigned to you'; END IF;
 SELECT * INTO j FROM public.jobs WHERE company_id=target_company AND id=target_job;
 IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
 leader := app_private.is_office(target_company) OR app_private.is_job_leader(target_company,target_job);
 out := jsonb_build_object('id',j.id,'move_date',j.move_date,'arrival_time',j.arrival_time,'arrival_window_end',j.arrival_window_end,
  'status',j.status,'service_type',j.service_type,'truck_needed',j.truck_needed,'move_type',j.move_type,'customer_name',j.customer_name,
  'instructions',j.access_instructions,'actual_start_at',j.actual_start_at,'actual_end_at',j.actual_end_at,'i_am_leader',leader,
  'truck',(SELECT name FROM public.trucks WHERE company_id=j.company_id AND id=j.truck_id),
  'crew',coalesce((SELECT jsonb_agg(jsonb_build_object('name',a.crew_display_name,'role',m.role) ORDER BY a.crew_display_name)
    FROM public.job_assignments a JOIN public.company_members m ON m.company_id=a.company_id AND m.user_id=a.user_id
    WHERE a.company_id=j.company_id AND a.job_id=j.id),'[]'::jsonb),
  'stops',coalesce((SELECT jsonb_agg(jsonb_build_object('position',s.position,'kind',s.kind,'address',s.address,'location_type',s.location_type,
    'bedrooms',s.bedrooms,'floor',s.floor,'unit',s.unit,'access_notes',s.access_notes) ORDER BY s.position)
    FROM public.job_stops s WHERE s.company_id=j.company_id AND s.job_id=j.id),'[]'::jsonb),
  'notes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',n.id,'body',n.body,'created_at',n.created_at,'author',coalesce(m.display_name,'Former staff member'),'mine',n.author=(SELECT auth.uid())) ORDER BY n.created_at)
    FROM public.job_notes n LEFT JOIN public.company_members m ON m.company_id=n.company_id AND m.user_id=n.author
    WHERE n.company_id=j.company_id AND n.job_id=j.id),'[]'::jsonb));
 IF leader THEN
  SELECT * INTO c FROM public.customers WHERE company_id=j.company_id AND id=j.customer_id;
  out := out || jsonb_build_object(
   'customer',CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('name',c.name,'phone',c.phone,'phone2',c.phone2,'email',c.email) END,
   'pricing',jsonb_build_object('pricing_model',j.pricing_model,'crew_size',j.crew_size,'hourly_rate_cents',j.hourly_rate_cents,
    'flat_rate_cents',j.flat_rate_cents,'service_charge_cents',j.service_charge_cents,'service_charge_manual',j.service_charge_manual,
    'add_ons_cents',j.add_ons_cents,'quoted_total_cents',j.quoted_total_cents,'deposit_required_cents',j.deposit_required_cents,
    'estimated_minutes',j.estimated_minutes,'minimum_minutes',j.minimum_minutes,'billing_increment_minutes',j.billing_increment_minutes),
   'add_ons',coalesce((SELECT jsonb_agg(jsonb_build_object('name',l.name,'unit_label',l.unit_label,'quantity',l.quantity,'total_cents',l.total_cents) ORDER BY l.position)
     FROM public.job_line_items l WHERE l.company_id=j.company_id AND l.job_id=j.id),'[]'::jsonb));
 END IF;
 RETURN out;
END;
$$;
REVOKE ALL ON FUNCTION public.crew_job_detail(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crew_job_detail(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_job(target_company uuid, target_job uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j public.jobs%ROWTYPE;
BEGIN
 IF NOT (app_private.is_office(target_company) OR app_private.is_job_leader(target_company,target_job)) THEN RAISE EXCEPTION 'Only the crew leader or the office can start this job'; END IF;
 SELECT * INTO j FROM public.jobs WHERE company_id=target_company AND id=target_job FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
 IF j.status<>'booked' THEN RAISE EXCEPTION 'Only a booked job can be started (this one is %)', replace(j.status,'_',' '); END IF;
 IF NOT app_private.is_office(target_company) AND j.move_date > app_private.company_today(target_company) THEN
  RAISE EXCEPTION 'This job is on %. It can be started on the move day.', to_char(j.move_date,'Mon DD'); END IF;
 UPDATE public.jobs SET status='in_progress', actual_start_at=coalesce(actual_start_at,now()) WHERE company_id=target_company AND id=target_job;
END;
$$;
CREATE OR REPLACE FUNCTION public.finish_job(target_company uuid, target_job uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j public.jobs%ROWTYPE;
BEGIN
 IF NOT (app_private.is_office(target_company) OR app_private.is_job_leader(target_company,target_job)) THEN RAISE EXCEPTION 'Only the crew leader or the office can finish this job'; END IF;
 SELECT * INTO j FROM public.jobs WHERE company_id=target_company AND id=target_job FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
 IF j.status<>'in_progress' THEN RAISE EXCEPTION 'Start the job before finishing it'; END IF;
 UPDATE public.jobs SET status='completed', actual_end_at=greatest(now(),j.actual_start_at) WHERE company_id=target_company AND id=target_job;
END;
$$;
CREATE OR REPLACE FUNCTION public.add_job_note(target_company uuid, target_job uuid, note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE id uuid;
BEGIN
 IF NOT app_private.can_view_job(target_company,target_job) THEN RAISE EXCEPTION 'This job is not assigned to you'; END IF;
 IF length(btrim(coalesce(note,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Write a note (up to 2,000 characters)'; END IF;
 INSERT INTO public.job_notes(company_id,job_id,author,body) VALUES (target_company,target_job,(SELECT auth.uid()),btrim(note)) RETURNING job_notes.id INTO id;
 RETURN id;
END;
$$;
REVOKE ALL ON FUNCTION public.start_job(uuid,uuid), public.finish_job(uuid,uuid), public.add_job_note(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_job(uuid,uuid), public.finish_job(uuid,uuid), public.add_job_note(uuid,uuid,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Crew app ready' AS result;
