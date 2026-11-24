-- READ-ONLY schema fingerprint. Reads catalog metadata only (names, types, rules), never row data.
-- Run in a hosted project's SQL Editor and compare with the expected output from
-- `node supabase/checks/expected_fingerprint.mjs`, which runs the same query on the migrations locally.
WITH
tbl AS (
 SELECT n.nspname||'.'||c.relname AS name, c.relrowsecurity AS rls
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname IN ('public','app_private')),
col AS (
 SELECT table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable AS name
 FROM information_schema.columns WHERE table_schema IN ('public','app_private')),
fn AS (
 SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'||CASE WHEN p.prosecdef THEN ':definer' ELSE '' END AS name,
        md5(regexp_replace(p.prosrc,'\s+',' ','g')) AS body
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','app_private')),
pol AS (
 SELECT schemaname||'.'||tablename||'.'||policyname||':'||cmd||':'||array_to_string(roles,',') AS name
 FROM pg_policies WHERE schemaname IN ('public','app_private') OR (schemaname='storage' AND policyname LIKE 'moving_photos_%')),
trg AS (
 SELECT event_object_schema||'.'||event_object_table||'.'||trigger_name||':'||event_manipulation AS name
 FROM information_schema.triggers WHERE event_object_schema='public'),
grt AS (
 SELECT table_schema||'.'||table_name||':'||grantee||':'||privilege_type AS name
 FROM information_schema.role_table_grants
 WHERE table_schema IN ('public','app_private') AND grantee IN ('anon','authenticated')),
fgr AS (
 SELECT n.nspname||'.'||p.proname||':'||r.rolname AS name
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN pg_roles r
 WHERE n.nspname IN ('public','app_private') AND r.rolname IN ('anon','authenticated')
   AND has_function_privilege(r.oid,p.oid,'EXECUTE')),
summary AS (
 SELECT 1 AS ord,'tables' AS part,count(*) AS n,md5(string_agg(name||':rls='||rls,'|' ORDER BY name)) AS fingerprint,string_agg(name||CASE WHEN rls THEN '' ELSE ' (RLS OFF)' END,', ' ORDER BY name) AS detail FROM tbl
 UNION ALL SELECT 2,'columns',count(*),md5(string_agg(name,'|' ORDER BY name)),NULL FROM col
 UNION ALL SELECT 3,'functions',count(*),md5(string_agg(name||'#'||body,'|' ORDER BY name)),string_agg(name,', ' ORDER BY name) FROM fn
 UNION ALL SELECT 4,'policies',count(*),md5(string_agg(name,'|' ORDER BY name)),string_agg(name,', ' ORDER BY name) FROM pol
 UNION ALL SELECT 5,'triggers',count(*),md5(string_agg(name,'|' ORDER BY name)),string_agg(name,', ' ORDER BY name) FROM trg
 UNION ALL SELECT 6,'table grants (anon/authenticated)',count(*),md5(string_agg(name,'|' ORDER BY name)),string_agg(name,', ' ORDER BY name) FROM grt
 UNION ALL SELECT 7,'function execute (anon/authenticated)',count(*),md5(string_agg(name,'|' ORDER BY name)),string_agg(name,', ' ORDER BY name) FROM fgr)
SELECT part,n,fingerprint,detail FROM summary ORDER BY ord;
