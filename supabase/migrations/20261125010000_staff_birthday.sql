-- Staff birthday (month and day only, no year: enough for a birthday wish without storing anyone's age).
-- Run after 20261125000000_staff_profiles.sql. Safe to run again; keeps all data.
BEGIN;
ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS birthday_month smallint;
ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS birthday_day smallint;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='staff_birthday_valid' AND conrelid='public.staff_profiles'::regclass) THEN
  ALTER TABLE public.staff_profiles ADD CONSTRAINT staff_birthday_valid CHECK (
   (birthday_month IS NULL AND birthday_day IS NULL) OR
   (birthday_month BETWEEN 1 AND 12 AND birthday_day BETWEEN 1 AND
     CASE WHEN birthday_month=2 THEN 29 WHEN birthday_month IN (4,6,9,11) THEN 30 ELSE 31 END));
 END IF;
END $$;

-- Same function as 20261125000000 plus the two birthday fields.
CREATE OR REPLACE FUNCTION public.save_staff_profile(target_company uuid, target_user uuid, payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.company_members%ROWTYPE; new_role text; new_active boolean; nm text; wt text; rate bigint; eff date; tz text; current_rate bigint; bm smallint; bd smallint;
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
 bm := nullif(payload->>'birthday_month','')::smallint; bd := nullif(payload->>'birthday_day','')::smallint;
 IF (bm IS NULL) <> (bd IS NULL) THEN RAISE EXCEPTION 'Choose both the birthday month and day, or neither'; END IF;
 IF bm IS NOT NULL AND (bm NOT BETWEEN 1 AND 12 OR bd < 1 OR bd > CASE WHEN bm=2 THEN 29 WHEN bm IN (4,6,9,11) THEN 30 ELSE 31 END) THEN RAISE EXCEPTION 'That birthday date does not exist'; END IF;

 UPDATE public.company_members SET display_name=nm, role=new_role, active=new_active WHERE company_id=target_company AND user_id=target_user;

 INSERT INTO public.staff_profiles(company_id,user_id,phone,address_line,city,state,postal_code,worker_type,start_date,office_notes,emergency_contact_name,emergency_contact_phone,birthday_month,birthday_day,updated_at)
 VALUES (target_company,target_user,
  coalesce(app_private.normalize_us_phone(payload->>'phone'), nullif(btrim(payload->>'phone'),'')),
  nullif(btrim(payload->>'address_line'),''), nullif(btrim(payload->>'city'),''), nullif(upper(btrim(payload->>'state')),''), nullif(btrim(payload->>'postal_code'),''),
  wt, nullif(payload->>'start_date','')::date, nullif(btrim(payload->>'office_notes'),''),
  nullif(btrim(payload->>'emergency_contact_name'),''),
  coalesce(app_private.normalize_us_phone(payload->>'emergency_contact_phone'), nullif(btrim(payload->>'emergency_contact_phone'),'')),
  bm, bd, now())
 ON CONFLICT (company_id,user_id) DO UPDATE SET phone=excluded.phone,address_line=excluded.address_line,city=excluded.city,state=excluded.state,
  postal_code=excluded.postal_code,worker_type=excluded.worker_type,start_date=excluded.start_date,office_notes=excluded.office_notes,
  emergency_contact_name=excluded.emergency_contact_name,emergency_contact_phone=excluded.emergency_contact_phone,
  birthday_month=excluded.birthday_month,birthday_day=excluded.birthday_day,updated_at=now();

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
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Staff birthdays ready' AS result;
