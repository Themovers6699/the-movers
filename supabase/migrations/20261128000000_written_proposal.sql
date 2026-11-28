-- Written Proposal (owner request 2026-11-27). Run after 20261127030000_customer_emails.sql. Safe to run again.
--  * company_settings.proposal_terms: the *** terms from the owner's Written Proposal email, one per line, **bold**
--    marks words shown in bold, a blank line starts a new group. Office edits them with save_proposal_terms().
--  * job_proposals: one row per Written Proposal emailed (created by the movers-customer-email function). It keeps an
--    exact copy of what the customer saw and, once they click "I agree", who agreed, when and from where.
--  * get_proposal() / agree_to_proposal(): the customer's agreement page. No login: the link carries a long random
--    code; only its SHA-256 is stored. Only the newest proposal of a job can be agreed to.
BEGIN;
ALTER TABLE public.company_settings ADD COLUMN IF NOT EXISTS proposal_terms text NOT NULL DEFAULT '';
UPDATE public.company_settings SET proposal_terms=$terms$Please be sure to remove any **JEWELRY, WATCHES, GUNS, PERFUMES** or any **GLASS ITEMS** from dressers and nightstands before the movers arrive.
**ALL ITEMS** inside the **REFRIGERATORS** must be removed prior to us moving the **REFRIGERATOR.**
**CANCELLATIONS/RESCHEDULES** must be done **48 HOURS BEFORE** your scheduled move, with a maximum of **2 RESCHEDULES**, or your deposit will be forfeited.
Move is subject to cancellation if **DEPOSIT** is not paid within **3 DAYS.**
There is a **3% FEE** for all **DEBIT** or **CREDIT CARDS**.
We **DO NOT** accept **CHECKS** for moves that are delivered to **NON-RESIDENTIAL ADDRESSES.**
Additional fees for **PIANO** and/or **GUN SAFES.**
Due to safety reasons for **ALL** of our customers, if any roaches/bed bugs or animal feces are seen, we reserve the right to **NOT** load or move the items at our discretion.
To prevent injury, **CHILDREN** should not be present in or near the delivery room or access points, and **PETS** must be secured during pick-up/delivery.
**NO** customers are allowed **INSIDE** our moving trucks for **SAFETY REASONS.**
When **LOADING** a **TRUCK/POD** provided by the customer, please provide us with your own **ROPE/STRAPS** & **PLASTIC/PADS.** Our pricing for plastic is **$20/ROLL** & **$20/PAD.**
We need to check **TVs** before and after we move them to ensure they are in a working condition. Please keep the power cords accessible for our movers.
Customers should drain water from **PATIO FURNITURE**. Water can remain logged inside outdoor furniture and should be turned upside down to drain the water. We are not responsible for damages.
**GRILLS** may contain ash and grease in the grease trap and should be emptied before the movers arrive.
The best way to keep your mattress clean is to get **MATTRESS COVERS**. Our shrink wrap is not strong enough and will tear.
We are **NOT** responsible for damages to the **FLOOR** caused by **NAILS** sticking out of furniture feet.
We are only responsible for items transported in **OUR** vehicles, and will **NOT** be liable for items transported by client.
We do **NOT** remove **PROJECTORS** from the walls.

**NO REFUNDS AFTER THE SERVICES ARE RENDERED, ANY DAMAGE CLAIMS SHALL BE MADE IN ACCORDANCE TO THE RIGHTS & RESPONSIBILITIES PAMPHLET PROVIDED TO YOU IN THE PDF ATTACHMENT.**$terms$
WHERE proposal_terms='';

CREATE OR REPLACE FUNCTION public.save_proposal_terms(target_company uuid, terms text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 terms:=btrim(replace(coalesce(terms,''),E'\r',''));
 IF terms='' THEN RAISE EXCEPTION 'The terms cannot be empty'; END IF;
 IF length(terms)>20000 THEN RAISE EXCEPTION 'The terms are too long (20,000 characters at most)'; END IF;
 UPDATE public.company_settings SET proposal_terms=terms WHERE company_id=target_company;
END;
$$;
REVOKE ALL ON FUNCTION public.save_proposal_terms(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_proposal_terms(uuid,text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.job_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 job_id uuid NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
 content jsonb NOT NULL,
 to_email text NOT NULL,
 sent_at timestamptz NOT NULL DEFAULT now(),
 sent_by uuid,
 agreed_at timestamptz,
 agreed_name text,
 agreed_ip text,
 agreed_user_agent text,
 FOREIGN KEY (company_id,job_id) REFERENCES public.jobs(company_id,id)
);
CREATE INDEX IF NOT EXISTS job_proposals_job_idx ON public.job_proposals(company_id,job_id,sent_at DESC);
ALTER TABLE public.job_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_proposals FROM PUBLIC,anon,authenticated;
GRANT SELECT (id,company_id,job_id,content,to_email,sent_at,sent_by,agreed_at,agreed_name,agreed_ip,agreed_user_agent) ON public.job_proposals TO authenticated;
GRANT ALL ON public.job_proposals TO service_role;
DROP POLICY IF EXISTS job_proposals_read ON public.job_proposals;
CREATE POLICY job_proposals_read ON public.job_proposals FOR SELECT TO authenticated USING (app_private.is_office(company_id));
DROP TRIGGER IF EXISTS audit_row ON public.job_proposals;
CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON public.job_proposals FOR EACH ROW EXECUTE FUNCTION app_private.audit_row();

CREATE OR REPLACE FUNCTION public.get_proposal(token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.job_proposals%ROWTYPE; st text; newest boolean;
BEGIN
 IF token IS NULL OR token !~ '^[A-Za-z0-9_-]{32,100}$' THEN RAISE EXCEPTION 'This link is not valid. Please use the link in your latest email from The Movers.'; END IF;
 SELECT * INTO p FROM public.job_proposals WHERE token_hash=encode(sha256(convert_to(token,'UTF8')),'hex');
 IF NOT FOUND THEN RAISE EXCEPTION 'This link is not valid. Please use the link in your latest email from The Movers.'; END IF;
 SELECT status INTO st FROM public.jobs WHERE company_id=p.company_id AND id=p.job_id;
 newest:=NOT EXISTS(SELECT 1 FROM public.job_proposals o WHERE o.company_id=p.company_id AND o.job_id=p.job_id AND (o.sent_at,o.id)>(p.sent_at,p.id));
 RETURN jsonb_build_object('content',p.content,'sent_at',p.sent_at,'agreed_at',p.agreed_at,'agreed_name',p.agreed_name,'newest',newest,'job_status',st);
END;
$$;
REVOKE ALL ON FUNCTION public.get_proposal(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_proposal(text) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.agree_to_proposal(token text, signer_name text, user_agent text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.job_proposals%ROWTYPE; st text; ip text;
BEGIN
 IF token IS NULL OR token !~ '^[A-Za-z0-9_-]{32,100}$' THEN RAISE EXCEPTION 'This link is not valid. Please use the link in your latest email from The Movers.'; END IF;
 signer_name:=btrim(regexp_replace(coalesce(signer_name,''),'\s+',' ','g'));
 IF length(signer_name)<2 OR length(signer_name)>100 THEN RAISE EXCEPTION 'Please type your full name'; END IF;
 SELECT * INTO p FROM public.job_proposals WHERE token_hash=encode(sha256(convert_to(token,'UTF8')),'hex') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'This link is not valid. Please use the link in your latest email from The Movers.'; END IF;
 IF p.agreed_at IS NOT NULL THEN RETURN jsonb_build_object('agreed_at',p.agreed_at,'agreed_name',p.agreed_name); END IF;
 IF EXISTS(SELECT 1 FROM public.job_proposals o WHERE o.company_id=p.company_id AND o.job_id=p.job_id AND (o.sent_at,o.id)>(p.sent_at,p.id)) THEN
  RAISE EXCEPTION 'This proposal was replaced by a newer one. Please open the link in your latest email from The Movers.'; END IF;
 SELECT status INTO st FROM public.jobs WHERE company_id=p.company_id AND id=p.job_id;
 IF st IS DISTINCT FROM 'booked' THEN RAISE EXCEPTION 'This move can no longer be confirmed online. Please call The Movers at 469-200-6699.'; END IF;
 ip:=left(btrim(split_part(coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-forwarded-for',''),',',1)),100);
 UPDATE public.job_proposals SET agreed_at=now(),agreed_name=signer_name,agreed_ip=nullif(ip,''),agreed_user_agent=left(user_agent,300)
 WHERE id=p.id RETURNING * INTO p;
 RETURN jsonb_build_object('agreed_at',p.agreed_at,'agreed_name',p.agreed_name);
END;
$$;
REVOKE ALL ON FUNCTION public.agree_to_proposal(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.agree_to_proposal(text,text,text) TO anon,authenticated;

ALTER TABLE public.customer_emails DROP CONSTRAINT IF EXISTS customer_emails_kind_check;
ALTER TABLE public.customer_emails ADD CONSTRAINT customer_emails_kind_check CHECK (kind IN ('estimate','confirmation','proposal'));
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Written Proposal ready' AS result;
