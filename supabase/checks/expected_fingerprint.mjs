// Prints the schema fingerprint a hosted project SHOULD have after applying migrations.
// Usage: node supabase/checks/expected_fingerprint.mjs [upToMigrationPrefix]
//   e.g. `... 20261116000000` = state after the four hand-applied scripts (01-04).
// Uses in-memory PGlite with minimal stand-ins for Supabase's auth/storage schemas. No network.
import {PGlite} from '../../tests/database/node_modules/@electric-sql/pglite/dist/index.js';
import {readFile,readdir} from 'node:fs/promises';

const upTo=process.argv[2]??'99999999999999';
const dir=new URL('../migrations/',import.meta.url);
const files=(await readdir(dir)).filter(f=>f.endsWith('.sql')&&f.slice(0,14)<=upTo).sort();
const db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text UNIQUE,email_confirmed_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth,storage TO authenticated,anon; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;`);
for(const f of files)await db.exec(await readFile(new URL(f,dir),'utf8'));
const q=await readFile(new URL('./schema_fingerprint.sql',import.meta.url),'utf8');
const rows=(await db.query(q)).rows;
console.log('Migrations applied: '+files.join(', ')+'\n');
for(const r of rows)console.log(`${r.part} | ${r.n} | ${r.fingerprint}\n  ${r.detail??''}\n`);
await db.close();
