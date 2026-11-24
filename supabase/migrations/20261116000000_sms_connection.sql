-- SMS connection test only. No customer automation or scheduler is enabled.
BEGIN;
CREATE TABLE IF NOT EXISTS public.sms_test_connections (
 company_id uuid PRIMARY KEY REFERENCES public.companies(id),
 test_phone text CHECK(test_phone ~ '^\+1[2-9][0-9]{9}$')
);
INSERT INTO public.sms_test_connections(company_id) SELECT id FROM public.companies WHERE slug='the-movers' ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.sms_test_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES public.companies(id),
 request_id uuid NOT NULL,to_phone text NOT NULL,body text NOT NULL,
 direction text NOT NULL CHECK(direction IN ('outbound','inbound')),
 status text NOT NULL,provider_sid text UNIQUE,error_code text,
 created_by uuid REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,request_id)
);
CREATE TABLE IF NOT EXISTS public.sms_suppressions (
 company_id uuid NOT NULL REFERENCES public.companies(id),phone text NOT NULL,blocked boolean NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(company_id,phone)
);
ALTER TABLE public.sms_test_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_test_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_test_connections,public.sms_test_messages,public.sms_suppressions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.sms_test_connections,public.sms_test_messages,public.sms_suppressions TO authenticated;
GRANT ALL ON public.sms_test_connections,public.sms_test_messages,public.sms_suppressions TO service_role;
DROP POLICY IF EXISTS sms_connection_read ON public.sms_test_connections;
CREATE POLICY sms_connection_read ON public.sms_test_connections FOR SELECT TO authenticated USING(app_private.is_office(company_id));
DROP POLICY IF EXISTS sms_messages_read ON public.sms_test_messages;
CREATE POLICY sms_messages_read ON public.sms_test_messages FOR SELECT TO authenticated USING(app_private.is_office(company_id));
DROP POLICY IF EXISTS sms_suppression_read ON public.sms_suppressions;
CREATE POLICY sms_suppression_read ON public.sms_suppressions FOR SELECT TO authenticated USING(app_private.is_office(company_id));
CREATE OR REPLACE FUNCTION public.set_sms_test_phone(target_company uuid,phone text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT app_private.is_office(target_company) OR NOT EXISTS(SELECT 1 FROM public.sms_test_connections WHERE company_id=target_company) THEN RAISE EXCEPTION 'Office access to this SMS connection is required'; END IF;
 IF phone IS NULL OR phone !~ '^\+1[2-9][0-9]{9}$' THEN RAISE EXCEPTION 'Enter a US phone number as +1 followed by 10 digits'; END IF;
 UPDATE public.sms_test_connections SET test_phone=phone WHERE company_id=target_company;
END; $$;
CREATE OR REPLACE FUNCTION public.reserve_sms_test(target_company uuid,test_request uuid,expected_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p text;old public.sms_test_messages%ROWTYPE;j uuid;
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 IF test_request IS NULL THEN RAISE EXCEPTION 'Request ID required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(target_company::text||'/sms-test',0));
 SELECT * INTO old FROM public.sms_test_messages WHERE company_id=target_company AND request_id=test_request;
 IF FOUND THEN
 IF old.to_phone IS DISTINCT FROM expected_phone THEN RAISE EXCEPTION 'Test recipient changed. Start a new test request.'; END IF;
 RETURN jsonb_build_object('id',old.id,'created',false,'status',old.status); END IF;
 SELECT test_phone INTO p FROM public.sms_test_connections WHERE company_id=target_company FOR UPDATE;
 IF NOT FOUND OR p IS NULL THEN RAISE EXCEPTION 'Save your own test phone number first'; END IF;
 IF p IS DISTINCT FROM expected_phone THEN RAISE EXCEPTION 'The saved test number changed. Refresh and confirm the recipient again.'; END IF;
 IF EXISTS(SELECT 1 FROM public.sms_suppressions WHERE company_id=target_company AND phone=p AND blocked) THEN RAISE EXCEPTION 'This number opted out. Text START to the Twilio number to enroll again; do not override STOP here.'; END IF;
 IF EXISTS(SELECT 1 FROM public.sms_test_messages WHERE company_id=target_company AND direction='outbound' AND created_at>now()-interval '1 minute') THEN RAISE EXCEPTION 'Wait one minute between tests'; END IF;
 IF (SELECT count(*) FROM public.sms_test_messages WHERE company_id=target_company AND direction='outbound' AND created_at>now()-interval '24 hours')>=10 THEN RAISE EXCEPTION 'Test limit reached: 10 requests per 24 hours'; END IF;
 INSERT INTO public.sms_test_messages(company_id,request_id,to_phone,body,direction,status,created_by)
 VALUES(target_company,test_request,p,'The Movers: This is a connection test for move updates. Msg & data rates may apply. Reply HELP for help or STOP to unsubscribe.','outbound','reserved',auth.uid()) RETURNING id INTO j;
 RETURN jsonb_build_object('id',j,'created',true,'phone',p,'body','The Movers: This is a connection test for move updates. Msg & data rates may apply. Reply HELP for help or STOP to unsubscribe.');
END; $$;
-- Only the server may report provider results or accept signed webhook events.
CREATE OR REPLACE FUNCTION public.finish_sms_test(message_id uuid,message_sid text,new_status text,provider_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF new_status NOT IN ('queued','accepted','sending','sent','delivered','undelivered','failed','unknown') THEN RAISE EXCEPTION 'Invalid message status'; END IF;
 UPDATE public.sms_test_messages SET provider_sid=coalesce(provider_sid,message_sid),status=CASE
 WHEN status IN ('delivered','undelivered','failed') THEN status
 WHEN new_status='unknown' AND status<>'reserved' THEN status
 WHEN new_status IN ('accepted','queued') AND status NOT IN ('reserved','unknown','accepted','queued') THEN status
 WHEN new_status='sending' AND status='sent' THEN status ELSE new_status END,
 error_code=CASE WHEN status IN ('delivered','undelivered','failed') THEN error_code ELSE coalesce(provider_error,error_code) END,updated_at=now()
 WHERE id=message_id AND direction='outbound' AND (provider_sid IS NULL OR provider_sid=message_sid OR message_sid IS NULL);
END; $$;
CREATE OR REPLACE FUNCTION public.record_sms_test_reply(target_company uuid,message_sid text,phone text,message_body text,opt_event text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Only accept test-related inbound numbers, never create a customer or consent record from a reply.
 IF NOT EXISTS(SELECT 1 FROM public.sms_test_connections WHERE company_id=target_company AND test_phone=phone)
 AND NOT EXISTS(SELECT 1 FROM public.sms_test_messages WHERE company_id=target_company AND to_phone=phone AND direction='outbound') THEN RETURN; END IF;
 INSERT INTO public.sms_test_messages(company_id,request_id,to_phone,body,direction,status,provider_sid)
 VALUES(target_company,gen_random_uuid(),phone,left(message_body,4000),'inbound','received',message_sid) ON CONFLICT(provider_sid) DO NOTHING;
 -- Provider retries must not reverse a later STOP/START state.
 IF NOT FOUND THEN RETURN; END IF;
 IF opt_event IN ('STOP','START') THEN
 INSERT INTO public.sms_suppressions(company_id,phone,blocked) VALUES(target_company,phone,opt_event='STOP')
 ON CONFLICT ON CONSTRAINT sms_suppressions_pkey DO UPDATE SET blocked=excluded.blocked,updated_at=now();
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.set_sms_test_phone(uuid,text),public.reserve_sms_test(uuid,uuid,text),public.finish_sms_test(uuid,text,text,text),public.record_sms_test_reply(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_sms_test_phone(uuid,text),public.reserve_sms_test(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_sms_test(uuid,text,text,text),public.record_sms_test_reply(uuid,text,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT 'SMS connection test ready' AS result;
