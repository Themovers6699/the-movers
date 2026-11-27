-- Fields for importing the Square customer export and the old move-history spreadsheet (Phase 4).
-- Run after 20261126000000_pricing_settings.sql. Safe to run again; keeps all data.
--  * customers: square_customer_id (link to Square later, no duplicates), email_opt_out (Square unsubscribed/bounced:
--    never send marketing email), square_history (visits/spend summary, read-only), needs_contact_info,
--    import_batch_id (every imported row is tagged so a whole import can be undone)
--  * jobs: import_batch_id, import_note (e.g. "Price unknown in the old spreadsheet")
BEGIN;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS square_customer_id text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS email_opt_out boolean NOT NULL DEFAULT false;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS square_history jsonb;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS needs_contact_info boolean NOT NULL DEFAULT false;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS import_batch_id uuid;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS import_batch_id uuid;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS import_note text;
CREATE UNIQUE INDEX IF NOT EXISTS customers_square_id_uniq ON public.customers(company_id,square_customer_id) WHERE square_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_import_batch_idx ON public.customers(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_import_batch_idx ON public.jobs(import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_customer_idx ON public.jobs(company_id,customer_id);

-- Undo one import completely (dashboard/server only). Refuses if anything was added to those records since
-- (payments, photos, time, assignments, add-ons) so real work is never thrown away.
CREATE OR REPLACE FUNCTION public.undo_import(batch uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE nj bigint; nc bigint;
BEGIN
 IF EXISTS(SELECT 1 FROM public.payment_records p JOIN public.jobs j ON j.company_id=p.company_id AND j.id=p.job_id WHERE j.import_batch_id=batch)
  OR EXISTS(SELECT 1 FROM public.job_photos p JOIN public.jobs j ON j.company_id=p.company_id AND j.id=p.job_id WHERE j.import_batch_id=batch)
  OR EXISTS(SELECT 1 FROM public.time_entries t JOIN public.jobs j ON j.company_id=t.company_id AND j.id=t.job_id WHERE j.import_batch_id=batch)
  OR EXISTS(SELECT 1 FROM public.job_assignments a JOIN public.jobs j ON j.company_id=a.company_id AND j.id=a.job_id WHERE j.import_batch_id=batch)
  OR EXISTS(SELECT 1 FROM public.job_line_items l JOIN public.jobs j ON j.company_id=l.company_id AND j.id=l.job_id WHERE j.import_batch_id=batch)
  OR EXISTS(SELECT 1 FROM public.jobs j JOIN public.customers c ON c.company_id=j.company_id AND c.id=j.customer_id WHERE c.import_batch_id=batch AND j.import_batch_id IS DISTINCT FROM batch)
 THEN RAISE EXCEPTION 'This import has been worked on since (payments, photos, time, crew, add-ons or new jobs). Not undoing automatically.'; END IF;
 DELETE FROM public.job_stops s USING public.jobs j WHERE j.company_id=s.company_id AND j.id=s.job_id AND j.import_batch_id=batch;
 DELETE FROM public.job_office_notes n USING public.jobs j WHERE j.company_id=n.company_id AND j.id=n.job_id AND j.import_batch_id=batch;
 DELETE FROM public.jobs WHERE import_batch_id=batch; GET DIAGNOSTICS nj = ROW_COUNT;
 DELETE FROM public.customers WHERE import_batch_id=batch; GET DIAGNOSTICS nc = ROW_COUNT;
 RETURN format('Removed %s jobs and %s customers from import %s', nj, nc, batch);
END;
$$;
REVOKE ALL ON FUNCTION public.undo_import(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.undo_import(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Import fields ready' AS result;
