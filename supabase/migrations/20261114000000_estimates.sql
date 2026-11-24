-- Run after schema v1. Safe to run again. Does not remove existing records.
BEGIN;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS estimated_minutes integer;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS round_trip_miles numeric(10,2);
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS out_of_town boolean NOT NULL DEFAULT false;
-- Atomic save: customer and estimate either both succeed or both roll back.
CREATE OR REPLACE FUNCTION public.save_estimate(target_company uuid, payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j uuid; c uuid; r public.crew_rates%ROWTYPE; s public.company_settings%ROWTYPE;
 crew integer; mins integer; billed integer; miles numeric; rate bigint; service bigint;
 total bigint; deposit bigint; flat bigint; d date; model text; outtown boolean; old_status text;
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 IF length(btrim(coalesce(payload->>'customer_name',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Customer name is required (maximum 200 characters)'; END IF;
 IF length(btrim(coalesce(payload->>'pick_up_address','')))=0 OR length(btrim(coalesce(payload->>'drop_off_address','')))=0 THEN RAISE EXCEPTION 'Both addresses are required'; END IF;
 j:=nullif(payload->>'id','')::uuid;
 IF j IS NOT NULL THEN
 SELECT customer_id,status INTO c,old_status FROM public.jobs WHERE company_id=target_company AND id=j FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Estimate not found'; END IF;
 IF old_status<>'estimate' THEN RAISE EXCEPTION 'Only estimates can be edited here'; END IF;
 END IF;
 SELECT * INTO STRICT s FROM public.company_settings WHERE company_id=target_company;
 crew:=(payload->>'crew_size')::integer;
 SELECT * INTO STRICT r FROM public.crew_rates WHERE company_id=target_company AND crew_size=crew;
 d:=(payload->>'move_date')::date; IF d IS NULL THEN RAISE EXCEPTION 'Move date required'; END IF;
 model:=payload->>'pricing_model'; outtown:=coalesce((payload->>'out_of_town')::boolean,false);
 IF model IS NULL OR model NOT IN ('hourly','flat') OR (outtown AND model<>'flat') THEN RAISE EXCEPTION 'Out-of-town moves require a flat rate'; END IF;
 IF model='hourly' THEN
 mins:=(payload->>'estimated_minutes')::integer;
 miles:=(payload->>'round_trip_miles')::numeric;
 IF mins IS NULL OR mins<1 OR mins>10080 OR miles IS NULL OR miles<0 OR miles>100000 THEN RAISE EXCEPTION 'Enter valid estimated time and round-trip miles'; END IF;
 miles:=round(miles,2);
 billed:=greatest(s.minimum_minutes,ceil(mins::numeric/s.billing_increment_minutes)::integer*s.billing_increment_minutes);
 rate:=CASE WHEN extract(isodow FROM d) IN (6,7) THEN r.weekend_rate_cents ELSE r.weekday_rate_cents END;
 service:=ceil((r.service_base_cents+miles*r.service_cents_per_mile)/r.round_service_up_to_cents)*r.round_service_up_to_cents;
 total:=round(rate*billed::numeric/60)+service;
 ELSE
 flat:=(payload->>'flat_rate_cents')::bigint;
 IF flat IS NULL OR flat<=0 OR flat>100000000 THEN RAISE EXCEPTION 'Enter a positive flat rate'; END IF;
 total:=flat; service:=0;
 END IF;
 deposit:=CASE WHEN outtown THEN round(total*s.out_of_town_deposit_percent/100) ELSE s.standard_deposit_cents END;
 IF j IS NULL AND nullif(payload->>'customer_id','') IS NOT NULL THEN
 c:=(payload->>'customer_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=c AND company_id=target_company) THEN RAISE EXCEPTION 'Customer not found in this company'; END IF;
 END IF;
 IF c IS NULL THEN
 INSERT INTO public.customers(company_id,name,email,phone) VALUES(target_company,btrim(payload->>'customer_name'),nullif(btrim(payload->>'email'),''),nullif(btrim(payload->>'phone'),'')) RETURNING id INTO c;
 ELSE
 UPDATE public.customers SET name=btrim(payload->>'customer_name'),email=nullif(btrim(payload->>'email'),''),phone=nullif(btrim(payload->>'phone'),'') WHERE company_id=target_company AND id=c;
 END IF;
 IF j IS NULL THEN
 INSERT INTO public.jobs(company_id,customer_id,customer_name,move_date,pick_up_address,drop_off_address,move_type,crew_size,pricing_model,hourly_rate_cents,flat_rate_cents,service_charge_cents,quoted_total_cents,deposit_required_cents,minimum_minutes,billing_increment_minutes)
 VALUES(target_company,c,btrim(payload->>'customer_name'),d,btrim(payload->>'pick_up_address'),btrim(payload->>'drop_off_address'),payload->>'move_type',crew,model,rate,flat,service,total,deposit,s.minimum_minutes,s.billing_increment_minutes) RETURNING id INTO j;
 END IF;
 UPDATE public.jobs SET customer_id=c,customer_name=btrim(payload->>'customer_name'),move_date=d,arrival_time=nullif(payload->>'arrival_time','')::time,pick_up_address=btrim(payload->>'pick_up_address'),drop_off_address=btrim(payload->>'drop_off_address'),move_type=payload->>'move_type',access_instructions=coalesce(payload->>'access_instructions',''),crew_size=crew,pricing_model=model,hourly_rate_cents=rate,flat_rate_cents=flat,service_charge_cents=service,quoted_total_cents=total,deposit_required_cents=deposit,minimum_minutes=s.minimum_minutes,billing_increment_minutes=s.billing_increment_minutes,estimated_minutes=mins,round_trip_miles=miles,out_of_town=outtown WHERE company_id=target_company AND id=j;
 RETURN j;
END;
$$;
REVOKE ALL ON FUNCTION public.save_estimate(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_estimate(uuid,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Estimates update ready' AS result;
