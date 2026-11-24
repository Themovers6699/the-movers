-- Staff invites. Run after 20261124000000_phase0_hardening.sql. Safe to run again; keeps all data.
-- Office staff enter name, email and role; the movers-staff-invite Edge Function sends Supabase's
-- invite email and then calls register_invited_member() WITH THE OFFICE USER'S OWN SESSION,
-- so the database checks their permission and the audit log records who granted access.
BEGIN;

-- Lookup used only by the Edge Function's server key: does a login exist for this email,
-- is it confirmed, and does it already belong to any company?
CREATE OR REPLACE FUNCTION public.staff_invite_lookup(member_email text)
RETURNS TABLE(user_id uuid, confirmed boolean, has_membership boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT u.id, u.email_confirmed_at IS NOT NULL,
        EXISTS(SELECT 1 FROM public.company_members m WHERE m.user_id=u.id)
 FROM auth.users u WHERE lower(u.email)=lower(btrim(member_email)) LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.staff_invite_lookup(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_invite_lookup(text) TO service_role;

-- Grant company access to a person who has a verified login OR a pending invite.
-- Same rules as set_company_member, except owners cannot be invited.
CREATE OR REPLACE FUNCTION public.register_invited_member(target_company uuid, invited_user uuid, member_name text, member_role text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_role text;
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 IF member_role NOT IN ('office_admin','crew_leader','mover') THEN RAISE EXCEPTION 'Invite as office admin, crew leader or mover'; END IF;
 IF length(btrim(coalesce(member_name,''))) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'Enter the person''s name (maximum 150 characters)'; END IF;
 IF invited_user=(SELECT auth.uid()) THEN RAISE EXCEPTION 'You cannot invite yourself'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=invited_user AND (u.email_confirmed_at IS NOT NULL OR u.invited_at IS NOT NULL)) THEN
  RAISE EXCEPTION 'No invite or verified login exists for this person';
 END IF;
 SELECT role INTO old_role FROM public.company_members WHERE company_id=target_company AND user_id=invited_user;
 IF old_role='owner' THEN RAISE EXCEPTION 'Owner access cannot be changed here'; END IF;
 INSERT INTO public.company_members(company_id,user_id,display_name,role,active)
 VALUES(target_company,invited_user,btrim(member_name),member_role,true)
 ON CONFLICT(company_id,user_id) DO UPDATE SET display_name=excluded.display_name,role=excluded.role,active=true;
 RETURN invited_user;
END;
$$;
REVOKE ALL ON FUNCTION public.register_invited_member(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_invited_member(uuid,uuid,text,text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Staff invites ready' AS result;
