-- Customer tags: add "referral" (owner request 2026-11-25) and let the estimate form set tags.
-- Run after 20261125030000_customers_v2.sql. Safe to run again; keeps all data.
BEGIN;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_tags_valid;
ALTER TABLE public.customers ADD CONSTRAINT customers_tags_valid CHECK (tags <@ ARRAY['repeat','vip','referral']::text[]);

CREATE OR REPLACE FUNCTION app_private.clean_customer_tags(payload jsonb)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE tg text[];
BEGIN
 SELECT coalesce(array_agg(DISTINCT t ORDER BY t),'{}') INTO tg FROM jsonb_array_elements_text(coalesce(payload->'tags','[]'::jsonb)) t;
 IF NOT (tg <@ ARRAY['repeat','vip','referral']::text[]) THEN RAISE EXCEPTION 'Unknown customer tag'; END IF;
 RETURN tg;
END;
$$;
REVOKE ALL ON FUNCTION app_private.clean_customer_tags(jsonb) FROM PUBLIC,anon,authenticated;

-- Same as 20261125030000, tags now validated by clean_customer_tags().
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
 tg := app_private.clean_customer_tags(payload);
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

-- Same as 20261125030000 plus tags from the estimate form.
CREATE OR REPLACE FUNCTION app_private.apply_customer_fields(target_company uuid, job uuid, payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c uuid; fn text; ln text; ref text;
BEGIN
 IF NOT (payload ? 'first_name' OR payload ? 'phone2' OR payload ? 'referral_source' OR payload ? 'tags') THEN RETURN; END IF;
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
 IF payload ? 'tags' THEN UPDATE public.customers SET tags=app_private.clean_customer_tags(payload) WHERE company_id=target_company AND id=c; END IF;
END;
$$;
REVOKE ALL ON FUNCTION app_private.apply_customer_fields(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Referral tag ready' AS result;
