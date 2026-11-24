-- Staff invites, part 2. Run after 20261124200000_staff_invites.sql. Safe to run again.
-- An invite link that was opened but never finished leaves a CONFIRMED login with NO password.
-- The lookup now reports whether a password is set, so the invite function can send a
-- "set your password" email instead of wrongly saying the person can already sign in.
BEGIN;
DROP FUNCTION IF EXISTS public.staff_invite_lookup(text);
CREATE FUNCTION public.staff_invite_lookup(member_email text)
RETURNS TABLE(user_id uuid, confirmed boolean, has_membership boolean, has_password boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT u.id, u.email_confirmed_at IS NOT NULL,
        EXISTS(SELECT 1 FROM public.company_members m WHERE m.user_id=u.id),
        coalesce(u.encrypted_password,'') <> ''
 FROM auth.users u WHERE lower(u.email)=lower(btrim(member_email)) LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.staff_invite_lookup(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_invite_lookup(text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Staff invite password check ready' AS result;
