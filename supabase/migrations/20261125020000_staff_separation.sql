-- When staff leave: end date + reason (owner decision 2026-11-24). Run after 20261125010000_staff_birthday.sql.
-- Safe to run again; keeps all data. Deactivating requires an end date and reason; re-activating clears them
-- (previous values stay in the audit log). Records are never deleted (IRS: keep at least 4 years).
BEGIN;
ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS separation_reason text;
ALTER TABLE public.staff_profiles ADD COLUMN IF NOT EXISTS separation_note text;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='staff_separation_reason_valid' AND conrelid='public.staff_profiles'::regclass) THEN
  ALTER TABLE public.staff_profiles ADD CONSTRAINT staff_separation_reason_valid CHECK (separation_reason IN ('quit','let_go','seasonal','other'));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='staff_separation_note_len' AND conrelid='public.staff_profiles'::regclass) THEN
  ALTER TABLE public.staff_profiles ADD CONSTRAINT staff_separation_note_len CHECK (length(separation_note)<=1000);
 END IF;
END $$;

-- Same as 20261125010000 plus end date / reason / note.
CREATE OR REPLACE FUNCTION public.save_staff_profile(target_company uuid, target_user uuid, payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.company_members%ROWTYPE; new_role text; new_active boolean; nm text; wt text; rate bigint; eff date; tz text; current_rate bigint;
 bm smallint; bd smallint; ed date; sr text; sn text;
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

 IF new_active THEN
  ed := NULL; sr := NULL; sn := NULL; -- active again: no current end date
 ELSE
  ed := nullif(payload->>'end_date','')::date; sr := nullif(payload->>'separation_reason',''); sn := nullif(btrim(payload->>'separation_note'),'');
  IF ed IS NULL OR sr IS NULL THEN RAISE EXCEPTION 'Enter the end date and reason when deactivating someone'; END IF;
  IF sr NOT IN ('quit','let_go','seasonal','other') THEN RAISE EXCEPTION 'Unknown reason'; END IF;
 END IF;

 UPDATE public.company_members SET display_name=nm, role=new_role, active=new_active WHERE company_id=target_company AND user_id=target_user;

 INSERT INTO public.staff_profiles(company_id,user_id,phone,address_line,city,state,postal_code,worker_type,start_date,office_notes,emergency_contact_name,emergency_contact_phone,birthday_month,birthday_day,end_date,separation_reason,separation_note,updated_at)
 VALUES (target_company,target_user,
  coalesce(app_private.normalize_us_phone(payload->>'phone'), nullif(btrim(payload->>'phone'),'')),
  nullif(btrim(payload->>'address_line'),''), nullif(btrim(payload->>'city'),''), nullif(upper(btrim(payload->>'state')),''), nullif(btrim(payload->>'postal_code'),''),
  wt, nullif(payload->>'start_date','')::date, nullif(btrim(payload->>'office_notes'),''),
  nullif(btrim(payload->>'emergency_contact_name'),''),
  coalesce(app_private.normalize_us_phone(payload->>'emergency_contact_phone'), nullif(btrim(payload->>'emergency_contact_phone'),'')),
  bm, bd, ed, sr, sn, now())
 ON CONFLICT (company_id,user_id) DO UPDATE SET phone=excluded.phone,address_line=excluded.address_line,city=excluded.city,state=excluded.state,
  postal_code=excluded.postal_code,worker_type=excluded.worker_type,start_date=excluded.start_date,office_notes=excluded.office_notes,
  emergency_contact_name=excluded.emergency_contact_name,emergency_contact_phone=excluded.emergency_contact_phone,
  birthday_month=excluded.birthday_month,birthday_day=excluded.birthday_day,
  end_date=excluded.end_date,separation_reason=excluded.separation_reason,separation_note=excluded.separation_note,updated_at=now();

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
SELECT 'Staff end dates ready' AS result;
