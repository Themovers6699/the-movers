import {createClient} from 'npm:@supabase/supabase-js@2.119.0';

// Sends the customer an estimate or move confirmation with the job's CURRENT details (date, window, addresses,
// pricing, add-ons, deposit) through Resend, and logs it in customer_emails. Office only. Transactional email about
// the customer's own move (not marketing), so marketing opt-outs don't block it.
// Secrets: RESEND_API_KEY (required). Optional: CUSTOMER_EMAIL_FROM, CUSTOMER_REPLY_TO, APP_SITE_URL (for the logo).

const env=(name:string)=>Deno.env.get(name)??'';
function platformKey(kind:'public'|'secret'){
 const raw=env(kind==='public'?'SUPABASE_PUBLISHABLE_KEYS':'SUPABASE_SECRET_KEYS');
 if(raw){try{const keys=JSON.parse(raw);if(keys.default)return keys.default;}catch{}}
 return env(kind==='public'?'SUPABASE_ANON_KEY':'SUPABASE_SERVICE_ROLE_KEY');
}
function allowed(origin:string){return origin==='https://app.themoverz.com'||origin==='https://the-movers-login-dev.vercel.app'||/^https:\/\/the-movers-login-[a-z0-9]+-the-movers\.vercel\.app$/.test(origin)||/^https:\/\/the-movers-[a-z0-9]+-the-movers\.vercel\.app$/.test(origin)}
const uuid=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const money=(c:number|null|undefined)=>c==null?'—':'$'+(Number(c)/100).toLocaleString('en-US',{minimumFractionDigits:Number(c)%100?2:0,maximumFractionDigits:2});
const t12=(t:string|null)=>{if(!t)return '';const [h,m]=t.slice(0,5).split(':').map(Number);return `${h%12||12}${m?':'+String(m).padStart(2,'0'):''} ${h<12?'AM':'PM'}`};
export const windowText=(a:string|null,b:string|null)=>!a?'To be confirmed':b?`${t12(a)} – ${t12(b)}`:t12(a);
const longDate=(d:string)=>new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric',year:'numeric'});
const SERVICE:Record<string,string>={full_move:'Full move',load_only:'Load only',unload_only:'Unload only',pack_only:'Pack only',same_complex:'Same complex'};
const LOC:Record<string,string>={house:'House',townhouse:'Townhouse',apartment:'Apartment',high_rise:'High-rise',storage:'Storage unit',office:'Office',warehouse:'Warehouse',retail:'Retail',other:'Other'};

type Job={id:string;status:string;customer_id:string|null;customer_name:string;move_date:string;arrival_time:string|null;arrival_window_end:string|null;service_type:string;crew_size:number;pricing_model:string;hourly_rate_cents:number|null;flat_rate_cents:number|null;service_charge_cents:number|null;quoted_total_cents:number|null;deposit_required_cents:number|null;minimum_minutes:number;billing_increment_minutes:number;estimated_minutes:number|null;add_ons_cents:number};
type Stop={position:number;kind:string;address:string;location_type:string|null;bedrooms:number|null;floor:number|null;unit:string|null};
type Line={name:string;quantity:number;unit_label:string;total_cents:number};

/** Subject + HTML + text for the email (exported for tests). */
export function buildEmail(job:Job,firstName:string,stops:Stop[],lines:Line[],logoUrl:string,reason:string){
 const confirmed=job.status!=='estimate';
 const subject=confirmed?(reason==='date_changed'?`Updated move details – ${longDate(job.move_date)}`:`Your move is confirmed – ${longDate(job.move_date)}`):'Your moving estimate from The Movers';
 const intro=confirmed?(reason==='date_changed'?'Your move details have been updated. Here is your confirmation with the latest information.':'Thank you for choosing The Movers! Your move is booked. Here are the details.')
  :(reason==='date_changed'?'Your estimate has been updated with new details.':'Thank you for your interest in The Movers. Here is your moving estimate.');
 const stopRows=stops.map(s=>{const extra=[s.location_type?LOC[s.location_type]??s.location_type:'',s.bedrooms==null?'':s.bedrooms===0?'Studio':`${s.bedrooms} BR`,s.floor==null?'':`Floor ${s.floor}`,s.unit?`Unit ${s.unit}`:''].filter(Boolean).join(' · ');
  return `<tr><td style="padding:6px 0;color:#55758a;vertical-align:top;width:110px">${s.kind==='pickup'?'Pick-up':'Drop-off'}</td><td style="padding:6px 0">${esc(s.address)}${extra?`<br><span style="color:#778995;font-size:13px">${esc(extra)}</span>`:''}</td></tr>`}).join('');
 const price=job.pricing_model==='hourly'
  ?`${job.crew_size} movers at <b>${money(job.hourly_rate_cents)}/hour</b> (${job.minimum_minutes/60}-hour minimum, ${job.billing_increment_minutes}-minute increments)<br>Service charge: <b>${money(job.service_charge_cents)}</b>`
  :`Flat rate: <b>${money(job.flat_rate_cents)}</b>`;
 const addOns=lines.length?`<p style="margin:12px 0 4px 0;font-weight:bold">Add-ons</p><table role="presentation" style="font-size:14px">${lines.map(l=>`<tr><td style="padding:2px 12px 2px 0">${Number(l.quantity)} × ${esc(l.name)}</td><td style="padding:2px 0">${money(l.total_cents)}</td></tr>`).join('')}</table>`:'';
 const hours=job.pricing_model==='hourly'&&job.estimated_minutes?`<p style="margin:8px 0 0 0;color:#55758a;font-size:13px">Estimated time: about ${(Math.max(job.minimum_minutes,Math.ceil(job.estimated_minutes/job.billing_increment_minutes)*job.billing_increment_minutes)/60).toString()} hours. The final charge depends on the actual time.</p>`:'';
 const html=`<!DOCTYPE html><html lang="en"><body style="margin:0;padding:0;background:#f5f7f9;font-family:Arial,Helvetica,sans-serif;color:#1a3041;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f9;padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #dce4e9;">
<tr><td align="center" style="background:#ffffff;padding:28px 24px 22px 24px;border-bottom:4px solid #dba931;"><img src="${esc(logoUrl)}" alt="The Movers" width="180" style="display:block;width:180px;max-width:70%;height:auto;border:0;"></td></tr>
<tr><td style="padding:28px 32px 8px 32px;"><h1 style="margin:0 0 14px 0;font-size:22px;">${confirmed?'Move confirmation':'Moving estimate'}</h1>
<p style="margin:0 0 18px 0;font-size:16px;line-height:1.6;">Hi ${esc(firstName)},<br>${intro}</p>
<table role="presentation" style="width:100%;font-size:15px;line-height:1.4;border-collapse:collapse;">
<tr><td style="padding:6px 0;color:#55758a;width:110px">Date</td><td style="padding:6px 0"><b>${esc(longDate(job.move_date))}</b></td></tr>
<tr><td style="padding:6px 0;color:#55758a">Arrival</td><td style="padding:6px 0"><b>${esc(windowText(job.arrival_time,job.arrival_window_end))}</b></td></tr>
<tr><td style="padding:6px 0;color:#55758a">Service</td><td style="padding:6px 0">${esc(SERVICE[job.service_type]??job.service_type)}</td></tr>
${stopRows}</table>
<div style="margin:18px 0;padding:16px;background:#f5f7f9;border-radius:8px;font-size:15px;line-height:1.6;">${price}${addOns}
<p style="margin:12px 0 0 0;font-size:17px;">${confirmed?'Estimated total':'Estimate'}: <b>${money(job.quoted_total_cents)}</b></p>
<p style="margin:4px 0 0 0;">Deposit: <b>${money(job.deposit_required_cents)}</b></p>${hours}</div>
<p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;">Questions or changes? Just reply to this email or call us at 469-200-6699.</p></td></tr>
<tr><td style="background:#f5f7f9;padding:18px 32px;border-top:1px solid #dce4e9;"><p style="margin:0;font-size:12px;line-height:1.6;color:#778995;">The Movers · Plano, Texas · move@themoverz.com · 469-200-6699</p></td></tr>
</table></td></tr></table></body></html>`;
 const text=[`${confirmed?'Move confirmation':'Moving estimate'} – The Movers`,'',`Hi ${firstName},`,intro,'',`Date: ${longDate(job.move_date)}`,`Arrival: ${windowText(job.arrival_time,job.arrival_window_end)}`,`Service: ${SERVICE[job.service_type]??job.service_type}`,
  ...stops.map(s=>`${s.kind==='pickup'?'Pick-up':'Drop-off'}: ${s.address}`),'',
  job.pricing_model==='hourly'?`${job.crew_size} movers at ${money(job.hourly_rate_cents)}/hour; service charge ${money(job.service_charge_cents)}`:`Flat rate: ${money(job.flat_rate_cents)}`,
  ...lines.map(l=>`${Number(l.quantity)} x ${l.name}: ${money(l.total_cents)}`),
  `${confirmed?'Estimated total':'Estimate'}: ${money(job.quoted_total_cents)}`,`Deposit: ${money(job.deposit_required_cents)}`,'','Questions? Reply to this email or call 469-200-6699.','The Movers · Plano, Texas'].join('\n');
 return {subject,html,text};
}

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
  const reason=['date_changed','manual'].includes(data.reason)?data.reason:'manual';
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
  const cr=job.customer_id?await admin.from('customers').select('first_name,name,email').eq('company_id',data.company_id).eq('id',job.customer_id).single():{data:null,error:null};
  const to=(cr.data?.email??'').trim();
  if(!to)return reply({error:'This customer has no email address. Add one on the Customers screen first.'},400);
  const [sr,lr]=await Promise.all([admin.from('job_stops').select('position,kind,address,location_type,bedrooms,floor,unit').eq('company_id',data.company_id).eq('job_id',job.id).order('position'),
   admin.from('job_line_items').select('name,quantity,unit_label,total_cents').eq('company_id',data.company_id).eq('job_id',job.id).order('position')]);
  const logo=(env('APP_SITE_URL')||'https://app.themoverz.com/').replace(/\/?$/,'/')+'brand/logo-email.png';
  const mail=buildEmail(job,cr.data?.first_name||cr.data?.name||job.customer_name,(sr.data??[]) as Stop[],(lr.data??[]) as Line[],logo,reason);
  const kind=job.status==='estimate'?'estimate':'confirmation';
  const sent=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+resendKey,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),
   body:JSON.stringify({from:env('CUSTOMER_EMAIL_FROM')||'The Movers <no-reply@themoverz.com>',to:[to],reply_to:env('CUSTOMER_REPLY_TO')||'move@themoverz.com',subject:mail.subject,html:mail.html,text:mail.text})});
  const body=await sent.json().catch(()=>({}));
  await admin.from('customer_emails').insert({company_id:data.company_id,job_id:job.id,customer_id:job.customer_id,to_email:to,kind,reason,subject:mail.subject,status:sent.ok?'sent':'failed',provider_id:body?.id??null,error:sent.ok?null:String(body?.message??sent.status).slice(0,500),sent_by:verified.data.user.id});
  if(!sent.ok)return reply({error:'The email could not be sent: '+(body?.message??'provider error')},502);
  return reply({ok:true,to,subject:mail.subject});
 }catch{return reply({error:'Could not send the email. Check Edge Function logs.'},500)}
}
Deno.serve(handler);
