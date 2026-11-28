// movers-customer-email handler tests. Supabase and Resend are mocked; nothing is sent.
import {test,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import ts from '../../app/node_modules/typescript/lib/typescript.js';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEYS:'{"default":"public"}',SUPABASE_SECRET_KEYS:'{"default":"secret"}',RESEND_API_KEY:'re_test_only'};
globalThis.Deno={env:{get:n=>env[n]},serve:()=>{}};
const co='00000000-0000-4000-8000-000000000001',jobId='00000000-0000-4000-8000-000000000002',SITE='https://the-movers-login-dev.vercel.app';
const TERMS='Please remove any **JEWELRY**.\n**ALL ITEMS** inside the **REFRIGERATORS** must be removed.\n\n**NO REFUNDS AFTER THE SERVICES ARE RENDERED.**';
let s;
const baseJob={id:jobId,status:'booked',customer_id:'cust',customer_name:'Iris Faulk',move_date:'2026-11-30',arrival_time:'14:00:00',arrival_window_end:'15:00:00',pick_up_address:'8440 Grand Canyon Dr Plano, TX 75025',drop_off_address:'1210 W McDermott Dr Allen, TX 75013',crew_size:2,pricing_model:'hourly',hourly_rate_cents:11000,flat_rate_cents:null,service_charge_cents:12000,deposit_required_cents:5000,minimum_minutes:120,billing_increment_minutes:15};
beforeEach(()=>{s={role:'owner',active:true,job:{...baseJob},customer:{first_name:'Iris',last_name:'Faulk',name:'Iris Faulk',email:'iris@example.test'},
 stops:[{position:1,kind:'pickup',address:'8440 Grand Canyon Dr Plano, TX 75025',unit:null},{position:2,kind:'dropoff',address:'1210 W McDermott Dr Allen, TX 75013',unit:null}],
 lines:[],logs:[],sends:[],proposals:[],deleted:[],resendOk:true,pdfOk:true};env.RESEND_API_KEY='re_test_only'});
globalThis.__emailCreateClient=()=>({
 auth:{getUser:async()=>({data:{user:{id:'office-user'}},error:null})},
 from(table){let pending=null;const q={eq(){return q},select(){return q},
  order(){return Promise.resolve({data:table==='job_stops'?s.stops:table==='job_line_items'?s.lines:[],error:null})},
  single:async()=>{if(pending){s.proposals.push(pending);return {data:{id:'proposal-'+s.proposals.length},error:null}}
   return table==='company_members'?{data:{role:s.role,active:s.active},error:null}:table==='jobs'?{data:s.job,error:null}:table==='customers'?{data:s.customer,error:null}:table==='company_settings'?{data:{proposal_terms:TERMS},error:null}:{data:null,error:null}},
  insert(row){if(table==='customer_emails'){s.logs.push(row);return Promise.resolve({error:null})}pending=row;return q},
  delete(){return {eq:async(_c,v)=>{s.deleted.push(v);return {error:null}}}}};return q}});
globalThis.fetch=async(url,opts)=>{
 if(String(url).endsWith('/docs/rights-and-responsibilities.pdf'))return s.pdfOk?new Response(new Uint8Array(5000).fill(37)):new Response('missing',{status:404});
 s.sends.push({url,body:JSON.parse(opts.body),auth:opts.headers.Authorization});return new Response(JSON.stringify(s.resendOk?{id:'email_123'}:{message:'Domain not verified'}),{status:s.resendOk?200:403})};
let source=await readFile(new URL('../../supabase/functions/movers-customer-email/index.ts',import.meta.url),'utf8');
source=source.replace(/import \{createClient\} from '[^']+';/,"const createClient=(...args:any[])=>globalThis.__emailCreateClient(...args);");
const fn=await import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64'));
const call=(body={},headers={})=>fn.handler(new Request('https://example.supabase.co/functions/v1/movers-customer-email',{method:'POST',headers:{Authorization:'Bearer t',Origin:SITE,...headers},body:JSON.stringify({company_id:co,job_id:jobId,reason:'booked',...body})}));

test('Office only; crew and other websites are refused before anything is sent',async()=>{s.role='crew_leader';assert.equal((await call()).status,403);s.role='owner';assert.equal((await call({},{Origin:'https://evil.test'})).status,403);assert.equal((await call({},{Authorization:''})).status,401);assert.equal(s.sends.length,0)});
test('Clear message when the email service is not set up or the customer has no email',async()=>{delete env.RESEND_API_KEY;assert.match((await (await call()).json()).error,/not set up yet/);env.RESEND_API_KEY='re_test_only';s.customer.email='';const r=await call();assert.equal(r.status,400);assert.match((await r.json()).error,/no email address/);assert.equal(s.sends.length,0)});
test('Window and money formats match the owner\'s email',()=>{assert.equal(fn.shortWindow('14:00:00','15:00:00'),'2-3PM');assert.equal(fn.shortWindow('11:00','13:00'),'11AM-1PM');assert.equal(fn.shortWindow('08:30','09:30'),'8:30-9:30AM');assert.equal(fn.shortWindow('14:00',null),'2PM');assert.equal(fn.mdy('2026-11-30'),'11/30/2026');assert.equal(fn.dollars(5000,true),'$50.00');assert.equal(fn.dollars(11000),'$110')});
test('A booked job gets the full Written Proposal: details, terms, I-agree link and the TxDMV PDF',async()=>{const r=await call();assert.equal(r.status,200);const m=s.sends[0].body;
 assert.equal(m.subject,'Written Proposal');assert.deepEqual(m.to,['iris@example.test']);assert.equal(m.reply_to,'move@themoverz.com');
 for(const t of ['This is a written proposal for <b>IRIS FAULK</b> provided by <b>THE MOVERS</b>','<b>MOVE DATE &amp; ARRIVAL WINDOW- 11/30/2026 @ 2-3PM</b>','<b>PICK-UP LOCATION- 8440 GRAND CANYON DR PLANO, TX 75025</b>','<b>DROP-OFF LOCATION- 1210 W MCDERMOTT DR ALLEN, TX 75013</b>','<b>2-MAN</b> crew @ <b>$110/HR</b> plus a <b>$120 SERVICE CHARGE</b>. A <b>2-HOUR</b> minimum is required, any additional time will be billed in <b>15-MINUTE</b> increments. <b>DEPOSIT REQUIRED-$50.00</b>','<b>***</b> Please remove any <b>JEWELRY</b>.','<b>NO REFUNDS AFTER THE SERVICES ARE RENDERED.</b>','I have read and agree to the terms','THANK YOU FOR CHOOSING THE MOVERS','Our Faith Can Move Mountains',SITE+'/brand/email-banner.jpg'])assert.ok(m.html.includes(t),t);
 assert.equal(m.attachments[0].filename,'rights&responsibilities.pdf');assert.ok(m.attachments[0].content.length>1000);
 const link=m.html.match(/href="([^"]+\?agree=([A-Za-z0-9_-]+))"/);assert.ok(link&&link[1].startsWith(SITE+'/?agree='));
 assert.equal(s.proposals.length,1);assert.equal(s.proposals[0].token_hash,createHash('sha256').update(link[2]).digest('hex'),'only the hash is stored');assert.ok(!JSON.stringify(s.proposals[0]).includes(link[2]));
 assert.equal(s.proposals[0].content.terms[2],'','blank line kept between groups');assert.equal(s.logs[0].kind,'proposal')});
test('After a date change the subject and first line say it is updated',async()=>{await call({reason:'date_changed'});const m=s.sends[0].body;assert.equal(m.subject,'Updated Written Proposal');assert.match(m.html,/THIS IS AN UPDATED WRITTEN PROPOSAL/)});
test('Estimates get the short email: no terms, no PDF, no agreement link',async()=>{s.job.status='estimate';await call({reason:'manual'});const m=s.sends[0].body;assert.equal(m.subject,'Moving Estimate from The Movers');assert.match(m.html,/This is a moving estimate for <b>IRIS FAULK<\/b>/);assert.match(m.html,/DEPOSIT REQUIRED-\$50.00/);assert.ok(!m.html.includes('JEWELRY'));assert.equal(m.attachments,undefined);assert.ok(!m.html.includes('?agree='));assert.equal(s.proposals.length,0);s.job.status='completed';assert.equal((await call()).status,400)});
test('Flat rate, extra stops, one-address jobs and add-ons',async()=>{Object.assign(s.job,{pricing_model:'flat',flat_rate_cents:65000,crew_size:3});s.stops.splice(1,0,{position:2,kind:'pickup',address:'5 Storage Ln',unit:'B12'});s.lines=[{name:'Upright piano',quantity:1,total_cents:25000}];await call();let h=s.sends[0].body.html;
 for(const t of ['<b>3-MAN</b> crew for a <b>FLAT RATE OF $650</b>','PICK-UP LOCATION 1- 8440','PICK-UP LOCATION 2- 5 STORAGE LN, UNIT B12','<b>DROP-OFF LOCATION- 1210','<b>ADDITIONAL ITEMS-</b> 1 UPRIGHT PIANO ($250)'])assert.ok(h.includes(t),t);
 s.stops=[{position:1,kind:'pickup',address:'1 Elm St',unit:null}];await call();h=s.sends[1].body.html;assert.ok(h.includes('<b>LOCATION- 1 ELM ST</b>'));
 s.job.arrival_time=null;await call();assert.ok(s.sends[2].body.html.includes('MOVE DATE- 11/30/2026 (ARRIVAL WINDOW TO BE CONFIRMED)'))});
test('Nothing is sent without the PDF; a failed send removes its proposal and is logged',async()=>{s.pdfOk=false;const r=await call();assert.equal(r.status,502);assert.equal(s.sends.length,0);s.pdfOk=true;s.resendOk=false;assert.equal((await call()).status,502);assert.deepEqual(s.deleted,['proposal-1']);assert.equal(s.logs.at(-1).status,'failed');assert.match(s.logs.at(-1).error,/Domain not verified/)});
test('Customer-provided text is escaped in the email',async()=>{s.customer.first_name='<script>alert(1)</script>';s.stops[0].address='1 Elm <b>St</b>';await call();const h=s.sends[0].body.html;assert.ok(!h.includes('<script>'));assert.ok(h.includes('&lt;B&gt;'))});
