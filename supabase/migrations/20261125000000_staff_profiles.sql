-- Staff records. Run after 20261124210000_staff_invite_password_check.sql. Safe to run again; keeps all data.
-- Owner decisions (2026-11-24): owner AND office admins can view/edit staff details, wages and login emails;
-- the owner's record is editable only by the owner and the owner's email/role/access can't be changed here;
-- wage changes are kept as history with an effective date. No SSNs (they stay in QuickBooks Online).
BEGIN;

CREATE TABLE IF NOT EXISTS public.staff_profiles (
 company_id uuid NOT NULL,
 user_id uuid NOT NULL,
 phone text CHECK (length(phone)<=40),
 address_line text CHECK (length(address_line)<=200),
 city text CHECK (length(city)<=100),
 state text CHECK (length(state)<=40),
 postal_code text CHECK (length(postal_code)<=20),
 worker_type text CHECK (worker_type IN ('1099_contractor','w2_employee','owner_salaried')),
 start_date date,
 office_notes text CHECK (length(office_notes)<=4000),
 emergency_contact_name text CHECK (length(emergency_contact_name)<=150),
 emergency_contact_phone text CHECK (length(emergency_contact_phone)<=40),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (company_id,user_id),
 FOREIGN KEY (company_id,user_id) REFERENCES public.company_members(company_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.staff_pay_rates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 user_id uuid NOT NULL,
 hourly_rate_cents bigint NOT NULL CHECK (hourly_rate_cents BETWEEN 0 AND 100000),
 effective_date date NOT NULL,
 created_by uuid DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (company_id,user_id,effective_date),
 FOREIGN KEY (company_id,user_id) REFERENCES public.company_members(company_id,user_id)
);
CREATE INDEX IF NOT EXISTS staff_pay_rates_lookup_idx ON public.staff_pay_rates(company_id,user_id,effective_date DESC);

ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_pay_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_profiles,public.staff_pay_rates FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.staff_profiles,public.staff_pay_rates TO authenticated;
GRANT ALL ON public.staff_profiles,public.staff_pay_rates TO service_role;
DROP POLICY IF EXISTS staff_profiles_office ON public.staff_profiles;
CREATE POLICY staff_profiles_office ON public.staff_profiles FOR SELECT TO authenticated USING (app_private.is_office(company_id));
DROP POLICY IF EXISTS staff_pay_rates_office ON public.staff_pay_rates;
CREATE POLICY staff_pay_rates_office ON public.staff_pay_rates FOR SELECT TO authenticated USING (app_private.is_office(company_id));
-- No write grants: all changes go through save_staff_profile().

DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['staff_profiles','staff_pay_rates'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS audit_row ON public.%I', t);
  EXECUTE format('CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app_private.audit_row()', t);
 END LOOP;
END $$;

-- Office view of everyone's login email and whether they have finished setting a password.
CREATE OR REPLACE FUNCTION public.staff_directory(target_company uuid)
RETURNS TABLE(user_id uuid, email text, invite_pending boolean, last_sign_in_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 RETURN QUERY SELECT m.user_id, u.email::text, coalesce(u.encrypted_password,'')='', u.last_sign_in_at
  FROM public.company_members m JOIN auth.users u ON u.id=m.user_id WHERE m.company_id=target_company;
END;
$$;
REVOKE ALL ON FUNCTION public.staff_directory(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_directory(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_staff_profile(target_company uuid, target_user uuid, payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.company_members%ROWTYPE; new_role text; new_active boolean; nm text; wt text; rate bigint; eff date; tz text; current_rate bigint;
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 SELECT * INTO m FROM public.company_members WHERE company_id=target_company AND user_id=target_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Staff member not found in this company'; END IF;
 IF m.role='owner' AND NOT app_private.has_role(target_company,ARRAY['owner']) THEN RAISE EXCEPTION 'Only the owner can edit the owner''s record'; END IF;

 new_role := coalesce(nullif(payload->>'role',''), m.role);
 new_active := coalesce((payload->>'active')::boolean, m.active);
 IF m.role='owner' AND (new_role<>'owner' OR NOT new_active) THEN RAISE EXCEPTION 'The owner''s role and access cannot be changed here'; END IF;
 IF m.role<>'owner' AND new_role NOT IN ('office_admin','crew_leader','mover') THEN RAISE EXCEPTION 'Choose office admin, crew leader or mover'; END IF;
 IF target_user=(SELECT auth.uid()) AND (NOT new_active OR new_role NOT IN ('owner','office_admin')) THEN RAISE EXCEPTION 'You cannot remove your own office access'; END IF;
 nm := btrim(coalesce(payload->>'display_name', m.display_name));
 IF length(nm) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'Enter a name (maximum 150 characters)'; END IF;
 wt := nullif(payload->>'worker_type','');
 IF wt IS NOT NULL AND wt NOT IN ('1099_contractor','w2_employee','owner_salaried') THEN RAISE EXCEPTION 'Unknown worker type'; END IF;

 UPDATE public.company_members SET display_name=nm, role=new_role, active=new_active WHERE company_id=target_company AND user_id=target_user;

 INSERT INTO public.staff_profiles(company_id,user_id,phone,address_line,city,state,postal_code,worker_type,start_date,office_notes,emergency_contact_name,emergency_contact_phone,updated_at)
 VALUES (target_company,target_user,
  coalesce(app_private.normalize_us_phone(payload->>'phone'), nullif(btrim(payload->>'phone'),'')),
  nullif(btrim(payload->>'address_line'),''), nullif(btrim(payload->>'city'),''), nullif(upper(btrim(payload->>'state')),''), nullif(btrim(payload->>'postal_code'),''),
  wt, nullif(payload->>'start_date','')::date, nullif(btrim(payload->>'office_notes'),''),
  nullif(btrim(payload->>'emergency_contact_name'),''),
  coalesce(app_private.normalize_us_phone(payload->>'emergency_contact_phone'), nullif(btrim(payload->>'emergency_contact_phone'),'')),
  now())
 ON CONFLICT (company_id,user_id) DO UPDATE SET phone=excluded.phone,address_line=excluded.address_line,city=excluded.city,state=excluded.state,
  postal_code=excluded.postal_code,worker_type=excluded.worker_type,start_date=excluded.start_date,office_notes=excluded.office_notes,
  emergency_contact_name=excluded.emergency_contact_name,emergency_contact_phone=excluded.emergency_contact_phone,updated_at=now();

 -- Wage: add a dated rate only when it differs from the rate in effect on that date.
 IF nullif(payload->>'hourly_rate_cents','') IS NOT NULL THEN
  rate := (payload->>'hourly_rate_cents')::bigint;
  IF rate < 0 OR rate > 100000 THEN RAISE EXCEPTION 'Enter an hourly wage between $0 and $1,000'; END IF;
  SELECT timezone INTO tz FROM public.companies WHERE id=target_company;
  eff := coalesce(nullif(payload->>'rate_effective_date','')::date, (now() AT TIME ZONE coalesce(tz,'America/Chicago'))::date);
  SELECT hourly_rate_cents INTO current_rate FROM public.staff_pay_rates
   WHERE company_id=target_company AND user_id=target_user AND effective_date<=eff ORDER BY effective_date DESC LIMIT 1;
  IF current_rate IS DISTINCT FROM rate THEN
   INSERT INTO public.staff_pay_rates(company_id,user_id,hourly_rate_cents,effective_date) VALUES (target_company,target_user,rate,eff)
   ON CONFLICT (company_id,user_id,effective_date) DO UPDATE SET hourly_rate_cents=excluded.hourly_rate_cents,created_by=auth.uid(),created_at=now();
  END IF;
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.save_staff_profile(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_staff_profile(uuid,uuid,jsonb) TO authenticated;

-- Login-email changes happen in Supabase Auth (Edge Function movers-staff-email). This records them in the
-- audit log with the office user who made the change. Server key only; the function passes the verified actor.
CREATE OR REPLACE FUNCTION public.record_staff_email_change(target_company uuid, target_user uuid, changed_by uuid, old_email text, new_email text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
 INSERT INTO public.audit_log(company_id,table_name,row_id,action,actor,old_row,new_row)
 VALUES (target_company,'login_email',target_user::text,'UPDATE',changed_by,jsonb_build_object('email',old_email),jsonb_build_object('email',new_email));
$$;
REVOKE ALL ON FUNCTION public.record_staff_email_change(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_staff_email_change(uuid,uuid,uuid,text,text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Staff records ready' AS result;
