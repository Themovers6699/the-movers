-- Thank-you / review request emails (owner request 2026-11-28). Run after 20261128010000_cancelled_jobs.sql. Safe to run again.
BEGIN;
ALTER TABLE public.customer_emails DROP CONSTRAINT IF EXISTS customer_emails_kind_check;
ALTER TABLE public.customer_emails ADD CONSTRAINT customer_emails_kind_check CHECK (kind IN ('estimate','confirmation','proposal','review'));
COMMIT;
SELECT 'Review emails ready' AS result;