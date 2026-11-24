// movers-staff-email handler tests. Supabase Auth/DB are replaced by mocks; no network.
import {test,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import ts from '../../app/node_modules/typescript/lib/typescript.js';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEYS:'{"default":"public"}',SUPABASE_SECRET_KEYS:'{"default":"secret"}'};
globalThis.Deno={env:{get:n=>env[n]},serve:()=>{}};
const co='00000000-0000-4000-8000-000000000001',target='00000000-0000-4000-8000-000000000002';
let s;
beforeEach(()=>{s={authValid:true,myRole:'office_admin',myActive:true,targetRole:'mover',targetFound:true,currentEmail:'old@example.test',updateError:null,updates:[],logs:[]}});
globalThis.__emailCreateClient=(url,key)=>({
 auth:{getUser:async()=>s.authValid?{data:{user:{id:'office-user'}},error:null}:{data:{user:null},error:{message:'bad'}},
  admin:{getUserById:async id=>({data:{user:{id,email:s.currentEmail}},error:null}),
   updateUserById:async(id,attrs)=>{s.updates.push({id,attrs,key});return s.updateError?{data:null,error:{message:s.updateError}}:{data:{user:{id}},error:null}}}},
 from(){const chain={select(){return this},eq(){return this},single:async()=>key==='public'?{data:{role:s.myRole,active:s.myActive},error:null}:(s.targetFound?{data:{role:s.targetRole},error:null}:{data:null,error:{message:'none'}})};return chain},
 rpc:async(name,p)=>{if(name==='record_staff_email_change'){s.logs.push({...p,key});return {error:null}}return {error:{message:'unexpected'}}}});
let source=await readFile(new URL('../../supabase/functions/movers-staff-email/index.ts',import.meta.url),'utf8');
source=source.replace(/import \{createClient\} from '[^']+';/,"const createClient=(...args:any[])=>globalThis.__emailCreateClient(...args);");
const fn=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));
const call=(body={},headers={})=>fn.handler(new Request('https://example.supabase.co/functions/v1/movers-staff-email',{method:'POST',headers:{Authorization:'Bearer t',Origin:'https://the-movers-login-dev.vercel.app',...headers},body:JSON.stringify({company_id:co,user_id:target,email:' New@Example.test ',...body})}));

test('Rejects missing login, other websites, crew and inactive office users without changing anything',async()=>{
 assert.equal((await call({},{Authorization:''})).status,401);assert.equal((await call({},{Origin:'https://evil.test'})).status,403);
 s.authValid=false;assert.equal((await call()).status,401);s.authValid=true;
 s.myRole='crew_leader';assert.equal((await call()).status,403);s.myRole='office_admin';s.myActive=false;assert.equal((await call()).status,403);
 assert.equal(s.updates.length,0)});
test('The owner\'s login email can never be changed here',async()=>{s.targetRole='owner';const r=await call();assert.equal(r.status,403);assert.equal(s.updates.length,0)});
test('Only staff of this company; valid email required',async()=>{s.targetFound=false;assert.equal((await call()).status,404);s.targetFound=true;assert.equal((await call({email:'nope'})).status,400);assert.equal(s.updates.length,0)});
test('Office admin changes a crew login email; it is confirmed and logged with who did it',async()=>{
 const r=await call();const body=await r.json();assert.equal(r.status,200);assert.equal(body.changed,true);
 assert.deepEqual(s.updates,[{id:target,attrs:{email:'new@example.test',email_confirm:true},key:'secret'}]);
 assert.deepEqual(s.logs,[{target_company:co,target_user:target,changed_by:'office-user',old_email:'old@example.test',new_email:'new@example.test',key:'secret'}])});
test('Same email is a no-op; an email used by another login is reported clearly',async()=>{
 s.currentEmail='new@example.test';const same=await (await call()).json();assert.equal(same.changed,false);assert.equal(s.updates.length,0);
 s.currentEmail='old@example.test';s.updateError='A user with this email address has already been registered';const r=await call();assert.equal(r.status,409);assert.match((await r.json()).error,/Another login already uses this email/);assert.equal(s.logs.length,0)});
