// movers-staff-invite handler tests. Supabase Auth/DB are replaced by mocks; no network, no emails.
import {test,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import ts from '../../app/node_modules/typescript/lib/typescript.js';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEYS:'{"default":"public"}',SUPABASE_SECRET_KEYS:'{"default":"secret"}'};
globalThis.Deno={env:{get:n=>env[n]},serve:()=>{}};
const co='00000000-0000-4000-8000-000000000001';
let s; // per-test state
beforeEach(()=>{s={authValid:true,me:{id:'office-user',email:'owner@example.test'},role:'owner',active:true,lookup:null,deleteError:null,inviteError:null,registerError:null,deleted:[],invites:[],registers:[]}});
globalThis.__inviteCreateClient=(url,key)=>({
 auth:{getUser:async()=>s.authValid?{data:{user:s.me},error:null}:{data:{user:null},error:{message:'Invalid'}},
  admin:{deleteUser:async id=>{s.deleted.push({id,key});return {error:s.deleteError}},
   inviteUserByEmail:async(email,opts)=>{s.invites.push({email,opts,key});return s.inviteError?{data:{user:null},error:{message:s.inviteError}}:{data:{user:{id:'new-user'}},error:null}}}},
 from(){const chain={select(){return this},eq(){return this},single:async()=>({data:{role:s.role,active:s.active},error:null})};return chain},
 rpc:async(name,p)=>{if(name==='staff_invite_lookup')return {data:s.lookup?[s.lookup]:[],error:null};
  if(name==='register_invited_member'){s.registers.push({...p,key});return s.registerError?{data:null,error:{message:s.registerError}}:{data:p.invited_user,error:null}}
  return {error:{message:'unexpected rpc '+name}}}});
let source=await readFile(new URL('../../supabase/functions/movers-staff-invite/index.ts',import.meta.url),'utf8');
source=source.replace(/import \{createClient\} from '[^']+';/,"const createClient=(...args:any[])=>globalThis.__inviteCreateClient(...args);");
const fn=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));
const call=(body={},headers={})=>fn.handler(new Request('https://example.supabase.co/functions/v1/movers-staff-invite',{method:'POST',headers:{Authorization:'Bearer user-token',Origin:'https://the-movers-login-dev.vercel.app',...headers},body:JSON.stringify({company_id:co,email:'New.Mover@Example.test ',name:' Sam Mover ',role:'mover',...body})}));

test('Rejects missing login, other websites, crew and inactive office users before anything is sent',async()=>{
 assert.equal((await call({},{Authorization:''})).status,401);
 assert.equal((await call({},{Origin:'https://attacker.test'})).status,403);
 s.authValid=false;assert.equal((await call()).status,401);s.authValid=true;
 s.role='crew_leader';assert.equal((await call()).status,403);s.role='owner';s.active=false;assert.equal((await call()).status,403);
 assert.equal(s.invites.length,0);assert.equal(s.registers.length,0);assert.equal(s.deleted.length,0)});
test('Validates role, email and name; nobody can be invited as owner or invite themselves',async()=>{
 assert.equal((await call({role:'owner'})).status,400);assert.equal((await call({email:'not-an-email'})).status,400);assert.equal((await call({name:'  '})).status,400);
 assert.equal((await call({email:'OWNER@example.test'})).status,400);assert.equal(s.invites.length,0)});
test('New person: invite email sent to the main site, then access granted with the office user session',async()=>{
 const r=await call();const body=await r.json();assert.equal(r.status,200);assert.equal(body.invited,true);
 assert.deepEqual(s.invites.map(i=>[i.email,i.opts.redirectTo,i.opts.data.display_name,i.key]),[['new.mover@example.test','https://the-movers-login-dev.vercel.app/','Sam Mover','secret']]);
 assert.deepEqual(s.registers,[{target_company:co,invited_user:'new-user',member_name:'Sam Mover',member_role:'mover',key:'public'}])});
test('Someone who already has a verified login gets access with no email',async()=>{
 s.lookup={user_id:'existing',confirmed:true,has_membership:true};const body=await (await call({role:'crew_leader'})).json();
 assert.equal(body.invited,false);assert.equal(s.invites.length,0);assert.equal(s.deleted.length,0);assert.equal(s.registers[0].invited_user,'existing');assert.equal(s.registers[0].member_role,'crew_leader')});
test('An unconfirmed self sign-up with no access is removed and replaced by a fresh invite',async()=>{
 s.lookup={user_id:'abandoned',confirmed:false,has_membership:false};const r=await call();assert.equal(r.status,200);
 assert.deepEqual(s.deleted.map(d=>d.id),['abandoned']);assert.equal(s.invites.length,1);assert.equal(s.registers[0].invited_user,'new-user')});
test('A pending invite is re-sent without deleting the person',async()=>{
 s.lookup={user_id:'pending',confirmed:false,has_membership:true};assert.equal((await call()).status,200);assert.equal(s.deleted.length,0);assert.equal(s.invites.length,1)});
test('If the email cannot be sent, no access is granted',async()=>{
 s.inviteError='Email rate limit exceeded';const r=await call();assert.equal(r.status,502);assert.match((await r.json()).error,/rate limit/);assert.equal(s.registers.length,0)});
test('If clearing an abandoned sign-up fails, nothing is sent',async()=>{
 s.lookup={user_id:'abandoned',confirmed:false,has_membership:false};s.deleteError={message:'nope'};assert.equal((await call()).status,502);assert.equal(s.invites.length,0);assert.equal(s.registers.length,0)});
test('Database refusal is shown to the office user',async()=>{
 s.registerError='Owner access cannot be changed here';const r=await call();assert.equal(r.status,400);assert.equal((await r.json()).error,'Owner access cannot be changed here')});
test('Invites from app.themoverz.com link back there; previews use the main site',async()=>{
 await call({},{Origin:'https://app.themoverz.com'});await call({},{Origin:'https://the-movers-login-abc123-the-movers.vercel.app'});
 assert.deepEqual(s.invites.map(i=>i.opts.redirectTo),['https://app.themoverz.com/','https://the-movers-login-dev.vercel.app/'])});
