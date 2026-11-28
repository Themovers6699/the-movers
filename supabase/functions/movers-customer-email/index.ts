import {createClient} from 'npm:@supabase/supabase-js@2.119.0';

// Emails the customer, in the owner's own format (owner's sample 2026-11-27):
//  * estimate  -> short "Moving Estimate": banner, name, date/window, addresses, pricing, signature.
//  * booked    -> full "Written Proposal": the same plus the *** terms (company_settings.proposal_terms), an
//                 "I agree" link, and the TxDMV Rights & Responsibilities PDF attached. A copy of exactly what was
//                 sent is kept in job_proposals so the customer's agreement can be proven later.
// Office only. Transactional email about the customer's own move, so marketing opt-outs don't apply.
// Secrets: RESEND_API_KEY (required). Optional: CUSTOMER_EMAIL_FROM, CUSTOMER_REPLY_TO, APP_SITE_URL.

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

type Job={id:string;status:string;customer_id:string|null;customer_name:string;move_date:string;arrival_time:string|null;arrival_window_end:string|null;pick_up_address:string;drop_off_address:string;crew_size:number;pricing_model:string;hourly_rate_cents:number|null;flat_rate_cents:number|null;service_charge_cents:number|null;deposit_required_cents:number|null;minimum_minutes:number;billing_increment_minutes:number};
type Stop={position:number;kind:string;address:string;unit:string|null};
type Line={name:string;quantity:number;total_cents:number};
export type Content={kind:'estimate'|'proposal';updated:boolean;paragraphs:string[];terms:string[]};

/** The proposal/estimate body as paragraphs with **bold** marks (also shown on the agreement page). */
export function buildContent(kind:'estimate'|'proposal',job:Job,name:string,stops:Stop[],lines:Line[],terms:string,updated:boolean):Content{
 const p:string[]=[];
 if(updated)p.push(kind==='proposal'?'**THIS IS AN UPDATED WRITTEN PROPOSAL. IT REPLACES ANY EARLIER PROPOSAL FOR THIS MOVE.**':'**THIS IS AN UPDATED ESTIMATE. IT REPLACES ANY EARLIER ESTIMATE FOR THIS MOVE.**');
 p.push(`This is a ${kind==='proposal'?'written proposal':'moving estimate'} for **${name.toUpperCase()}** provided by **THE MOVERS**`);
 const w=shortWindow(job.arrival_time,job.arrival_window_end);
 p.push(w?`**MOVE DATE & ARRIVAL WINDOW- ${mdy(job.move_date)} @ ${w}**`:`**MOVE DATE- ${mdy(job.move_date)} (ARRIVAL WINDOW TO BE CONFIRMED)**`);
 const list=stops.length?stops:[{position:1,kind:'pickup',address:job.pick_up_address,unit:null},{position:2,kind:'dropoff',address:job.drop_off_address,unit:null}].filter(s=>s.address);
 const count=(k:string)=>list.filter(s=>s.kind===k).length;const seen:Record<string,number>={};
 for(const s of list){seen[s.kind]=(seen[s.kind]??0)+1;
  const label=list.length===1?'LOCATION':`${s.kind==='pickup'?'PICK-UP':'DROP-OFF'} LOCATION${count(s.kind)>1?' '+seen[s.kind]:''}`;
  const addr=withUnit(s.address,s.unit);
  p.push(`**${label}- ${addr}**`)}
 const dep=`**DEPOSIT REQUIRED-${dollars(job.deposit_required_cents,true)}**`;
 if(job.pricing_model==='flat')p.push(`This move will be completed by a **${job.crew_size}-MAN** crew for a **FLAT RATE OF ${dollars(job.flat_rate_cents)}**. ${dep}`);
 else{const sc=Number(job.service_charge_cents??0);
  p.push(`This move should be completed by a **${job.crew_size}-MAN** crew @ **${dollars(job.hourly_rate_cents)}/HR**${sc>0?` plus a **${dollars(sc)} SERVICE CHARGE**`:''}. A **${hours(job.minimum_minutes)}-HOUR** minimum is required, any additional time will be billed in **${job.billing_increment_minutes}-MINUTE** increments. ${dep}`)}
 if(lines.length)p.push(`**ADDITIONAL ITEMS-** ${lines.map(l=>`${Number(l.quantity)} ${l.name.toUpperCase()} (${dollars(l.total_cents)})`).join(', ')}`);
 return {kind,updated,paragraphs:p,terms:kind==='proposal'?terms.replace(/\r/g,'').split('\n').map(t=>t.trim()):[]};
}

export function buildEmail(c:Content,site:string,agreeUrl:string|null){
 const subject=c.kind==='proposal'?(c.updated?'Updated Written Proposal':'Written Proposal'):(c.updated?'Updated Moving Estimate':'Moving Estimate from The Movers');
 const P=(html:string,extra='')=>`<p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;${extra}">${html}</p>`;
 const termsHtml=c.terms.length?`<div style="margin:4px 0 18px 0;font-size:14px;line-height:1.55;">${c.terms.map(t=>t?`<div><b>***</b> ${rich(t)}</div>`:'<div style="height:18px"></div>').join('')}</div>`:'';
 const agree=agreeUrl?`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 14px 0;"><tr><td style="background:#dba931;border-radius:8px;"><a href="${esc(agreeUrl)}" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:bold;color:#1a3041;text-decoration:none;">I have read and agree to the terms</a></td></tr></table>`
  +P('<b>*** PLEASE CLICK THE BUTTON ABOVE, OR RESPOND TO THIS EMAIL, TO CONFIRM THAT YOU HAVE READ AND AGREE TO THE TERMS ***</b>'):P('Ready to book, or have questions? Just reply to this email or call <b>469-200-6699</b>.');
 const html=`<!DOCTYPE html><html lang="en"><body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;"><tr><td>
<img src="${esc(site)}brand/email-banner.jpg" alt="A warm hello from The Movers: Time to move" width="420" style="display:block;width:420px;max-width:100%;height:auto;border:0;margin:0 0 24px 0;">
${c.paragraphs.map(x=>P(rich(x))).join('\n')}
${termsHtml}${agree}${P('<b>THANK YOU FOR CHOOSING THE MOVERS</b>','margin-top:18px;')}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:1px solid #dddddd;padding-top:16px;width:100%;"><tr>
<td style="width:130px;vertical-align:middle;"><img src="${esc(site)}brand/logo-email.png" alt="The Movers" width="110" style="display:block;width:110px;height:auto;border:0;"></td>
<td style="vertical-align:middle;font-size:13px;line-height:1.6;color:#333333;"><b style="font-size:15px;color:#1a1a1a;">The Movers</b><br>Our Faith Can Move Mountains<br>469-200-6699<br><a href="mailto:move@themoverz.com" style="color:#1a3041;">move@themoverz.com</a><br><a href="https://www.themoverz.com" style="color:#1a3041;">www.themoverz.com</a></td></tr></table>
</td></tr></table></td></tr></table></body></html>`;
 const text=[...c.paragraphs.map(plain),'',...c.terms.map(t=>t?'*** '+plain(t):''),'',
  agreeUrl?`To confirm that you have read and agree to the terms, open: ${agreeUrl}\n(or simply respond to this email)`:'Ready to book, or have questions? Reply to this email or call 469-200-6699.',
  '','THANK YOU FOR CHOOSING THE MOVERS','','The Movers · Our Faith Can Move Mountains','469-200-6699 · move@themoverz.com · www.themoverz.com'].join('\n');
 return {subject,html,text};
}

const b64=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s)};
const b64url=(bytes:Uint8Array)=>b64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const sha256hex=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');

export async function handler(req:Request){
 const origin=req.headers.get('origin')??'';
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(origin&&allowed(origin))headers['Access-Control-Allow-Origin']=origin;
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!allowed(origin))return reply({error:'Origin not allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'POST required'},405);
 const auth=req.headers.get('authorization')??'';
 if(!auth.startsWith('Bearer '))return reply({error:'Sign in first'},401);
 try{
  const url=env('SUPABASE_URL'),publicKey=platformKey('public'),secretKey=platformKey('secret'),resendKey=env('RESEND_API_KEY');
  if(!url||!publicKey||!secretKey)return reply({error:'Server environment is incomplete'},503);
  if(!resendKey)return reply({error:'Customer emails are not set up yet (RESEND_API_KEY missing in Edge Function Secrets).'},503);
  const raw=await req.text();if(raw.length>2048)return reply({error:'Request too large'},413);
  let data;try{data=JSON.parse(raw)}catch{return reply({error:'Invalid request'},400)}
  if(!uuid(data.company_id)||!uuid(data.job_id))return reply({error:'Invalid company or job'},400);
  const reason=['date_changed','booked','manual'].includes(data.reason)?data.reason:'manual';
  const userClient=createClient(url,publicKey,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const verified=await userClient.auth.getUser(auth.slice(7));
  if(verified.error||!verified.data.user)return reply({error:'Your login expired. Sign in again.'},401);
  const me=await userClient.from('company_members').select('role,active').eq('company_id',data.company_id).eq('user_id',verified.data.user.id).single();
  if(me.error||!me.data?.active||!['owner','office_admin'].includes(me.data.role))return reply({error:'Office access required'},403);

  const admin=createClient(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const jr=await admin.from('jobs').select('*').eq('company_id',data.company_id).eq('id',data.job_id).single();
  if(jr.error||!jr.data)return reply({error:'Job not found'},404);
  const job=jr.data as Job;
  if(!['estimate','booked'].includes(job.status))return reply({error:'Emails can only be sent for estimates and booked jobs'},400);
  const kind=job.status==='estimate'?'estimate':'proposal';
  const cr=job.customer_id?await admin.from('customers').select('first_name,last_name,name,email').eq('company_id',data.company_id).eq('id',job.customer_id).single():{data:null,error:null};
  const to=(cr.data?.email??'').trim();
  if(!to)return reply({error:'This customer has no email address. Add one on the Customers screen first.'},400);
  const [sr,lr,setr]=await Promise.all([admin.from('job_stops').select('position,kind,address,unit').eq('company_id',data.company_id).eq('job_id',job.id).order('position'),
   admin.from('job_line_items').select('name,quantity,total_cents').eq('company_id',data.company_id).eq('job_id',job.id).order('position'),
   admin.from('company_settings').select('proposal_terms').eq('company_id',data.company_id).single()]);
  const site=(origin&&allowed(origin)?origin:(env('APP_SITE_URL')||'https://app.themoverz.com')).replace(/\/?$/,'/');
  const name=[cr.data?.first_name,cr.data?.last_name].filter(Boolean).join(' ')||cr.data?.name||job.customer_name;
  const content=buildContent(kind,job,name,(sr.data??[]) as Stop[],(lr.data??[]) as Line[],setr.data?.proposal_terms??'',reason==='date_changed');

  let agreeUrl:string|null=null,proposalId:string|null=null,attachments:{filename:string;content:string}[]|undefined;
  if(kind==='proposal'){
   const pdf=await fetch(site+'docs/rights-and-responsibilities.pdf',{signal:AbortSignal.timeout(15000)}).catch(()=>null);
   const bytes=pdf?.ok?new Uint8Array(await pdf.arrayBuffer()):null;
   if(!bytes||bytes.length<1000||bytes.length>10_000_000)return reply({error:'Could not load the Rights & Responsibilities PDF to attach. Nothing was sent; try again.'},502);
   attachments=[{filename:'rights&responsibilities.pdf',content:b64(bytes)}];
   const token=b64url(crypto.getRandomValues(new Uint8Array(32)));agreeUrl=site+'?agree='+token;
   const ins=await admin.from('job_proposals').insert({company_id:data.company_id,job_id:job.id,token_hash:await sha256hex(token),content,to_email:to,sent_by:verified.data.user.id}).select('id').single();
   if(ins.error||!ins.data)return reply({error:'Could not save the proposal. Nothing was sent.'},500);
   proposalId=ins.data.id;
  }
  const mail=buildEmail(content,site,agreeUrl);
  const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+resendKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),
   body:JSON.stringify({from:env('CUSTOMER_EMAIL_FROM')||'The Movers <move@themoverz.com>',to:[to],reply_to:env('CUSTOMER_REPLY_TO')||'move@themoverz.com',subject:mail.subject,html:mail.html,text:mail.text,...(attachments?{attachments}:{})})});
  const body=await sent.json().catch(()=>({}));
  if(!sent.ok&&proposalId)await admin.from('job_proposals').delete().eq('id',proposalId);
  await admin.from('customer_emails').insert({company_id:data.company_id,job_id:job.id,customer_id:job.customer_id,to_email:to,kind,reason,subject:mail.subject,status:sent.ok?'sent':'failed',provider_id:body?.id??null,error:sent.ok?null:String(body?.message??sent.status).slice(0,500),sent_by:verified.data.user.id});
  if(!sent.ok)return reply({error:'The email could not be sent: '+(body?.message??'provider error')},502);
  return reply({ok:true,to,subject:mail.subject,kind});
 }catch{return reply({error:'Could not send the email. Check Edge Function logs.'},500)}
}
Deno.serve(handler);
