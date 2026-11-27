-- READ-ONLY. Run in the TESTING project's SQL Editor. It returns ONE cell containing a script.
-- Copy that cell's text and run it in the PRODUCTION project's SQL Editor to copy The Movers' crew rates,
-- general pricing rules and ACTIVE add-ons. Switched-off add-ons are not copied.
WITH c AS (SELECT id FROM public.companies WHERE slug='the-movers'),
s AS (SELECT * FROM public.company_settings WHERE company_id=(SELECT id FROM c)),
r AS (SELECT string_agg(format('(%s,%s,%s,%s,%s,%s)',crew_size,weekday_rate_cents,weekend_rate_cents,service_base_cents,service_cents_per_mile,round_service_up_to_cents),', ' ORDER BY crew_size) AS v
      FROM public.crew_rates WHERE company_id=(SELECT id FROM c)),
p AS (SELECT string_agg(format('(%L,%L,%L,%s,%s)',name,category,unit_label,unit_price_cents,rn),', ' ORDER BY rn) AS v
      FROM (SELECT *, row_number() OVER (ORDER BY sort_order,name) AS rn FROM public.price_items WHERE company_id=(SELECT id FROM c) AND active) x)
SELECT concat_ws(E'\n',
 '-- Copy of The Movers pricing from the testing project. Run in the PRODUCTION SQL Editor.',
 'BEGIN;',
 'DO $chk$ BEGIN',
 '  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE slug=''the-movers'') THEN RAISE EXCEPTION ''The Movers company not found: is this the production project?''; END IF;',
 '  IF EXISTS (SELECT 1 FROM public.job_line_items) THEN RAISE EXCEPTION ''Production already has add-ons on quotes: stop and ask before replacing prices.''; END IF;',
 'END $chk$;',
 format('UPDATE public.company_settings SET depot_address=%L, minimum_minutes=%s, billing_increment_minutes=%s, standard_deposit_cents=%s, out_of_town_deposit_percent=%s WHERE company_id=(SELECT id FROM public.companies WHERE slug=''the-movers'');',
   s.depot_address, s.minimum_minutes, s.billing_increment_minutes, s.standard_deposit_cents, s.out_of_town_deposit_percent),
 'DELETE FROM public.crew_rates WHERE company_id=(SELECT id FROM public.companies WHERE slug=''the-movers'');',
 'INSERT INTO public.crew_rates(company_id,crew_size,weekday_rate_cents,weekend_rate_cents,service_base_cents,service_cents_per_mile,round_service_up_to_cents)',
 format(' SELECT (SELECT id FROM public.companies WHERE slug=''the-movers''), v.* FROM (VALUES %s) v(crew_size,weekday,weekend,base,per_mile,round_to);', r.v),
 'DELETE FROM public.price_items WHERE company_id=(SELECT id FROM public.companies WHERE slug=''the-movers'');',
 'INSERT INTO public.price_items(company_id,name,category,unit_label,unit_price_cents,sort_order)',
 format(' SELECT (SELECT id FROM public.companies WHERE slug=''the-movers''), v.* FROM (VALUES %s) v(name,category,unit_label,price,ord);', coalesce(p.v,'(''-'',''fee'',''each'',0,1)')),
 'COMMIT;',
 format('SELECT ''Pricing copied: %s crew sizes, %s add-ons'' AS result;', (SELECT count(*) FROM public.crew_rates WHERE company_id=(SELECT id FROM c)), (SELECT count(*) FROM public.price_items WHERE company_id=(SELECT id FROM c) AND active))
) AS copy_this_script_into_production
FROM s, r, p;
