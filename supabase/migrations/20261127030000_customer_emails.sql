-- Log of emails sent to customers (estimate / move confirmation), written by the movers-customer-email Edge Function.
-- Run after 20261127020000_crew_window_reschedule.sql. Safe to run again. Office can read; nobody can edit or delete.
BEGIN;
CREATE TABLE IF NOT EXISTS public.customer_emails (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 job_id uuid NOT NULL,
 customer_id uuid,
 to_email text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('estimate','confirmation')),
 reason text,
 subject text NOT NULL,
 status text NOT NULL CHECK (status IN ('sent','failed')),
 provider_id text,
 error text,
 sent_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (company_id,job_id) REFERENCES public.jobs(company_id,id)
);
CREATE INDEX IF NOT EXISTS customer_emails_job_idx ON public.customer_emails(company_id,job_id,created_at DESC);
ALTER TABLE public.customer_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_emails FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.customer_emails TO authenticated;
GRANT ALL ON public.customer_emails TO service_role;
DROP POLICY IF EXISTS customer_emails_read ON public.customer_emails;
CREATE POLICY customer_emails_read ON public.customer_emails FOR SELECT TO authenticated USING (app_private.is_office(company_id));
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Customer email log ready' AS result;
