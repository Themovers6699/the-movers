-- Moving software: development schema v1.
-- Run ONCE in the SQL Editor of the new development project.
-- One transaction; no DROP statements or existing-data deletion.
-- Project: yohmygccqdomiynnkobn. No keys or passwords are embedded.
BEGIN;
CREATE SCHEMA app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app_private TO authenticated;

CREATE TABLE public.companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
 slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 timezone text NOT NULL DEFAULT 'America/Chicago',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.company_members (
 company_id uuid NOT NULL REFERENCES public.companies(id),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 150),
 role text NOT NULL CHECK (role IN ('owner','office_admin','crew_leader','mover')),
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(company_id,user_id)
);
CREATE INDEX company_members_user_idx ON public.company_members(user_id,company_id);
CREATE TABLE public.company_settings (
 company_id uuid PRIMARY KEY REFERENCES public.companies(id),
 depot_address text NOT NULL,
 minimum_minutes integer NOT NULL DEFAULT 120 CHECK (minimum_minutes > 0),
 billing_increment_minutes integer NOT NULL DEFAULT 15 CHECK (billing_increment_minutes > 0),
 standard_deposit_cents bigint NOT NULL DEFAULT 5000 CHECK (standard_deposit_cents >= 0),
 out_of_town_deposit_percent numeric(5,2) NOT NULL DEFAULT 50 CHECK (out_of_town_deposit_percent BETWEEN 0 AND 100)
);
CREATE TABLE public.crew_rates (
 company_id uuid NOT NULL REFERENCES public.companies(id),
 crew_size integer NOT NULL CHECK (crew_size BETWEEN 1 AND 30),
 weekday_rate_cents bigint NOT NULL CHECK (weekday_rate_cents >= 0),
 weekend_rate_cents bigint NOT NULL CHECK (weekend_rate_cents >= 0),
 service_base_cents bigint NOT NULL CHECK (service_base_cents >= 0),
 service_cents_per_mile integer NOT NULL DEFAULT 120 CHECK (service_cents_per_mile >= 0),
 round_service_up_to_cents integer NOT NULL DEFAULT 500 CHECK (round_service_up_to_cents > 0),
 PRIMARY KEY(company_id,crew_size)
);
CREATE TABLE public.customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 name text NOT NULL,
 email text,
 phone text,
 office_notes text,
 UNIQUE(company_id,id)
);
CREATE TABLE public.jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 customer_id uuid,
 customer_name text NOT NULL,
 move_date date NOT NULL,
 arrival_time time,
 pick_up_address text NOT NULL,
 drop_off_address text NOT NULL,
 access_instructions text,
 move_type text NOT NULL CHECK (move_type IN ('residential','commercial')),
 status text NOT NULL DEFAULT 'estimate' CHECK (status IN ('estimate','booked','in_progress','completed','cancelled')),
 truck_label text,
 crew_size integer NOT NULL CHECK (crew_size BETWEEN 1 AND 30),
 pricing_model text NOT NULL CHECK (pricing_model IN ('hourly','flat')),
 hourly_rate_cents bigint CHECK (hourly_rate_cents >= 0),
 flat_rate_cents bigint CHECK (flat_rate_cents >= 0),
 service_charge_cents bigint CHECK (service_charge_cents >= 0),
 quoted_total_cents bigint CHECK (quoted_total_cents >= 0),
 deposit_required_cents bigint CHECK (deposit_required_cents >= 0),
 minimum_minutes integer NOT NULL DEFAULT 120 CHECK (minimum_minutes > 0),
 billing_increment_minutes integer NOT NULL DEFAULT 15 CHECK (billing_increment_minutes > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),
 FOREIGN KEY(company_id,customer_id) REFERENCES public.customers(company_id,id),
 CHECK ((pricing_model='hourly' AND hourly_rate_cents IS NOT NULL) OR (pricing_model='flat' AND flat_rate_cents IS NOT NULL))
);
CREATE INDEX jobs_company_date_idx ON public.jobs(company_id,move_date);
-- Sensitive office-only fields live separately from crew-visible job data.
CREATE TABLE public.job_office_notes (
 company_id uuid NOT NULL,
 job_id uuid NOT NULL,
 notes text NOT NULL DEFAULT '',
 PRIMARY KEY(company_id,job_id),
 FOREIGN KEY(company_id,job_id) REFERENCES public.jobs(company_id,id)
);
CREATE TABLE public.job_assignments (
 company_id uuid NOT NULL,
 job_id uuid NOT NULL,
 user_id uuid NOT NULL,
 crew_display_name text NOT NULL,
 PRIMARY KEY(company_id,job_id,user_id),
 FOREIGN KEY(company_id,job_id) REFERENCES public.jobs(company_id,id),
 FOREIGN KEY(company_id,user_id) REFERENCES public.company_members(company_id,user_id)
);
CREATE INDEX assignments_user_idx ON public.job_assignments(user_id,company_id,job_id);
CREATE TABLE public.time_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 job_id uuid NOT NULL,
 user_id uuid NOT NULL DEFAULT auth.uid(),
 started_at timestamptz NOT NULL,
 finished_at timestamptz,
 break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
 notes text NOT NULL DEFAULT '',
 FOREIGN KEY(company_id,job_id) REFERENCES public.jobs(company_id,id),
 FOREIGN KEY(company_id,user_id) REFERENCES public.company_members(company_id,user_id),
 CHECK (finished_at IS NULL OR finished_at >= started_at),
 CHECK (finished_at IS NULL OR break_minutes * interval '1 minute' <= finished_at-started_at)
);
CREATE TABLE public.payment_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 job_id uuid NOT NULL,
 method text NOT NULL CHECK (method IN ('cash','zelle','check','square')),
 amount_cents bigint NOT NULL CHECK (amount_cents > 0),
 payment_date date NOT NULL,
 reference text,
 notes text,
 status text NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','confirmed','void')),
 recorded_by uuid NOT NULL DEFAULT auth.uid(),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,job_id) REFERENCES public.jobs(company_id,id),
 FOREIGN KEY(company_id,recorded_by) REFERENCES public.company_members(company_id,user_id),
 CHECK (method <> 'check' OR length(btrim(reference)) > 0 AND reference IS NOT NULL)
);
CREATE TABLE public.job_photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 job_id uuid NOT NULL,
 uploaded_by uuid NOT NULL DEFAULT auth.uid(),
 object_path text NOT NULL UNIQUE,
 caption text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(company_id,job_id) REFERENCES public.jobs(company_id,id),
 FOREIGN KEY(company_id,uploaded_by) REFERENCES public.company_members(company_id,user_id),
 CHECK (object_path LIKE company_id::text || '/' || job_id::text || '/' || uploaded_by::text || '/%')
);
CREATE TABLE app_private.initial_owner (
 company_id uuid PRIMARY KEY REFERENCES public.companies(id),
 email text NOT NULL,
 claimed_by uuid REFERENCES auth.users(id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC, anon, authenticated;

CREATE FUNCTION app_private.has_role(c uuid, roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.company_members m WHERE m.company_id=c AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role=ANY(roles));
$$;
CREATE FUNCTION app_private.is_office(c uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT app_private.has_role(c,ARRAY['owner','office_admin']);
$$;
CREATE FUNCTION app_private.is_member(c uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT app_private.has_role(c,ARRAY['owner','office_admin','crew_leader','mover']);
$$;
CREATE FUNCTION app_private.can_view_job(c uuid,j uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT app_private.is_office(c) OR (
  app_private.is_member(c) AND EXISTS(SELECT 1 FROM public.job_assignments a WHERE a.company_id=c AND a.job_id=j AND a.user_id=(SELECT auth.uid()))
 );
$$;
CREATE FUNCTION app_private.storage_allowed(path text, for_upload boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE pieces text[]; c uuid; j uuid;
BEGIN
 pieces:=string_to_array(path,'/');
 IF array_length(pieces,1)<>4 OR pieces[4]='' THEN RETURN false; END IF;
 c:=pieces[1]::uuid; j:=pieces[2]::uuid;
 IF for_upload AND pieces[3]<>(SELECT auth.uid())::text THEN RETURN false; END IF;
 RETURN app_private.can_view_job(c,j) AND EXISTS(SELECT 1 FROM public.jobs x WHERE x.company_id=c AND x.id=j);
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END;
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.has_role(uuid,text[]),app_private.is_office(uuid),app_private.is_member(uuid),app_private.can_view_job(uuid,uuid),app_private.storage_allowed(text,boolean) TO authenticated;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crew_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_office_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.companies,public.company_members,public.company_settings,public.crew_rates,public.customers,public.jobs,public.job_office_notes,public.job_assignments,public.time_entries,public.payment_records,public.job_photos FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.companies TO authenticated;
GRANT SELECT ON public.company_members TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.company_settings,public.crew_rates,public.customers,public.jobs,public.job_office_notes,public.job_assignments,public.time_entries,public.payment_records,public.job_photos TO authenticated;
GRANT ALL ON public.companies,public.company_members,public.company_settings,public.crew_rates,public.customers,public.jobs,public.job_office_notes,public.job_assignments,public.time_entries,public.payment_records,public.job_photos TO service_role;

CREATE POLICY company_read ON public.companies FOR SELECT TO authenticated USING(app_private.is_member(id));
CREATE POLICY company_edit ON public.companies FOR UPDATE TO authenticated USING(app_private.is_office(id)) WITH CHECK(app_private.is_office(id));
CREATE POLICY member_read ON public.company_members FOR SELECT TO authenticated USING(app_private.is_office(company_id) OR (user_id=(SELECT auth.uid()) AND active));
CREATE POLICY settings_office ON public.company_settings FOR ALL TO authenticated USING(app_private.is_office(company_id)) WITH CHECK(app_private.is_office(company_id));
CREATE POLICY rates_office ON public.crew_rates FOR ALL TO authenticated USING(app_private.is_office(company_id)) WITH CHECK(app_private.is_office(company_id));
CREATE POLICY customers_office ON public.customers FOR ALL TO authenticated USING(app_private.is_office(company_id)) WITH CHECK(app_private.is_office(company_id));
CREATE POLICY job_read ON public.jobs FOR SELECT TO authenticated USING(app_private.can_view_job(company_id,id));
CREATE POLICY job_insert ON public.jobs FOR INSERT TO authenticated WITH CHECK(app_private.is_office(company_id));
CREATE POLICY job_update ON public.jobs FOR UPDATE TO authenticated USING(app_private.is_office(company_id)) WITH CHECK(app_private.is_office(company_id));
CREATE POLICY job_delete ON public.jobs FOR DELETE TO authenticated USING(app_private.is_office(company_id));
CREATE POLICY office_notes ON public.job_office_notes FOR ALL TO authenticated USING(app_private.is_office(company_id)) WITH CHECK(app_private.is_office(company_id));
CREATE POLICY assignments_read ON public.job_assignments FOR SELECT TO authenticated USING(app_private.can_view_job(company_id,job_id));
CREATE POLICY assignments_insert ON public.job_assignments FOR INSERT TO authenticated WITH CHECK(app_private.is_office(company_id));
CREATE POLICY assignments_update ON public.job_assignments FOR UPDATE TO authenticated USING(app_private.is_office(company_id)) WITH CHECK(app_private.is_office(company_id));
CREATE POLICY assignments_delete ON public.job_assignments FOR DELETE TO authenticated USING(app_private.is_office(company_id));
CREATE POLICY time_read ON public.time_entries FOR SELECT TO authenticated USING(app_private.is_office(company_id) OR (app_private.can_view_job(company_id,job_id) AND (user_id=(SELECT auth.uid()) OR app_private.has_role(company_id,ARRAY['crew_leader']))));
CREATE POLICY time_insert ON public.time_entries FOR INSERT TO authenticated WITH CHECK(app_private.is_office(company_id) OR (user_id=(SELECT auth.uid()) AND app_private.can_view_job(company_id,job_id)));
CREATE POLICY time_update ON public.time_entries FOR UPDATE TO authenticated USING(app_private.is_office(company_id) OR (user_id=(SELECT auth.uid()) AND app_private.can_view_job(company_id,job_id))) WITH CHECK(app_private.is_office(company_id) OR (user_id=(SELECT auth.uid()) AND app_private.can_view_job(company_id,job_id)));
CREATE POLICY time_delete ON public.time_entries FOR DELETE TO authenticated USING(app_private.is_office(company_id));
CREATE POLICY payment_read ON public.payment_records FOR SELECT TO authenticated USING(app_private.is_office(company_id) OR (app_private.has_role(company_id,ARRAY['crew_leader']) AND app_private.can_view_job(company_id,job_id)));
CREATE POLICY payment_insert ON public.payment_records FOR INSERT TO authenticated WITH CHECK(
 recorded_by=(SELECT auth.uid()) AND status='reported' AND method IN ('cash','zelle','check') AND
 (app_private.is_office(company_id) OR (app_private.has_role(company_id,ARRAY['crew_leader']) AND app_private.can_view_job(company_id,job_id)))
);
CREATE POLICY payment_update ON public.payment_records FOR UPDATE TO authenticated USING(app_private.is_office(company_id)) WITH CHECK(app_private.is_office(company_id));
-- Payment records are voided, not deleted. No DELETE policy.
CREATE POLICY photo_read ON public.job_photos FOR SELECT TO authenticated USING(app_private.can_view_job(company_id,job_id));
CREATE POLICY photo_insert ON public.job_photos FOR INSERT TO authenticated WITH CHECK(uploaded_by=(SELECT auth.uid()) AND app_private.can_view_job(company_id,job_id));
CREATE POLICY photo_delete ON public.job_photos FOR DELETE TO authenticated USING(app_private.is_office(company_id));

-- Bootstrap exactly one verified owner for the first company. No public sign-up
-- can choose its own role or gain access by changing user_metadata.
CREATE FUNCTION public.claim_initial_owner()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid; verified_email text; target uuid; existing uuid;
BEGIN
 u:=(SELECT auth.uid());
 SELECT lower(email) INTO verified_email FROM auth.users WHERE id=u AND email_confirmed_at IS NOT NULL;
 IF u IS NULL OR verified_email IS NULL THEN RAISE EXCEPTION 'Sign in with a verified owner email first'; END IF;
 SELECT company_id,claimed_by INTO target,existing FROM app_private.initial_owner WHERE email=verified_email FOR UPDATE;
 IF target IS NULL OR (existing IS NOT NULL AND existing<>u) THEN RAISE EXCEPTION 'This account cannot claim the initial company'; END IF;
 INSERT INTO public.company_members(company_id,user_id,display_name,role,active) VALUES(target,u,'Farhood Sani','owner',true)
 ON CONFLICT(company_id,user_id) DO NOTHING;
 UPDATE app_private.initial_owner SET claimed_by=u WHERE company_id=target;
 RETURN target;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_initial_owner() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_initial_owner() TO authenticated;

-- Register an already-created, verified Auth user. This does not send an email.
CREATE FUNCTION public.set_company_member(target_company uuid, member_email text, member_name text, member_role text, member_active boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target_user uuid; old_role text;
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 IF member_role NOT IN ('owner','office_admin','crew_leader','mover') OR length(btrim(member_name)) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'Invalid name or role'; END IF;
 SELECT id INTO target_user FROM auth.users WHERE lower(email)=lower(btrim(member_email)) AND email_confirmed_at IS NOT NULL;
 IF target_user IS NULL THEN RAISE EXCEPTION 'This person must first create and verify their app login'; END IF;
 SELECT role INTO old_role FROM public.company_members WHERE company_id=target_company AND user_id=target_user;
 IF (member_role='owner' OR old_role='owner') AND NOT app_private.has_role(target_company,ARRAY['owner']) THEN RAISE EXCEPTION 'Only an owner can manage owner access'; END IF;
 IF old_role='owner' AND (member_role<>'owner' OR NOT member_active) THEN RAISE EXCEPTION 'Owner removal is not supported by this setup function'; END IF;
 IF target_user=(SELECT auth.uid()) AND (NOT member_active OR member_role NOT IN ('owner','office_admin')) THEN RAISE EXCEPTION 'You cannot remove your own office access'; END IF;
 INSERT INTO public.company_members(company_id,user_id,display_name,role,active) VALUES(target_company,target_user,btrim(member_name),member_role,member_active)
 ON CONFLICT(company_id,user_id) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,active=excluded.active;
 RETURN target_user;
END;
$$;
REVOKE ALL ON FUNCTION public.set_company_member(uuid,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_company_member(uuid,text,text,text,boolean) TO authenticated;

-- Seed only The Movers company and its editable defaults. No customers or jobs.
DO $$
DECLARE c uuid;
BEGIN
 INSERT INTO public.companies(name,slug) VALUES('The Movers LLC','the-movers') RETURNING id INTO c;
 INSERT INTO app_private.initial_owner(company_id,email) VALUES(c,'move@themoverz.com');
 INSERT INTO public.company_settings(company_id,depot_address) VALUES(c,'525 N Ave, Plano, TX 75074');
 INSERT INTO public.crew_rates(company_id,crew_size,weekday_rate_cents,weekend_rate_cents,service_base_cents) VALUES
 (c,2,11000,12000,7500),(c,3,13500,15000,9500),(c,4,18000,20000,14500);
END;
$$;

-- Private photo bucket. Path: company_uuid/job_uuid/uploader_uuid/file.jpg
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('job-photos','job-photos',false,10485760,ARRAY['image/jpeg','image/png','image/webp']) ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='job-photos' AND public) THEN RAISE EXCEPTION 'Existing job-photos bucket is public; review it before using this script'; END IF; END $$;
CREATE POLICY moving_photos_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='job-photos' AND app_private.storage_allowed(name,false));
CREATE POLICY moving_photos_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='job-photos' AND app_private.storage_allowed(name,true));
CREATE POLICY moving_photos_delete ON storage.objects FOR DELETE TO authenticated USING(bucket_id='job-photos' AND app_private.storage_allowed(name,false) AND app_private.is_office(((storage.foldername(name))[1])::uuid));
-- No storage UPDATE policy: clients cannot overwrite existing job photos.
COMMIT;
SELECT 'Moving software development schema v1 created' AS result;
