-- Phase 0 hardening. Run after 20261116000000_sms_connection.sql.
-- Safe to run again. Keeps all existing records and RLS.
--  1. book_estimate(): server-side booking (the app no longer updates jobs directly)
--  2. SEC-1: no direct INSERT/UPDATE/DELETE on jobs or job_assignments from browser sessions;
--     all job and assignment writes go through the existing SECURITY DEFINER functions
--  3. audit_log: who changed what, for jobs, assignments, customers, hours, payments, staff, rates, trucks
--  4. US phone numbers stored in +1XXXXXXXXXX format
BEGIN;

-- 1. Booking ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.book_estimate(target_company uuid, target_job uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 UPDATE public.jobs SET status='booked' WHERE company_id=target_company AND id=target_job AND status='estimate';
 IF NOT FOUND THEN RAISE EXCEPTION 'Estimate not found or already booked. Refresh and try again.'; END IF;
 RETURN target_job;
END;
$$;
REVOKE ALL ON FUNCTION public.book_estimate(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.book_estimate(uuid,uuid) TO authenticated;

-- 2. SEC-1: writes only through server functions --------------------------------
-- Reading is unchanged (job_read / assignments_read policies stay).
REVOKE INSERT,UPDATE,DELETE ON public.jobs,public.job_assignments FROM authenticated;
-- Remove the now-unused write policies so a future accidental GRANT cannot reopen writes.
DROP POLICY IF EXISTS job_insert ON public.jobs;
DROP POLICY IF EXISTS job_update ON public.jobs;
DROP POLICY IF EXISTS job_delete ON public.jobs;
DROP POLICY IF EXISTS assignments_insert ON public.job_assignments;
DROP POLICY IF EXISTS assignments_update ON public.job_assignments;
DROP POLICY IF EXISTS assignments_delete ON public.job_assignments;

-- 3. Audit log ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 company_id uuid NOT NULL,
 table_name text NOT NULL,
 row_id text,
 action text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
 actor uuid,              -- signed-in user; NULL for dashboard/admin changes
 at timestamptz NOT NULL DEFAULT now(),
 old_row jsonb,
 new_row jsonb
);
CREATE INDEX IF NOT EXISTS audit_log_company_at_idx ON public.audit_log(company_id,at DESC);
CREATE INDEX IF NOT EXISTS audit_log_row_idx ON public.audit_log(table_name,row_id);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_log FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.audit_log TO authenticated;
GRANT SELECT ON public.audit_log TO service_role;
DROP POLICY IF EXISTS audit_read ON public.audit_log;
CREATE POLICY audit_read ON public.audit_log FOR SELECT TO authenticated USING (app_private.is_office(company_id));
-- No INSERT/UPDATE/DELETE grants or policies: only the trigger below writes, and nobody can edit history.

CREATE OR REPLACE FUNCTION app_private.audit_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o jsonb; n jsonb; r jsonb;
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') THEN o := to_jsonb(OLD); END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN n := to_jsonb(NEW); END IF;
 IF TG_OP = 'UPDATE' AND o = n THEN RETURN NULL; END IF;
 r := coalesce(n,o);
 INSERT INTO public.audit_log(company_id,table_name,row_id,action,actor,old_row,new_row)
 VALUES ((r->>'company_id')::uuid, TG_TABLE_NAME,
  coalesce(r->>'id', nullif(concat_ws('/', r->>'job_id', r->>'user_id', r->>'crew_size'),'')),
  TG_OP, (SELECT auth.uid()), o, n);
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_private.audit_row() FROM PUBLIC,anon,authenticated;

DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['jobs','job_assignments','job_office_notes','customers','time_entries','payment_records','company_members','company_settings','crew_rates','trucks'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS audit_row ON public.%I', t);
  EXECUTE format('CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app_private.audit_row()', t);
 END LOOP;
END $$;

-- 4. Phone numbers in +1 format --------------------------------------------------
-- Returns +1 and ten digits for a valid US/NANP number, otherwise NULL.
CREATE OR REPLACE FUNCTION app_private.normalize_us_phone(raw text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT CASE WHEN d ~ '^1?[2-9][0-9]{2}[2-9][0-9]{6}$' THEN '+1' || right(d,10) END
 FROM (SELECT regexp_replace(coalesce(raw,''),'[^0-9]','','g') AS d) x;
$$;
REVOKE ALL ON FUNCTION app_private.normalize_us_phone(text) FROM PUBLIC,anon,authenticated;

-- Valid numbers are stored as +1XXXXXXXXXX. Anything else is kept as typed (trimmed) for the office to fix.
CREATE OR REPLACE FUNCTION app_private.customer_phone_format()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 NEW.phone := coalesce(app_private.normalize_us_phone(NEW.phone), nullif(btrim(NEW.phone),''));
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.customer_phone_format() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS customer_phone_format ON public.customers;
CREATE TRIGGER customer_phone_format BEFORE INSERT OR UPDATE OF phone ON public.customers
 FOR EACH ROW EXECUTE FUNCTION app_private.customer_phone_format();
-- Reformat numbers already saved. Rows whose number does not change are not touched or audited.
UPDATE public.customers SET phone = app_private.normalize_us_phone(phone)
 WHERE app_private.normalize_us_phone(phone) IS NOT NULL AND phone IS DISTINCT FROM app_private.normalize_us_phone(phone);

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Phase 0 hardening ready' AS result;
