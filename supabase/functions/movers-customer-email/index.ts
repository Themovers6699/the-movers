import {createClient} from 'npm:@supabase/supabase-js@2.119.0';

// Customer emails, in the owner's own format (owner's sample 2026-11-27):
//  * estimate  -> short "Moving Estimate": banner, name, date/window, addresses, pricing, signature.
//  * booked    -> full "Written Proposal": the same plus the *** terms (company_settings.proposal_terms), an
//                 "I agree" link, and the TxDMV Rights & Responsibilities PDF attached. A copy of exactly what was
//                 sent is kept in job_proposals so the customer's agreement can be proven later.
//  * completed -> "Thank you": a "Tell us about a problem" button first, then review links (Google, Facebook, Yelp,
//                 BBB) shown to everyone (no review gating). Skipped for customers who opted out.
// Requests:
//  * office (signed-in owner/office admin): send one of the above for a job; or {mode:'schedule'} to turn the
//    automatic thank-you emails on/off.
//  * {mode:'scheduled'} from pg_cron with the x-movers-cron secret: thank-you emails due 24 hours after the move.
//  * {mode:'problem'} from the customer's problem page (link code, no login): saved in job_complaints and emailed
//    to the office inbox with the customer as reply-to.
// The gateway JWT check is off (config.toml) because cron and customers have no login; every mode checks its own key.
// Secrets: RESEND_API_KEY (required). Optional: CUSTOMER_EMAIL_FROM, CUSTOMER_REPLY_TO, OFFICE_EMAIL, APP_SITE_URL.

const env=(name:string)=>Deno.env.get(name)??'';
function platformKey(kind:'public'|'secret'){
 const raw=env(kind==='public'?'SUPABASE_PUBLISHABLE_KEYS':'SUPABASE_SECRET_KEYS');
 if(raw){try{const keys=JSON.parse(raw);if(keys.default)return keys.default;}catch{}}
 return env(kind==='public'?'SUPABASE_ANON_KEY':'SUPABASE_SERVICE_ROLE_KEY');
}
function allowed(origin:string){return origin==='https://app.themoverz.com'||origin==='https://the-movers-login-dev.vercel.app'||/^https:\/\/the-movers-login-[a-z0-9]+-the-movers\.vercel\.app$/.test(origin)||/^https:\/\/the-movers-[a-z0-9]+-the-movers\.vercel\.app$/.test(origin)}
const uuid=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Text with **bold** marks -> safe HTML. */
export const rich=(s:string)=>esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');
const plain=(s:string)=>s.replace(/\*\*/g,'');
export const dollars=(c:number|null|undefined,cents=false)=>{const v=Number(c??0)/100;return '$'+v.toLocaleString('en-US',{minimumFractionDigits:cents||v%1?2:0,maximumFractionDigits:2})};
const hours=(m:number)=>String(Math.round(m/60*100)/100);
export const mdy=(d:string)=>{const [y,m,day]=d.slice(0,10).split('-');return `${m}/${day}/${y}`};
/** "2-3PM", "11AM-1PM", "8:30-9:30AM", "2PM". */
export function shortWindow(a:string|null,b:string|null){
 if(!a)return '';
 const part=(t:string)=>{const [h,m]=t.slice(0,5).split(':').map(Number);return {n:`${h%12||12}${m?':'+String(m).padStart(2,'0'):''}`,ap:h<12?'AM':'PM'}};
 const s=part(a);if(!b)return s.n+s.ap;const e=part(b);
 return s.ap===e.ap?`${s.n}-${e.n}${e.ap}`:`${s.n}${s.ap}-${e.n}${e.ap}`;
}

/** Upper-case address with the unit right after the street (owner request):
 *  "8888 Mermaid Ave, Dallas, TX 75201" + "1328" -> "8888 MERMAID AVE, UNIT 1328, DALLAS, TX 75201".
 *  When the street and city aren't separated by a comma, the unit goes at the end. */
export function withUnit(address:string,unit:string|null){
 const a=address.trim().toUpperCase(),u=(unit??'').trim().toUpperCase().replace(/^(UNIT|APT\.?|APARTMENT|STE\.?|SUITE|#)\s*/,'');
 if(!u||new RegExp(`(UNIT|APT\\.?|APARTMENT|STE\\.?|SUITE|#)\\s*${u.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`).test(a))return a;
 const parts=a.split(',');
 return parts.length>=3?[parts[0].trim(),`UNIT ${u}`,...parts.slice(1).map(p=>p.trim())].join(', '):`${a}, UNIT ${u}`;
}

type Job={id:string;company_id:string;status:string;customer_id:string|null;customer_name:string;move_date:string;arrival_time:string|null;arrival_window_end:string|null;pick_up_address:string;drop_off_address:string;crew_size:number;pricing_model:string;hourly_rate_cents:number|null;flat_rate_cents:number|null;service_charge_cents:number|null;deposit_required_cents:number|null;minimum_minutes:number;billing_increment_minutes:number};
type Stop={position:number;kind:string;address:string;unit:string|null};
type Line={name:string;quantity:number;total_cents:number};
export type Kind='estimate'|'proposal'|'review';
export type Content={kind:Kind;updated:boolean;paragraphs:string[];terms:string[]};
/** Review pages (owner, 2026-11-28). */
export const REVIEW_LINKS:[string,string][]=[
 ['Google','https://g.page/r/CU84UO3dB-NqEBM/review'],
 ['Facebook','https://www.facebook.com/themoverstx/reviews'],
 ['Yelp','https://www.yelp.com/biz/the-movers-plano?osq=the+movers&override_cta=Get+pricing+%26+availability'],
 ['BBB','https://writeyour.review/3X7jWr2']];
const BANNER:Record<Kind,[string,string]>={estimate:['brand/email-estimate.jpg','The Movers: Let’s get you moving'],proposal:['brand/email-proposal.jpg','The Movers: Time to move!'],review:['brand/email-review.jpg','Thanks for moving with The Movers!']};
const office=()=>env('OFFICE_EMAIL')||env('CUSTOMER_REPLY_TO')||'move@themoverz.com';

/** The email body as paragraphs with **bold** marks (the proposal's copy is also shown on the agreement page). */
export function buildContent(kind:Kind,job:Job,name:string,stops:Stop[],lines:Line[],terms:string,updated:boolean,firstName=''):Content{
 const p:string[]=[];
 if(kind==='review'){const hi=(firstName||name).trim();
  return {kind,updated:false,terms:[],paragraphs:[`Hi ${hi},`,
   `Thank you for choosing **THE MOVERS** for your move on **${mdy(job.move_date)}**! We hope everything arrived safely and that you're settling in well.`,
   'Reviews from customers like you help other families find a mover they can trust. Would you take a minute to share your experience?']}}
 if(updated)p.push(kind==='proposal'?'**THIS IS AN UPDATED WRITTEN PROPOSAL. IT REPLACES ANY EARLIER PROPOSAL FOR THIS MOVE.**':'**THIS IS AN UPDATED ESTIMATE. IT REPLACES ANY EARLIER ESTIMATE FOR THIS MOVE.**');
 p.push(`This is a ${kind==='proposal'?'written proposal':'moving estimate'} for **${name.toUpperCase()}** provided by **THE MOVERS**`);
 const w=shortWindow(job.arrival_time,job.arrival_window_end);
 p.push(w?`**MOVE DATE & ARRIVAL WINDOW- ${mdy(job.move_date)} @ ${w}**`:`**MOVE DATE- ${mdy(job.move_date)} (ARRIVAL WINDOW TO BE CONFIRMED)**`);
 const list=stops.length?stops:[{position:1,kind:'pickup',address:job.pick_up_address,unit:null},{position:2,kind:'dropoff',address:job.drop_off_address,unit:null}].filter(s=>s.address);
 const count=(k:string)=>list.filter(s=>s.kind===k).length;const seen:Record<string,number>={};
 for(const s of list){seen[s.kind]=(seen[s.kind]??0)+1;
  const label=list.length===1?'LOCATION':`${s.kind==='pickup'?'PICK-UP':'DROP-OFF'} LOCATION${count(s.kind)>1?' '+seen[s.kind]:''}`;
  p.push(`**${label}- ${withUnit(s.address,s.unit)}**`)}
 const dep=`**DEPOSIT REQUIRED-${dollars(job.deposit_required_cents,true)}**`;
 if(job.pricing_model==='flat')p.push(`This move will be completed by a **${job.crew_size}-MAN** crew for a **FLAT RATE OF ${dollars(job.flat_rate_cents)}**. ${dep}`);
 else{const sc=Number(job.service_charge_cents??0);
  p.push(`This move should be completed by a **${job.crew_size}-MAN** crew @ **${dollars(job.hourly_rate_cents)}/HR**${sc>0?` plus a **${dollars(sc)} SERVICE CHARGE**`:''}. A **${hours(job.minimum_minutes)}-HOUR** minimum is required, any additional time will be billed in **${job.billing_increment_minutes}-MINUTE** increments. ${dep}`)}
 if(lines.length)p.push(`**ADDITIONAL ITEMS-** ${lines.map(l=>`${Number(l.quantity)} ${l.name.toUpperCase()} (${dollars(l.total_cents)})`).join(', ')}`);
 return {kind,updated,paragraphs:p,terms:kind==='proposal'?terms.replace(/\r/g,'').split('\n').map(t=>t.trim()):[]};
}

const P=(html:string,extra='')=>`<p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;${extra}">${html}</p>`;
const button=(href:string,label:string,bg:string,fg:string)=>`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 10px 0;"><tr><td style="background:${bg};border-radius:8px;"><a href="${esc(href)}" style="display:inline-block;min-width:240px;padding:13px 24px;font-size:15px;font-weight:bold;color:${fg};text-decoration:none;text-align:center;">${label}</a></td></tr></table>`;
const signature=(site:string)=>`<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:1px solid #dddddd;padding-top:16px;width:100%;"><tr>
<td style="width:130px;vertical-align:middle;"><img src="${esc(site)}brand/logo-email.png" alt="The Movers" width="110" style="display:block;width:110px;height:auto;border:0;"></td>
<td style="vertical-align:middle;font-size:13px;line-height:1.6;color:#333333;"><b style="font-size:15px;color:#1a1a1a;">The Movers</b><br>Our Faith Can Move Mountains<br>469-200-6699<br><a href="mailto:move@themoverz.com" style="color:#1a3041;">move@themoverz.com</a><br><a href="https://www.themoverz.com" style="color:#1a3041;">www.themoverz.com</a></td></tr></table>`;
const page=(inner:string)=>`<!DOCTYPE html><html lang="en"><body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;"><tr><td>
${inner}
</td></tr></table></td></tr></table></body></html>`;

export function buildEmail(c:Content,site:string,agreeUrl:string|null,problemUrl:string|null=null){
 const subject=c.kind==='review'?'Thank you for moving with The Movers!':c.kind==='proposal'?(c.updated?'Updated Written Proposal':'Written Proposal'):(c.updated?'Updated Moving Estimate':'Moving Estimate from The Movers');
 const banner=`<img src="${esc(site)}${BANNER[c.kind][0]}" alt="${esc(BANNER[c.kind][1])}" width="600" style="display:block;width:600px;max-width:100%;height:auto;border:0;margin:0 0 24px 0;border-radius:6px;">`;
 let body:string;
 if(c.kind==='review'){
  const problem=`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px 0;"><tr><td style="background:#fff6e0;border-left:4px solid #dba931;border-radius:6px;padding:16px 18px;">
<p style="margin:0 0 6px 0;font-size:16px;"><b>Was anything not right with your move?</b></p>
<p style="margin:0 0 14px 0;font-size:15px;line-height:1.5;">Please tell us first. We read every message and will do our best to make it right.</p>
${problemUrl?button(problemUrl,'Tell us about a problem','#dba931','#1a3041'):''}<p style="margin:4px 0 0 0;font-size:14px;">Or call us at <b>469-200-6699</b>, or simply reply to this email.</p></td></tr></table>`;
  body=c.paragraphs.slice(0,2).map(x=>P(rich(x))).join('\n')+problem+P(rich(c.paragraphs[2]??''))
   +REVIEW_LINKS.map(([n,u])=>button(u,`&#9733; Review us on ${esc(n)}`,'#1a3041','#ffffff')).join('');
 }else{
  const termsHtml=c.terms.length?`<div style="margin:4px 0 18px 0;font-size:14px;line-height:1.55;">${c.terms.map(t=>t?`<div><b>***</b> ${rich(t)}</div>`:'<div style="height:18px"></div>').join('')}</div>`:'';
  const agree=agreeUrl?button(agreeUrl,'I have read and agree to the terms','#dba931','#1a3041')+P('<b>*** PLEASE CLICK THE BUTTON ABOVE, OR RESPOND TO THIS EMAIL, TO CONFIRM THAT YOU HAVE READ AND AGREE TO THE TERMS ***</b>')
   :P('Ready to book, or have questions? Just reply to this email or call <b>469-200-6699</b>.');
  body=c.paragraphs.map(x=>P(rich(x))).join('\n')+termsHtml+agree;
 }
 const html=page(banner+body+P('<b>THANK YOU FOR CHOOSING THE MOVERS</b>','margin-top:18px;')+signature(site));
 const text=c.kind==='review'
  ?[...c.paragraphs.slice(0,2),'','Was anything not right with your move? Please tell us first so we can make it right:',problemUrl??'','(or call 469-200-6699, or reply to this email)','',c.paragraphs[2]??'',...REVIEW_LINKS.map(([n,u])=>`Review us on ${n}: ${u}`)].map(plain)
  :[...c.paragraphs.map(plain),'',...c.terms.map(t=>t?'*** '+plain(t):''),'',
   agreeUrl?`To confirm that you have read and agree to the terms, open: ${agreeUrl}\n(or simply respond to this email)`:'Ready to book, or have questions? Reply to this email or call 469-200-6699.'];
 return {subject,html,text:[...text,'','THANK YOU FOR CHOOSING THE MOVERS','','The Movers · Our Faith Can Move Mountains','469-200-6699 · move@themoverz.com · www.themoverz.com'].join('\n')};
}

/** Email to the office about a customer's problem report. */
export function buildComplaintEmail(customer:string,moveDate:string,message:string,phone:string,email:string,appUrl:string){
 const subject=`Customer problem report: ${customer} (move ${mdy(moveDate)})`;
 const html=page(`<h2 style="margin:0 0 12px 0;">A customer reported a problem</h2>
${P(`<b>${esc(customer)}</b> · move on ${esc(mdy(moveDate))}<br>${email?`Email: ${esc(email)}<br>`:''}${phone?`Phone: ${esc(phone)}`:''}`)}
<div style="margin:0 0 16px 0;padding:14px 16px;background:#f5f7f9;border-radius:8px;font-size:15px;line-height:1.55;white-space:pre-wrap;">${esc(message)}</div>
${P(`Reply to this email to answer ${esc(customer)} directly. It is also listed under <b>Complaints</b> in the app: <a href="${esc(appUrl)}">${esc(appUrl)}</a>`)}`);
 const text=[`A customer reported a problem`,`${customer} · move on ${mdy(moveDate)}`,email?`Email: ${email}`:'',phone?`Phone: ${phone}`:'','',message,'',`Reply to this email to answer the customer. Also listed under Complaints in the app: ${appUrl}`].filter(x=>x!==undefined).join('\n');
 return {subject,html,text};
}

const b64=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s)};
const b64url=(bytes:Uint8Array)=>b64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const sha256hex=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');
type Admin=ReturnType<typeof createClient>;
type Result={status:number;body:Record<string,unknown>};
const resend=(key:string,payload:Record<string,unknown>)=>fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify(payload)});

/** Sends the right email for one job and logs it. sentBy is null for automatic emails. */
async function sendForJob(admin:Admin,resendKey:string,companyId:string,jobId:string,reason:string,sentBy:string|null,site:string):Promise<Result>{
 const jr=await admin.from('jobs').select('*').eq('company_id',companyId).eq('id',jobId).single();
 if(jr.error||!jr.data)return {status:404,body:{error:'Job not found'}};
 const job=jr.data as Job;
 const kind:Kind|null=job.status==='estimate'?'estimate':job.status==='booked'?'proposal':job.status==='completed'?'review':null;
 if(!kind)return {status:400,body:{error:'Emails can be sent for estimates, booked jobs and completed jobs only'}};
 const cr=job.customer_id?await admin.from('customers').select('first_name,last_name,name,email,email_opt_out').eq('company_id',companyId).eq('id',job.customer_id).single():{data:null,error:null};
 const to=(cr.data?.email??'').trim();
 if(!to)return {status:400,body:{error:'This customer has no email address. Add one on the Customers screen first.'}};
 if(kind==='review'&&cr.data?.email_opt_out)return {status:400,body:{error:'This customer asked not to receive emails like this (email opt-out), so no review request was sent.'}};
 const [sr,lr,setr]=await Promise.all([admin.from('job_stops').select('position,kind,address,unit').eq('company_id',companyId).eq('job_id',job.id).order('position'),
  admin.from('job_line_items').select('name,quantity,total_cents').eq('company_id',companyId).eq('job_id',job.id).order('position'),
  admin.from('company_settings').select('proposal_terms').eq('company_id',companyId).single()]);
 const name=[cr.data?.first_name,cr.data?.last_name].filter(Boolean).join(' ')||cr.data?.name||job.customer_name;
 const content=buildContent(kind,job,name,(sr.data??[]) as Stop[],(lr.data??[]) as Line[],setr.data?.proposal_terms??'',reason==='date_changed',cr.data?.first_name??'');

 let agreeUrl:string|null=null,problemUrl:string|null=null,proposalId:string|null=null,linkHash:string|null=null,attachments:{filename:string;content:string}[]|undefined;
 if(kind==='proposal'){
  const pdf=await fetch(site+'docs/rights-and-responsibilities.pdf',{signal:AbortSignal.timeout(15000)}).catch(()=>null);
  const bytes=pdf?.ok?new Uint8Array(await pdf.arrayBuffer()):null;
  if(!bytes||bytes.length<1000||bytes.length>10_000_000)return {status:502,body:{error:'Could not load the Rights & Responsibilities PDF to attach. Nothing was sent; try again.'}};
  attachments=[{filename:'rights&responsibilities.pdf',content:b64(bytes)}];
  const token=b64url(crypto.getRandomValues(new Uint8Array(32)));agreeUrl=site+'?agree='+token;
  const ins=await admin.from('job_proposals').insert({company_id:companyId,job_id:job.id,token_hash:await sha256hex(token),content,to_email:to,sent_by:sentBy}).select('id').single();
  if(ins.error||!ins.data)return {status:500,body:{error:'Could not save the proposal. Nothing was sent.'}};
  proposalId=ins.data.id;
 }
 if(kind==='review'){
  const token=b64url(crypto.getRandomValues(new Uint8Array(32)));problemUrl=site+'?problem='+token;linkHash=await sha256hex(token);
  const ins=await admin.from('customer_feedback_links').insert({token_hash:linkHash,company_id:companyId,job_id:job.id});
  if(ins.error)return {status:500,body:{error:'Could not prepare the problem-report link. Nothing was sent.'}};
 }
 const mail=buildEmail(content,site,agreeUrl,problemUrl);
 const sent=await resend(resendKey,{from:env('CUSTOMER_EMAIL_FROM')||'The Movers <move@themoverz.com>',to:[to],reply_to:env('CUSTOMER_REPLY_TO')||'move@themoverz.com',subject:mail.subject,html:mail.html,text:mail.text,...(attachments?{attachments}:{})});
 const body=await sent.json().catch(()=>({}));
 if(!sent.ok&&proposalId)await admin.from('job_proposals').delete().eq('id',proposalId);
 if(!sent.ok&&linkHash)await admin.from('customer_feedback_links').delete().eq('token_hash',linkHash);
 await admin.from('customer_emails').insert({company_id:companyId,job_id:job.id,customer_id:job.customer_id,to_email:to,kind,reason,subject:mail.subject,status:sent.ok?'sent':'failed',provider_id:body?.id??null,error:sent.ok?null:String(body?.message??sent.status).slice(0,500),sent_by:sentBy});
 if(!sent.ok)return {status:502,body:{error:'The email could not be sent: '+(body?.message??'provider error')}};
 return {status:200,body:{ok:true,to,subject:mail.subject,kind}};
}

export async function handler(req:Request){
 const origin=req.headers.get('origin')??'';
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(origin&&allowed(origin))headers['Access-Control-Allow-Origin']=origin;
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!allowed(origin))return reply({error:'Origin not allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'POST required'},405);
 try{
  const url=env('SUPABASE_URL'),publicKey=platformKey('public'),secretKey=platformKey('secret'),resendKey=env('RESEND_API_KEY');
  if(!url||!publicKey||!secretKey)return reply({error:'Server environment is incomplete'},503);
  if(!resendKey)return reply({error:'Customer emails are not set up yet (RESEND_API_KEY missing in Edge Function Secrets).'},503);
  const raw=await req.text();if(raw.length>12000)return reply({error:'Request too large'},413);
  let data;try{data=JSON.parse(raw)}catch{return reply({error:'Invalid request'},400)}
  if(!data||typeof data!=='object')return reply({error:'Invalid request'},400);
  const admin=createClient(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const siteOf=(s:string)=>(s&&allowed(s.replace(/\/$/,''))?s.replace(/\/$/,''):(env('APP_SITE_URL')||'https://app.themoverz.com').replace(/\/$/,''))+'/';

  // 1. Automatic thank-you emails (pg_cron, every 15 minutes).
  if(data.mode==='scheduled'){
   const ok=await admin.rpc('cron_secret_ok',{secret:req.headers.get('x-movers-cron')??''});
   if(ok.error||ok.data!==true)return reply({error:'Not allowed'},403);
   const due=await admin.rpc('due_review_jobs',{max_rows:20});
   if(due.error)return reply({error:'Could not list due emails'},500);
   const results=[];for(const d of (due.data??[]) as {company_id:string;job_id:string}[])results.push((await sendForJob(admin,resendKey,d.company_id,d.job_id,'auto_24h',null,siteOf(String(data.site??'')))).status);
   return reply({ok:true,sent:results.filter(s=>s===200).length,failed:results.filter(s=>s!==200).length});
  }

  // 2. Customer problem report (no login; the link code from the thank-you email).
  if(data.mode==='problem'){
   if(!origin)return reply({error:'Not allowed'},403);
   const token=String(data.token??''),message=String(data.message??'').trim(),phone=String(data.phone??'').trim().slice(0,40);
   if(!/^[A-Za-z0-9_-]{32,100}$/.test(token))return reply({error:'This link is not valid. Please call The Movers at 469-200-6699.'},400);
   if(message.length<3)return reply({error:'Please tell us what happened.'},400);
   if(message.length>5000)return reply({error:'Please keep the message under 5,000 characters.'},400);
   const link=await admin.from('customer_feedback_links').select('company_id,job_id').eq('token_hash',await sha256hex(token)).single();
   if(link.error||!link.data)return reply({error:'This link is not valid. Please call The Movers at 469-200-6699.'},400);
   const {company_id,job_id}=link.data as {company_id:string;job_id:string};
   const recent=await admin.from('job_complaints').select('id',{count:'exact',head:true}).eq('company_id',company_id).eq('job_id',job_id).gte('created_at',new Date(Date.now()-86400000).toISOString());
   if((recent.count??0)>=5)return reply({error:'We already received several messages today. We will contact you soon, or call us at 469-200-6699.'},429);
   const jr=await admin.from('jobs').select('customer_id,customer_name,move_date').eq('company_id',company_id).eq('id',job_id).single();
   if(jr.error||!jr.data)return reply({error:'This link is not valid. Please call The Movers at 469-200-6699.'},400);
   const cr=jr.data.customer_id?await admin.from('customers').select('name,email,phone').eq('company_id',company_id).eq('id',jr.data.customer_id).single():{data:null};
   const name=cr.data?.name||jr.data.customer_name;
   const ins=await admin.from('job_complaints').insert({company_id,job_id,customer_id:jr.data.customer_id,customer_name:name,message,contact_phone:phone||null});
   if(ins.error)return reply({error:'Your message could not be saved. Please call us at 469-200-6699.'},500);
   const mail=buildComplaintEmail(name,jr.data.move_date,message,phone||cr.data?.phone||'',cr.data?.email??'',siteOf(origin));
   const email=(cr.data?.email??'').trim();
   await resend(resendKey,{from:env('CUSTOMER_EMAIL_FROM')||'The Movers <move@themoverz.com>',to:[office()],...(email?{reply_to:email}:{}),subject:mail.subject,html:mail.html,text:mail.text}).catch(()=>null);
   return reply({ok:true});
  }

  // 3. Office requests: signed-in owner or office admin of the company.
  const auth=req.headers.get('authorization')??'';
  if(!auth.startsWith('Bearer '))return reply({error:'Sign in first'},401);
  if(!uuid(data.company_id))return reply({error:'Invalid company'},400);
  const userClient=createClient(url,publicKey,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const verified=await userClient.auth.getUser(auth.slice(7));
  if(verified.error||!verified.data.user)return reply({error:'Your login expired. Sign in again.'},401);
  const me=await userClient.from('company_members').select('role,active').eq('company_id',data.company_id).eq('user_id',verified.data.user.id).single();
  if(me.error||!me.data?.active||!['owner','office_admin'].includes(me.data.role))return reply({error:'Office access required'},403);

  if(data.mode==='schedule'){
   const r=await admin.rpc('configure_review_schedule',{target_company:data.company_id,enabled:data.enabled===true,function_url:url.replace(/\/$/,'')+'/functions/v1/movers-customer-email',site:siteOf(origin)});
   if(r.error)return reply({error:'Could not change the automatic emails setting.'},500);
   return reply({ok:true,enabled:data.enabled===true,result:r.data});
  }
  if(!uuid(data.job_id))return reply({error:'Invalid company or job'},400);
  const reason=['date_changed','booked','manual'].includes(data.reason)?data.reason:'manual';
  const r=await sendForJob(admin,resendKey,data.company_id,data.job_id,reason,verified.data.user.id,siteOf(origin));
  return reply(r.body,r.status);
 }catch{return reply({error:'Could not send the email. Check Edge Function logs.'},500)}
}
Deno.serve(handler);
