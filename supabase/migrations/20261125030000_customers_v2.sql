-- Phase 1A: customers v2. Run after 20261125020000_staff_separation.sql. Safe to run again; keeps all data.
--  * first/last name (existing names split automatically), second phone, referral source, repeat/VIP tags
--  * customers.name stays the full display name, kept in sync by a trigger (jobs/old code keep working)
--  * save_customer(): office-only edit/create; renaming updates the name on open estimates/booked jobs
--    (completed/cancelled jobs keep the name they were done under)
--  * search_customers(): name, email, phone digits (either phone) or job address
--  * save_estimate / save_dispatch_job are wrapped: the original functions do pricing and saving unchanged,
--    then the new customer fields (first/last, phone 2, referral) are applied to the job's customer.
BEGIN;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS phone2 text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS referral_source text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='customers_referral_valid' AND conrelid='public.customers'::regclass) THEN
  ALTER TABLE public.customers ADD CONSTRAINT customers_referral_valid CHECK (referral_source IN
   ('google','facebook','instagram','yelp','nextdoor','friend_family','realtor','apartment_manager','repeat_customer','website','other'));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='customers_tags_valid' AND conrelid='public.customers'::regclass) THEN
  ALTER TABLE public.customers ADD CONSTRAINT customers_tags_valid CHECK (tags <@ ARRAY['repeat','vip']::text[]);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='customers_name_parts_len' AND conrelid='public.customers'::regclass) THEN
  ALTER TABLE public.customers ADD CONSTRAINT customers_name_parts_len CHECK (length(first_name)<=100 AND length(last_name)<=100 AND length(phone2)<=40);
 END IF;
END $$;

-- Keep name <-> first/last consistent. Editing first/last rebuilds name; old code that only sets name
-- (e.g. save_estimate) gets it split: last word = last name, the rest = first name.
CREATE OR REPLACE FUNCTION app_private.customer_name_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE parts_changed boolean; n text;
BEGIN
 parts_changed := TG_OP='INSERT' AND (NEW.first_name IS NOT NULL OR NEW.last_name IS NOT NULL)
  OR TG_OP='UPDATE' AND (NEW.first_name IS DISTINCT FROM OLD.first_name OR NEW.last_name IS DISTINCT FROM OLD.last_name);
 NEW.first_name := nullif(btrim(NEW.first_name),''); NEW.last_name := nullif(btrim(NEW.last_name),'');
 IF parts_changed AND NEW.first_name IS NOT NULL THEN
  NEW.name := concat_ws(' ', NEW.first_name, NEW.last_name);
 ELSIF TG_OP='INSERT' OR NEW.name IS DISTINCT FROM OLD.name OR NEW.first_name IS NULL THEN
  n := regexp_replace(btrim(NEW.name),'\s+',' ','g');
  IF position(' ' in n)>0 THEN
   NEW.first_name := regexp_replace(n,' [^ ]+$',''); NEW.last_name := substring(n from '[^ ]+$');
  ELSE NEW.first_name := n; NEW.last_name := NULL; END IF;
 END IF;
 NEW.phone2 := coalesce(app_private.normalize_us_phone(NEW.phone2), nullif(btrim(NEW.phone2),''));
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.customer_name_sync() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS customer_name_sync ON public.customers;
CREATE TRIGGER customer_name_sync BEFORE INSERT OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION app_private.customer_name_sync();
-- Split names already saved (no-op for rows already split).
UPDATE public.customers SET name=name WHERE first_name IS NULL;

-- Create or edit a customer from the Customers screen.
CREATE OR REPLACE FUNCTION public.save_customer(target_company uuid, payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c uuid; fn text; ln text; em text; ref text; tg text[]; full_name text;
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 fn := btrim(coalesce(payload->>'first_name','')); ln := nullif(btrim(coalesce(payload->>'last_name','')),'');
 IF length(fn) NOT BETWEEN 1 AND 100 OR length(coalesce(ln,'')) > 100 THEN RAISE EXCEPTION 'Enter a first name (last name optional, maximum 100 characters each)'; END IF;
 em := nullif(lower(btrim(coalesce(payload->>'email',''))),'');
 IF em IS NOT NULL AND em !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' THEN RAISE EXCEPTION 'Enter a valid email address'; END IF;
 ref := nullif(payload->>'referral_source','');
 SELECT coalesce(array_agg(DISTINCT t ORDER BY t),'{}') INTO tg FROM jsonb_array_elements_text(coalesce(payload->'tags','[]'::jsonb)) t;
 IF NOT (tg <@ ARRAY['repeat','vip']::text[]) THEN RAISE EXCEPTION 'Unknown customer tag'; END IF;
 c := nullif(payload->>'id','')::uuid;
 IF c IS NULL THEN
  INSERT INTO public.customers(company_id,name,first_name,last_name,email,phone,phone2,referral_source,tags,office_notes)
  VALUES (target_company,concat_ws(' ',fn,ln),fn,ln,em,nullif(btrim(payload->>'phone'),''),nullif(btrim(payload->>'phone2'),''),ref,tg,nullif(btrim(payload->>'office_notes'),''))
  RETURNING id INTO c;
 ELSE
  UPDATE public.customers SET first_name=fn,last_name=ln,email=em,phone=nullif(btrim(payload->>'phone'),''),phone2=nullif(btrim(payload->>'phone2'),''),
   referral_source=ref,tags=tg,office_notes=nullif(btrim(payload->>'office_notes'),'')
  WHERE company_id=target_company AND id=c RETURNING name INTO full_name;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found in this company'; END IF;
  UPDATE public.jobs SET customer_name=full_name
   WHERE company_id=target_company AND customer_id=c AND status IN ('estimate','booked') AND customer_name IS DISTINCT FROM full_name;
 END IF;
 RETURN c;
END;
$$;
REVOKE ALL ON FUNCTION public.save_customer(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_customer(uuid,jsonb) TO authenticated;

-- Search by name, email, either phone (digits only, at least 3) or any job address. Empty search = everyone.
CREATE OR REPLACE FUNCTION public.search_customers(target_company uuid, query text DEFAULT '', max_rows integer DEFAULT 200)
RETURNS TABLE(id uuid, name text, first_name text, last_name text, email text, phone text, phone2 text, referral_source text,
 tags text[], office_notes text, job_count bigint, last_move_date date, total_matches bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE q text; pat text; digits text;
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 q := btrim(coalesce(query,''));
 pat := '%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%';
 digits := regexp_replace(q,'[^0-9]','','g');
 IF length(digits)=11 AND left(digits,1)='1' THEN digits := substring(digits from 2); END IF;
 RETURN QUERY
 SELECT c.id,c.name,c.first_name,c.last_name,c.email,c.phone,c.phone2,c.referral_source,c.tags,c.office_notes,
  (SELECT count(*) FROM public.jobs j WHERE j.company_id=c.company_id AND j.customer_id=c.id),
  (SELECT max(j.move_date) FROM public.jobs j WHERE j.company_id=c.company_id AND j.customer_id=c.id AND j.status<>'cancelled'),
  count(*) OVER ()
 FROM public.customers c
 WHERE c.company_id=target_company AND (
  q='' OR c.name ILIKE pat OR c.email ILIKE pat
  OR (length(digits)>=3 AND (regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') LIKE '%'||digits||'%' OR regexp_replace(coalesce(c.phone2,''),'[^0-9]','','g') LIKE '%'||digits||'%'))
  OR EXISTS(SELECT 1 FROM public.jobs j WHERE j.company_id=c.company_id AND j.customer_id=c.id AND (j.pick_up_address ILIKE pat OR j.drop_off_address ILIKE pat)))
 ORDER BY c.last_name NULLS LAST, c.first_name, c.id
 LIMIT greatest(1,least(coalesce(max_rows,200),500));
END;
$$;
REVOKE ALL ON FUNCTION public.search_customers(uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.search_customers(uuid,text,integer) TO authenticated;

-- Apply estimate-form customer fields to the job's customer (used by the wrappers below).
CREATE OR REPLACE FUNCTION app_private.apply_customer_fields(target_company uuid, job uuid, payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c uuid; fn text; ln text; ref text;
BEGIN
 IF NOT (payload ? 'first_name' OR payload ? 'phone2' OR payload ? 'referral_source') THEN RETURN; END IF; -- older app: nothing new to apply
 SELECT customer_id INTO c FROM public.jobs WHERE company_id=target_company AND id=job;
 IF c IS NULL THEN RETURN; END IF;
 ref := nullif(payload->>'referral_source','');
 IF ref IS NOT NULL AND ref NOT IN ('google','facebook','instagram','yelp','nextdoor','friend_family','realtor','apartment_manager','repeat_customer','website','other') THEN
  RAISE EXCEPTION 'Unknown referral source'; END IF;
 IF payload ? 'first_name' THEN
  fn := btrim(coalesce(payload->>'first_name','')); ln := nullif(btrim(coalesce(payload->>'last_name','')),'');
  IF length(fn) NOT BETWEEN 1 AND 100 OR length(coalesce(ln,''))>100 THEN RAISE EXCEPTION 'Enter a first name (last name optional, maximum 100 characters each)'; END IF;
  UPDATE public.customers SET first_name=fn,last_name=ln WHERE company_id=target_company AND id=c;
  UPDATE public.jobs SET customer_name=concat_ws(' ',fn,ln) WHERE company_id=target_company AND id=job AND customer_name IS DISTINCT FROM concat_ws(' ',fn,ln);
 END IF;
 IF payload ? 'phone2' THEN UPDATE public.customers SET phone2=nullif(btrim(payload->>'phone2'),'') WHERE company_id=target_company AND id=c; END IF;
 IF payload ? 'referral_source' THEN UPDATE public.customers SET referral_source=ref WHERE company_id=target_company AND id=c; END IF;
END;
$$;
REVOKE ALL ON FUNCTION app_private.apply_customer_fields(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;

-- Wrap the two save functions once (rerunnable: only moves them the first time).
DO $$ BEGIN
 IF to_regprocedure('app_private.save_estimate_v1(uuid,jsonb)') IS NULL THEN
  ALTER FUNCTION public.save_estimate(uuid,jsonb) SET SCHEMA app_private;
  ALTER FUNCTION app_private.save_estimate(uuid,jsonb) RENAME TO save_estimate_v1;
 END IF;
 IF to_regprocedure('app_private.save_dispatch_job_v1(uuid,jsonb)') IS NULL THEN
  ALTER FUNCTION public.save_dispatch_job(uuid,jsonb) SET SCHEMA app_private;
  ALTER FUNCTION app_private.save_dispatch_job(uuid,jsonb) RENAME TO save_dispatch_job_v1;
 END IF;
END $$;
REVOKE ALL ON FUNCTION app_private.save_estimate_v1(uuid,jsonb), app_private.save_dispatch_job_v1(uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_estimate(target_company uuid, payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j uuid;
BEGIN
 j := app_private.save_estimate_v1(target_company, payload);
 PERFORM app_private.apply_customer_fields(target_company, j, payload);
 RETURN j;
END;
$$;
CREATE OR REPLACE FUNCTION public.save_dispatch_job(target_company uuid, payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j uuid;
BEGIN
 j := app_private.save_dispatch_job_v1(target_company, payload);
 PERFORM app_private.apply_customer_fields(target_company, j, payload);
 RETURN j;
END;
$$;
REVOKE ALL ON FUNCTION public.save_estimate(uuid,jsonb), public.save_dispatch_job(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_estimate(uuid,jsonb), public.save_dispatch_job(uuid,jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Customers v2 ready' AS result;
