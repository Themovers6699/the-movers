-- Automatic thank-you/review emails and customer complaints (owner request 2026-11-28).
-- Run after 20261128020000_review_emails.sql. Safe to run again.
--  * company_settings.auto_review_emails: when on, the thank-you email goes out 24 hours after the crew finishes the move
--    (daytime only, 9 AM-7 PM company time; moves finished within the last 7 days, so old/imported jobs never get one).
--    The schedule (pg_cron + pg_net -> movers-customer-email) is created when the office turns the switch on, because
--    only the Edge Function knows its own address.
--  * customer_feedback_links: the "Tell us about a problem" link in that email (only the SHA-256 of the code is kept).
--  * job_complaints: what customers send through it; the office reads and resolves them in the app.
BEGIN;
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS auto_review_emails boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.customer_feedback_links (
 token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
 company_id uuid NOT NULL,
 job_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (company_id,job_id) REFERENCES public.jobs(company_id,id)
);
ALTER TABLE public.customer_feedback_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_feedback_links FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.customer_feedback_links TO service_role;

CREATE TABLE IF NOT EXISTS public.job_complaints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 job_id uuid NOT NULL,
 customer_id uuid,
 customer_name text NOT NULL,
 message text NOT NULL CHECK (length(message) BETWEEN 1 AND 5000),
 contact_phone text,
 created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
 resolved_at timestamptz,
 resolved_by uuid,
 resolution_note text,
 FOREIGN KEY (company_id,job_id) REFERENCES public.jobs(company_id,id)
);
CREATE INDEX IF NOT EXISTS job_complaints_company_idx ON public.job_complaints(company_id,status,created_at DESC);
ALTER TABLE public.job_complaints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_complaints FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.job_complaints TO authenticated;
GRANT ALL ON public.job_complaints TO service_role;
DROP POLICY IF EXISTS job_complaints_read ON public.job_complaints;
CREATE POLICY job_complaints_read ON public.job_complaints FOR SELECT TO authenticated USING (app_private.is_office(company_id));
DROP TRIGGER IF EXISTS audit_row ON public.job_complaints;
CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON public.job_complaints FOR EACH ROW EXECUTE FUNCTION app_private.audit_row();

CREATE OR REPLACE FUNCTION public.resolve_complaint(target_company uuid, complaint uuid, note text DEFAULT NULL, reopen boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 UPDATE public.job_complaints SET status=CASE WHEN reopen THEN 'open' ELSE 'resolved' END,
  resolved_at=CASE WHEN reopen THEN NULL ELSE now() END, resolved_by=CASE WHEN reopen THEN NULL ELSE (SELECT auth.uid()) END,
  resolution_note=CASE WHEN reopen THEN resolution_note ELSE nullif(left(btrim(coalesce(note,'')),2000),'') END
 WHERE company_id=target_company AND id=complaint;
 IF NOT FOUND THEN RAISE EXCEPTION 'Complaint not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_complaint(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_complaint(uuid,uuid,text,boolean) TO authenticated;

-- The customer's "problem" page: just enough to greet them. No login; the link code is the key.
CREATE OR REPLACE FUNCTION public.get_feedback_context(token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE l public.customer_feedback_links%ROWTYPE; j public.jobs%ROWTYPE; first text;
BEGIN
 IF token IS NULL OR token !~ '^[A-Za-z0-9_-]{32,100}$' THEN RAISE EXCEPTION 'This link is not valid. Please call The Movers at 469-200-6699.'; END IF;
 SELECT * INTO l FROM public.customer_feedback_links WHERE token_hash=encode(sha256(convert_to(token,'UTF8')),'hex');
 IF NOT FOUND THEN RAISE EXCEPTION 'This link is not valid. Please call The Movers at 469-200-6699.'; END IF;
 SELECT * INTO j FROM public.jobs WHERE company_id=l.company_id AND id=l.job_id;
 SELECT coalesce(nullif(c.first_name,''),split_part(c.name,' ',1)) INTO first FROM public.customers c WHERE c.company_id=j.company_id AND c.id=j.customer_id;
 RETURN jsonb_build_object('first_name',coalesce(first,split_part(j.customer_name,' ',1)),'move_date',j.move_date,
  'sent_count',(SELECT count(*) FROM public.job_complaints k WHERE k.company_id=l.company_id AND k.job_id=l.job_id AND k.created_at>now()-interval '1 day'));
END;
$$;
REVOKE ALL ON FUNCTION public.get_feedback_context(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_feedback_context(text) TO anon,authenticated;

-- Jobs due for the automatic thank-you email (called by the Edge Function with the service key).
CREATE OR REPLACE FUNCTION public.due_review_jobs(max_rows integer DEFAULT 20)
RETURNS TABLE(company_id uuid, job_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT j.company_id,j.id FROM public.jobs j
 JOIN public.company_settings s ON s.company_id=j.company_id AND s.auto_review_emails
 JOIN public.companies co ON co.id=j.company_id
 JOIN public.customers c ON c.company_id=j.company_id AND c.id=j.customer_id
 WHERE j.status='completed' AND j.actual_end_at IS NOT NULL
  AND j.actual_end_at<=now()-interval '24 hours' AND j.actual_end_at>now()-interval '7 days'
  AND extract(hour FROM now() AT TIME ZONE coalesce(co.timezone,'America/Chicago')) BETWEEN 9 AND 18
  AND btrim(coalesce(c.email,''))<>'' AND NOT coalesce(c.email_opt_out,false)
  AND NOT EXISTS(SELECT 1 FROM public.customer_emails e WHERE e.company_id=j.company_id AND e.job_id=j.id AND e.kind='review' AND e.status='sent')
  AND (SELECT count(*) FROM public.customer_emails e WHERE e.company_id=j.company_id AND e.job_id=j.id AND e.kind='review' AND e.status='failed')<3
 ORDER BY j.actual_end_at LIMIT greatest(1,least(coalesce(max_rows,20),100));
$$;
REVOKE ALL ON FUNCTION public.due_review_jobs(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.due_review_jobs(integer) TO service_role;

-- Scheduler plumbing. Only where pg_cron, pg_net and Vault exist (Supabase); skipped in local tests.
DO $do$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='pg_cron') AND EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='pg_net') THEN
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
 END IF;
END $do$;

CREATE OR REPLACE FUNCTION public.cron_secret_ok(secret text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s text;
BEGIN
 IF to_regclass('vault.decrypted_secrets') IS NULL OR coalesce(secret,'')='' THEN RETURN false; END IF;
 EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=''movers_cron_secret'' LIMIT 1' INTO s;
 RETURN s IS NOT NULL AND s=secret;
END;
$$;
REVOKE ALL ON FUNCTION public.cron_secret_ok(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cron_secret_ok(text) TO service_role;

-- Turns the every-15-minutes check on or off. function_url/site come from the Edge Function (service key only).
CREATE OR REPLACE FUNCTION public.configure_review_schedule(target_company uuid, enabled boolean, function_url text, site text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE cmd text;
BEGIN
 UPDATE public.company_settings SET auto_review_emails=enabled WHERE company_id=target_company;
 IF to_regnamespace('cron') IS NULL OR to_regnamespace('net') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN RETURN 'saved (no scheduler here)'; END IF;
 IF function_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/movers-customer-email$' OR site !~ '^https://[a-z0-9.-]+/$' THEN RAISE EXCEPTION 'Invalid scheduler address'; END IF;
 IF enabled OR EXISTS(SELECT 1 FROM public.company_settings WHERE auto_review_emails) THEN
  EXECUTE 'SELECT 1 FROM vault.decrypted_secrets WHERE name=''movers_cron_secret''';
  IF NOT FOUND THEN EXECUTE 'SELECT vault.create_secret($1,''movers_cron_secret'',''Header the review scheduler sends to movers-customer-email'')' USING encode(extensions.gen_random_bytes(32),'hex'); END IF;
  cmd:=format($c$SELECT net.http_post(url:=%L,body:=%L::jsonb,headers:=jsonb_build_object('Content-Type','application/json','x-movers-cron',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='movers_cron_secret')),timeout_milliseconds:=60000)$c$,
   function_url,jsonb_build_object('mode','scheduled','site',site)::text);
  EXECUTE 'SELECT cron.schedule(''movers-review-emails'',''*/15 * * * *'',$1)' USING cmd;
  RETURN 'scheduled';
 ELSE
  EXECUTE 'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname=''movers-review-emails''';
  RETURN 'unscheduled';
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.configure_review_schedule(uuid,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.configure_review_schedule(uuid,boolean,text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Automatic review emails and complaints ready' AS result;
