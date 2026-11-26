-- Pricing settings, add-ons and manual service charge (owner request 2026-11-26). Run after 20261125070000. Safe to run again.
--  * price_items: the company's add-on price list (fees like piano / gun safe, packing materials). Never deleted, only
--    switched off, so old quotes stay readable. Seeded for each company at $0 for the office to fill in.
--  * job_line_items: add-ons on a job with the name, unit and price AS QUOTED (price-list changes don't alter old quotes)
--  * jobs.add_ons_cents, jobs.service_charge_manual (service charge typed in when mileage is unknown)
--  * save_pricing(): crew rates (1-10 movers) + general pricing rules; save_price_items(): the add-on list.
--    Owner decision: owner AND office admins may edit. Direct table writes revoked; everything audited.
--  * Wrapped save_estimate / save_dispatch_job also apply add-ons and the manual service charge, then recompute
--    the quoted total (labor + service charge + add-ons) and the out-of-town deposit.
BEGIN;

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS add_ons_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS service_charge_manual boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.price_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
 category text NOT NULL CHECK (category IN ('fee','material')),
 unit_label text NOT NULL DEFAULT 'each' CHECK (length(btrim(unit_label)) BETWEEN 1 AND 20),
 unit_price_cents bigint NOT NULL DEFAULT 0 CHECK (unit_price_cents BETWEEN 0 AND 10000000),
 active boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL DEFAULT 0,
 UNIQUE (company_id,id)
);
CREATE TABLE IF NOT EXISTS public.job_line_items (
 company_id uuid NOT NULL,
 job_id uuid NOT NULL,
 position smallint NOT NULL CHECK (position BETWEEN 1 AND 30),
 item_id uuid,
 name text NOT NULL,
 unit_label text NOT NULL,
 unit_price_cents bigint NOT NULL CHECK (unit_price_cents>=0),
 quantity numeric(10,2) NOT NULL CHECK (quantity>0 AND quantity<=1000),
 total_cents bigint NOT NULL CHECK (total_cents>=0),
 PRIMARY KEY (company_id,job_id,position),
 FOREIGN KEY (company_id,job_id) REFERENCES public.jobs(company_id,id),
 FOREIGN KEY (company_id,item_id) REFERENCES public.price_items(company_id,id)
);
ALTER TABLE public.price_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_line_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.price_items,public.job_line_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.price_items,public.job_line_items TO authenticated;
GRANT ALL ON public.price_items,public.job_line_items TO service_role;
DROP POLICY IF EXISTS price_items_read ON public.price_items;
-- Crew will need the price list for the bill of lading (Phase 2), so every active member can read it.
CREATE POLICY price_items_read ON public.price_items FOR SELECT TO authenticated USING (app_private.is_member(company_id));
DROP POLICY IF EXISTS job_line_items_read ON public.job_line_items;
CREATE POLICY job_line_items_read ON public.job_line_items FOR SELECT TO authenticated USING (app_private.can_view_job(company_id,job_id));
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['price_items','job_line_items'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS audit_row ON public.%I', t);
  EXECUTE format('CREATE TRIGGER audit_row AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app_private.audit_row()', t);
 END LOOP;
END $$;

-- Starter price list ($0 placeholders) for companies that don't have one yet.
INSERT INTO public.price_items(company_id,name,category,unit_label,sort_order)
SELECT c.id,v.name,v.category,v.unit,v.ord FROM public.companies c
CROSS JOIN (VALUES ('Piano','fee','each',1),('Gun safe','fee','each',2),
 ('Small box (S-box)','material','each',10),('Medium box (M-box)','material','each',11),('Large box (L-box)','material','each',12),
 ('Dish pack (D-box)','material','each',13),('Wardrobe box (W-box)','material','each',14),
 ('Packing paper','material','bundle',15),('Bubble wrap','material','roll',16),('Tape','material','roll',17)) v(name,category,unit,ord)
WHERE NOT EXISTS (SELECT 1 FROM public.price_items p WHERE p.company_id=c.id);

-- Settings page writes go through the functions below.
REVOKE INSERT,UPDATE,DELETE ON public.crew_rates,public.company_settings FROM authenticated;

CREATE OR REPLACE FUNCTION public.save_pricing(target_company uuid, payload jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s jsonb; r jsonb; sizes integer[]; k integer := 0;
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 s := payload->'settings';
 IF s IS NOT NULL THEN
  IF length(btrim(coalesce(s->>'depot_address',''))) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'Enter the depot address'; END IF;
  IF (s->>'minimum_minutes')::int NOT BETWEEN 15 AND 1440 THEN RAISE EXCEPTION 'Minimum hours must be between 0.25 and 24'; END IF;
  IF (s->>'billing_increment_minutes')::int NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Billing increment must be 1 to 120 minutes'; END IF;
  IF (s->>'standard_deposit_cents')::bigint NOT BETWEEN 0 AND 10000000 THEN RAISE EXCEPTION 'Enter a valid standard deposit'; END IF;
  IF (s->>'out_of_town_deposit_percent')::numeric NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Out-of-town deposit must be 0 to 100 percent'; END IF;
  UPDATE public.company_settings SET depot_address=btrim(s->>'depot_address'),minimum_minutes=(s->>'minimum_minutes')::int,
   billing_increment_minutes=(s->>'billing_increment_minutes')::int,standard_deposit_cents=(s->>'standard_deposit_cents')::bigint,
   out_of_town_deposit_percent=(s->>'out_of_town_deposit_percent')::numeric
  WHERE company_id=target_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Company settings not found'; END IF;
 END IF;
 IF payload ? 'rates' THEN
  IF jsonb_typeof(payload->'rates')<>'array' OR jsonb_array_length(payload->'rates') NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Keep between 1 and 10 crew sizes'; END IF;
  SELECT array_agg((e->>'crew_size')::int) INTO sizes FROM jsonb_array_elements(payload->'rates') e;
  IF (SELECT count(DISTINCT x) FROM unnest(sizes) x) <> cardinality(sizes) THEN RAISE EXCEPTION 'Each crew size can only appear once'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(payload->'rates') LOOP
   k := k+1;
   IF (r->>'crew_size')::int NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Row %: crew size must be 1 to 10 movers', k; END IF;
   IF (r->>'weekday_rate_cents')::bigint NOT BETWEEN 0 AND 100000 OR (r->>'weekend_rate_cents')::bigint NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION '% movers: hourly rates must be $0 to $1,000', r->>'crew_size'; END IF;
   IF (r->>'service_base_cents')::bigint NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION '% movers: service charge base must be $0 to $10,000', r->>'crew_size'; END IF;
   IF (r->>'service_cents_per_mile')::int NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION '% movers: per-mile amount must be $0 to $100', r->>'crew_size'; END IF;
   IF (r->>'round_service_up_to_cents')::int NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION '% movers: rounding must be $0.01 to $100', r->>'crew_size'; END IF;
   INSERT INTO public.crew_rates(company_id,crew_size,weekday_rate_cents,weekend_rate_cents,service_base_cents,service_cents_per_mile,round_service_up_to_cents)
   VALUES (target_company,(r->>'crew_size')::int,(r->>'weekday_rate_cents')::bigint,(r->>'weekend_rate_cents')::bigint,(r->>'service_base_cents')::bigint,(r->>'service_cents_per_mile')::int,(r->>'round_service_up_to_cents')::int)
   ON CONFLICT (company_id,crew_size) DO UPDATE SET weekday_rate_cents=excluded.weekday_rate_cents,weekend_rate_cents=excluded.weekend_rate_cents,
    service_base_cents=excluded.service_base_cents,service_cents_per_mile=excluded.service_cents_per_mile,round_service_up_to_cents=excluded.round_service_up_to_cents
   WHERE (crew_rates.weekday_rate_cents,crew_rates.weekend_rate_cents,crew_rates.service_base_cents,crew_rates.service_cents_per_mile,crew_rates.round_service_up_to_cents)
     IS DISTINCT FROM (excluded.weekday_rate_cents,excluded.weekend_rate_cents,excluded.service_base_cents,excluded.service_cents_per_mile,excluded.round_service_up_to_cents);
  END LOOP;
  DELETE FROM public.crew_rates WHERE company_id=target_company AND NOT (crew_size = ANY(sizes));
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.save_pricing(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_pricing(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_price_items(target_company uuid, items jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e jsonb; ord integer := 0; iid uuid;
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 IF jsonb_typeof(items)<>'array' OR jsonb_array_length(items)>100 THEN RAISE EXCEPTION 'Keep up to 100 add-ons'; END IF;
 FOR e IN SELECT * FROM jsonb_array_elements(items) LOOP
  ord := ord+1;
  IF length(btrim(coalesce(e->>'name',''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Add-on %: enter a name', ord; END IF;
  IF coalesce(e->>'category','') NOT IN ('fee','material') THEN RAISE EXCEPTION 'Add-on %: choose fee or packing material', ord; END IF;
  IF length(btrim(coalesce(e->>'unit_label','each'))) NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Add-on %: unit is too long', ord; END IF;
  IF coalesce((e->>'unit_price_cents')::bigint,-1) NOT BETWEEN 0 AND 10000000 THEN RAISE EXCEPTION 'Add-on %: enter a price between $0 and $100,000', ord; END IF;
  iid := nullif(e->>'id','')::uuid;
  IF iid IS NULL THEN
   INSERT INTO public.price_items(company_id,name,category,unit_label,unit_price_cents,active,sort_order)
   VALUES (target_company,btrim(e->>'name'),e->>'category',btrim(coalesce(e->>'unit_label','each')),(e->>'unit_price_cents')::bigint,coalesce((e->>'active')::boolean,true),ord);
  ELSE
   UPDATE public.price_items SET name=btrim(e->>'name'),category=e->>'category',unit_label=btrim(coalesce(e->>'unit_label','each')),
    unit_price_cents=(e->>'unit_price_cents')::bigint,active=coalesce((e->>'active')::boolean,true),sort_order=ord
   WHERE company_id=target_company AND id=iid
    AND (name,category,unit_label,unit_price_cents,active,sort_order) IS DISTINCT FROM (btrim(e->>'name'),e->>'category',btrim(coalesce(e->>'unit_label','each')),(e->>'unit_price_cents')::bigint,coalesce((e->>'active')::boolean,true),ord);
   IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM public.price_items WHERE company_id=target_company AND id=iid) THEN RAISE EXCEPTION 'Add-on % not found', ord; END IF;
  END IF;
 END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.save_price_items(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_price_items(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.stored_line_items(target_company uuid, job uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('position',position,'item_id',item_id,'name',name,'unit_label',unit_label,
  'unit_price_cents',unit_price_cents,'quantity',quantity,'total_cents',total_cents) ORDER BY position),'[]'::jsonb)
 FROM public.job_line_items WHERE company_id=target_company AND job_id=job;
$$;
REVOKE ALL ON FUNCTION app_private.stored_line_items(uuid,uuid) FROM PUBLIC,anon,authenticated;

-- Add-ons + manual service charge, then recompute total and out-of-town deposit. Called by the save wrappers
-- after the original pricing ran. prior_* = the job's manual service charge before this save (kept when an
-- older app version saves without the new fields).
CREATE OR REPLACE FUNCTION app_private.apply_pricing_extras(target_company uuid, job uuid, payload jsonb, prior_manual boolean, prior_sc bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j public.jobs%ROWTYPE; newset jsonb; e jsonb; k integer := 0; addons bigint; manual boolean; sc bigint; billed integer; total bigint; dep bigint; pct numeric;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE company_id=target_company AND id=job;
 IF NOT FOUND THEN RETURN; END IF;
 IF payload ? 'line_items' THEN
  IF jsonb_typeof(payload->'line_items')<>'array' OR jsonb_array_length(payload->'line_items')>30 THEN RAISE EXCEPTION 'Up to 30 add-ons per job'; END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(payload->'line_items') LOOP
   k := k+1;
   IF NOT EXISTS(SELECT 1 FROM public.price_items p WHERE p.company_id=target_company AND p.id=nullif(e->>'item_id','')::uuid AND p.active) THEN
    RAISE EXCEPTION 'Add-on % is not on the active price list. Remove it or switch it back on under Settings.', k; END IF;
   IF coalesce((e->>'quantity')::numeric,0) <= 0 OR (e->>'quantity')::numeric > 1000 THEN RAISE EXCEPTION 'Add-on %: quantity must be more than 0 and at most 1000', k; END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('position',ord,'item_id',p.id,'name',p.name,'unit_label',p.unit_label,'unit_price_cents',p.unit_price_cents,
    'quantity',round((x.e->>'quantity')::numeric,2),'total_cents',round(p.unit_price_cents*round((x.e->>'quantity')::numeric,2))::bigint) ORDER BY ord),'[]'::jsonb)
   INTO newset FROM jsonb_array_elements(payload->'line_items') WITH ORDINALITY x(e,ord)
   JOIN public.price_items p ON p.company_id=target_company AND p.id=(x.e->>'item_id')::uuid;
  IF app_private.stored_line_items(target_company,job) IS DISTINCT FROM newset THEN
   DELETE FROM public.job_line_items WHERE company_id=target_company AND job_id=job;
   INSERT INTO public.job_line_items(company_id,job_id,position,item_id,name,unit_label,unit_price_cents,quantity,total_cents)
   SELECT target_company,job,(x->>'position')::smallint,(x->>'item_id')::uuid,x->>'name',x->>'unit_label',(x->>'unit_price_cents')::bigint,(x->>'quantity')::numeric,(x->>'total_cents')::bigint
   FROM jsonb_array_elements(newset) x;
  END IF;
 END IF;
 addons := coalesce((SELECT sum(total_cents) FROM public.job_line_items WHERE company_id=target_company AND job_id=job),0);

 IF payload ? 'service_charge_manual' THEN
  manual := coalesce((payload->>'service_charge_manual')::boolean,false);
  IF manual THEN
   sc := nullif(payload->>'manual_service_charge_cents','')::bigint;
   IF sc IS NULL OR sc<0 OR sc>10000000 THEN RAISE EXCEPTION 'Enter the service charge amount (up to $100,000)'; END IF;
  END IF;
 ELSE manual := coalesce(prior_manual,false); sc := prior_sc; END IF;
 IF j.pricing_model<>'hourly' THEN manual := false; END IF;
 IF manual THEN
  j.service_charge_cents := sc;
  -- The original pricing step needs a mileage number, so the app sends 0 plus miles_unknown=true; store no mileage then.
  IF coalesce((payload->>'miles_unknown')::boolean,false) THEN j.round_trip_miles := NULL; END IF;
 END IF;

 IF j.pricing_model='hourly' THEN
  billed := greatest(j.minimum_minutes, ceil(coalesce(j.estimated_minutes,j.minimum_minutes)::numeric/j.billing_increment_minutes)::integer*j.billing_increment_minutes);
  total := round(coalesce(j.hourly_rate_cents,0)*billed::numeric/60)::bigint + coalesce(j.service_charge_cents,0) + addons;
 ELSE
  total := coalesce(j.flat_rate_cents,0) + addons;
 END IF;
 dep := j.deposit_required_cents;
 IF j.out_of_town THEN
  SELECT out_of_town_deposit_percent INTO pct FROM public.company_settings WHERE company_id=target_company;
  dep := round(total*coalesce(pct,50)/100)::bigint;
 END IF;
 UPDATE public.jobs SET service_charge_cents=j.service_charge_cents, round_trip_miles=j.round_trip_miles, add_ons_cents=addons,
  service_charge_manual=manual, quoted_total_cents=total, deposit_required_cents=dep
 WHERE company_id=target_company AND id=job
  AND (service_charge_cents,round_trip_miles,add_ons_cents,service_charge_manual,quoted_total_cents,deposit_required_cents)
   IS DISTINCT FROM (j.service_charge_cents,j.round_trip_miles,addons,manual,total,dep);
END;
$$;
REVOKE ALL ON FUNCTION app_private.apply_pricing_extras(uuid,uuid,jsonb,boolean,bigint) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_estimate(target_company uuid, payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j uuid; pm boolean; psc bigint;
BEGIN
 SELECT service_charge_manual,service_charge_cents INTO pm,psc FROM public.jobs WHERE company_id=target_company AND id=nullif(payload->>'id','')::uuid;
 j := app_private.save_estimate_v1(target_company, payload);
 PERFORM app_private.apply_job_details(target_company, j, payload);
 PERFORM app_private.apply_pricing_extras(target_company, j, payload, pm, psc);
 PERFORM app_private.apply_customer_fields(target_company, j, payload);
 RETURN j;
END;
$$;
CREATE OR REPLACE FUNCTION public.save_dispatch_job(target_company uuid, payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j uuid; pm boolean; psc bigint;
BEGIN
 SELECT service_charge_manual,service_charge_cents INTO pm,psc FROM public.jobs WHERE company_id=target_company AND id=nullif(payload->>'id','')::uuid;
 j := app_private.save_dispatch_job_v1(target_company, payload);
 PERFORM app_private.apply_job_details(target_company, j, payload);
 PERFORM app_private.apply_pricing_extras(target_company, j, payload, pm, psc);
 PERFORM app_private.apply_customer_fields(target_company, j, payload);
 RETURN j;
END;
$$;
REVOKE ALL ON FUNCTION public.save_estimate(uuid,jsonb), public.save_dispatch_job(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_estimate(uuid,jsonb), public.save_dispatch_job(uuid,jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Pricing settings ready' AS result;
