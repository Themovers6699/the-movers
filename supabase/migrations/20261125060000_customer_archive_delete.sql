-- Delete or archive customers (owner request 2026-11-25). Run after 20261125050000_job_stops.sql. Safe to run again.
--  * delete_customer(): only for customers with no estimates/moves (test entries, mistakes). The audit log keeps
--    the deleted record and who deleted it.
--  * set_customer_archived(): customers WITH moves are archived instead, hidden from lists/search/pickers,
--    all history kept, restorable.
--  * search_customers() gains include_archived (default false) and returns archived_at.
BEGIN;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE OR REPLACE FUNCTION public.delete_customer(target_company uuid, target_customer uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n bigint;
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 PERFORM 1 FROM public.customers WHERE company_id=target_company AND id=target_customer FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found in this company'; END IF;
 SELECT count(*) INTO n FROM public.jobs WHERE company_id=target_company AND customer_id=target_customer;
 IF n>0 THEN RAISE EXCEPTION 'This customer has % estimate(s) or move(s), so they can''t be deleted. Archive them instead to hide them while keeping their history.', n; END IF;
 DELETE FROM public.customers WHERE company_id=target_company AND id=target_customer;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_customer(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_customer(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_customer_archived(target_company uuid, target_customer uuid, archived boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT app_private.is_office(target_company) THEN RAISE EXCEPTION 'Office access required'; END IF;
 UPDATE public.customers SET archived_at=CASE WHEN archived THEN coalesce(archived_at,now()) ELSE NULL END
  WHERE company_id=target_company AND id=target_customer;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found in this company'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_customer_archived(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_customer_archived(uuid,uuid,boolean) TO authenticated;

-- Direct deletes from the browser are no longer needed (delete_customer gives clear messages and checks).
REVOKE DELETE ON public.customers FROM authenticated;

DROP FUNCTION IF EXISTS public.search_customers(uuid,text,integer);
CREATE OR REPLACE FUNCTION public.search_customers(target_company uuid, query text DEFAULT '', max_rows integer DEFAULT 200, include_archived boolean DEFAULT false)
RETURNS TABLE(id uuid, name text, first_name text, last_name text, email text, phone text, phone2 text, referral_source text,
 tags text[], office_notes text, job_count bigint, last_move_date date, total_matches bigint, archived_at timestamptz)
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
  count(*) OVER (), c.archived_at
 FROM public.customers c
 WHERE c.company_id=target_company AND (include_archived OR c.archived_at IS NULL) AND (
  q='' OR c.name ILIKE pat OR c.email ILIKE pat
  OR (length(digits)>=3 AND (regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') LIKE '%'||digits||'%' OR regexp_replace(coalesce(c.phone2,''),'[^0-9]','','g') LIKE '%'||digits||'%'))
  OR EXISTS(SELECT 1 FROM public.jobs j WHERE j.company_id=c.company_id AND j.customer_id=c.id AND (j.pick_up_address ILIKE pat OR j.drop_off_address ILIKE pat))
  OR EXISTS(SELECT 1 FROM public.job_stops s JOIN public.jobs j ON j.company_id=s.company_id AND j.id=s.job_id
            WHERE j.company_id=c.company_id AND j.customer_id=c.id AND s.address ILIKE pat))
 ORDER BY c.last_name NULLS LAST, c.first_name, c.id
 LIMIT greatest(1,least(coalesce(max_rows,200),500));
END;
$$;
REVOKE ALL ON FUNCTION public.search_customers(uuid,text,integer,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.search_customers(uuid,text,integer,boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Customer archive/delete ready' AS result;
