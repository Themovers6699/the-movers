import {useEffect,useState} from 'react';
import {supabase} from './supabase';
import {roleLabel,errorText,type Role} from './access';
import {formatPhone} from './phone';
import {upcomingBirthdays,monthName,daysInMonth} from './birthdays';

type Member={user_id:string;display_name:string;role:Role;active:boolean};
type Profile={user_id:string;phone:string|null;address_line:string|null;city:string|null;state:string|null;postal_code:string|null;worker_type:string|null;start_date:string|null;office_notes:string|null;emergency_contact_name:string|null;emergency_contact_phone:string|null;birthday_month:number|null;birthday_day:number|null;end_date:string|null;separation_reason:string|null;separation_note:string|null};
type Rate={user_id:string;hourly_rate_cents:number;effective_date:string;created_by:string|null};
type Directory={user_id:string;email:string;invite_pending:boolean;last_sign_in_at:string|null};

const WORKER_TYPES:[string,string][]=[['1099_contractor','1099 contractor'],['w2_employee','W-2 employee'],['owner_salaried','Owner (salaried)']];
const money=(cents:number)=>(cents/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
const todayIn=(tz:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const blankForm={display_name:'',role:'mover' as Role,active:true,worker_type:'',phone:'',address_line:'',city:'',state:'',postal_code:'',start_date:'',office_notes:'',emergency_contact_name:'',emergency_contact_phone:'',birthday_month:'',birthday_day:'',end_date:'',separation_reason:'',separation_note:'',wage:'',rate_effective_date:'',email:''};
const REASONS:[string,string][]=[['quit','Quit / resigned'],['let_go','Let go'],['seasonal','Seasonal / end of season'],['other','Other']];
// Server functions return {error} in their JSON body on failure.
async function invoke(name:string,body:Record<string,unknown>){const r=await supabase.functions.invoke(name,{body});if(r.error){let detail='Could not reach the server. Try again.';try{const b=await r.error.context.json();detail=b.error??detail}catch{}throw Error(detail)}if(r.data?.error)throw Error(r.data.error);return r.data}

export default function Staff({companyId,myUserId,myRole,timezone='America/Chicago',onChanged}:{companyId:string;myUserId:string;myRole:Role;timezone?:string;onChanged:()=>void}){
 const [members,setMembers]=useState<Member[]>([]),[profiles,setProfiles]=useState<Record<string,Profile>>({}),[rates,setRates]=useState<Rate[]>([]),[directory,setDirectory]=useState<Record<string,Directory>>({});
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[revision,setRevision]=useState(0);
 const [selected,setSelected]=useState(''),[form,setForm]=useState(blankForm),[showInactive,setShowInactive]=useState(false);
 const [invite,setInvite]=useState({name:'',email:'',role:'mover' as Role});
 const today=todayIn(timezone);

 useEffect(()=>{let live=true;setLoading(true);setError('');
  Promise.all([
   supabase.from('company_members').select('user_id,display_name,role,active').eq('company_id',companyId).order('display_name'),
   supabase.from('staff_profiles').select('*').eq('company_id',companyId),
   supabase.from('staff_pay_rates').select('user_id,hourly_rate_cents,effective_date,created_by').eq('company_id',companyId).order('effective_date',{ascending:false}),
   supabase.rpc('staff_directory',{target_company:companyId})
  ]).then(([m,p,r,d])=>{if(!live)return;const bad=[m,p,r,d].find(x=>x.error);if(bad?.error)throw bad.error;
   setMembers((m.data??[]) as Member[]);setProfiles(Object.fromEntries(((p.data??[]) as Profile[]).map(x=>[x.user_id,x])));
   setRates((r.data??[]) as Rate[]);setDirectory(Object.fromEntries(((d.data??[]) as Directory[]).map(x=>[x.user_id,x])));
  }).catch(e=>{if(live)setError(errorText(e,'Could not load staff.'))}).finally(()=>{if(live)setLoading(false)});
  return()=>{live=false}},[companyId,revision]);

 const ratesFor=(id:string)=>rates.filter(r=>r.user_id===id);
 const currentRate=(id:string)=>ratesFor(id).find(r=>r.effective_date<=today)??null;
 const nameOf=(id:string|null)=>id?members.find(m=>m.user_id===id)?.display_name??'Former staff member':'Supabase dashboard / system';
 const status=(m:Member)=>!m.active?(profiles[m.user_id]?.end_date?'Inactive since '+profiles[m.user_id].end_date:'Inactive'):directory[m.user_id]?.invite_pending?'Invite pending':'Active';
 const sel=members.find(m=>m.user_id===selected);
 const isOwnerRow=sel?.role==='owner', isMe=selected===myUserId;
 const canEditRow=!!sel&&(!isOwnerRow||myRole==='owner');

 function open(m:Member){const p=profiles[m.user_id];setMessage('');setError('');setSelected(m.user_id);
  setForm({display_name:m.display_name,role:m.role,active:m.active,worker_type:p?.worker_type??'',phone:formatPhone(p?.phone),address_line:p?.address_line??'',city:p?.city??'',state:p?.state??'',postal_code:p?.postal_code??'',start_date:p?.start_date??'',office_notes:p?.office_notes??'',emergency_contact_name:p?.emergency_contact_name??'',emergency_contact_phone:formatPhone(p?.emergency_contact_phone),birthday_month:p?.birthday_month?String(p.birthday_month):'',birthday_day:p?.birthday_day?String(p.birthday_day):'',end_date:p?.end_date??'',separation_reason:p?.separation_reason??'',separation_note:p?.separation_note??'',wage:'',rate_effective_date:today,email:directory[m.user_id]?.email??''});
  window.scrollTo({top:0,behavior:'smooth'})}
 const change=(k:keyof typeof blankForm,v:string|boolean)=>setForm(f=>({...f,[k]:v}));

 async function save(e:React.FormEvent){e.preventDefault();if(busy||!sel)return;setBusy(true);setError('');setMessage('');
  try{const wage=form.wage.trim();if(wage&&!/^\d+(\.\d{1,2})?$/.test(wage))throw Error('Enter the hourly wage as a number, e.g. 18 or 18.50');
   const r=await supabase.rpc('save_staff_profile',{target_company:companyId,target_user:sel.user_id,payload:{display_name:form.display_name,role:form.role,active:form.active,worker_type:form.worker_type,phone:form.phone,address_line:form.address_line,city:form.city,state:form.state,postal_code:form.postal_code,start_date:form.start_date,office_notes:form.office_notes,emergency_contact_name:form.emergency_contact_name,emergency_contact_phone:form.emergency_contact_phone,birthday_month:form.birthday_month,birthday_day:form.birthday_day,end_date:form.end_date,separation_reason:form.separation_reason,separation_note:form.separation_note,hourly_rate_cents:wage?Math.round(Number(wage)*100):null,rate_effective_date:form.rate_effective_date}});
   if(r.error)throw r.error;setMessage('Saved '+form.display_name.trim()+'.');setForm(f=>({...f,wage:''}));setRevision(n=>n+1);onChanged()}
  catch(e){setError(errorText(e,'Could not save this staff member.'))}finally{setBusy(false)}}

 async function changeEmail(){if(busy||!sel)return;const email=form.email.trim();if(email.toLowerCase()===(directory[sel.user_id]?.email??'').toLowerCase()){setMessage('The email is unchanged.');return}
  if(!window.confirm(`Change ${sel.display_name}'s login email to ${email}? From now on they must sign in with the new address.`))return;
  setBusy(true);setError('');setMessage('');try{const d=await invoke('movers-staff-email',{company_id:companyId,user_id:sel.user_id,email});setMessage(d.note??'Login email changed.');setRevision(n=>n+1)}
  catch(e){setError(errorText(e,'Could not change the email.'))}finally{setBusy(false)}}

 async function sendInvite(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError('');setMessage('');
  try{const d=await invoke('movers-staff-invite',{company_id:companyId,email:invite.email.trim(),name:invite.name.trim(),role:invite.role});
   setMessage(d.invited?'Invite sent to '+invite.email.trim()+'. They choose their own password from the email link; their access is already set up.':d.password_email?'Access granted. '+invite.name.trim()+' had not finished setting a password, so a set-password email was sent to '+invite.email.trim()+'.':'Access granted. '+invite.name.trim()+' already had a login and can sign in now.');
   setInvite({name:'',email:'',role:'mover'});setRevision(n=>n+1);onChanged()}
  catch(e){setError(errorText(e,'Could not send the invite.'))}finally{setBusy(false)}}

 const visible=members.filter(m=>showInactive||m.active);
 const birthdays=upcomingBirthdays(members.filter(m=>m.active&&profiles[m.user_id]?.birthday_month&&profiles[m.user_id]?.birthday_day).map(m=>({name:m.display_name,month:profiles[m.user_id].birthday_month!,day:profiles[m.user_id].birthday_day!})),today);
 return <>
  <p role="alert" className="error">{error}</p><p role="status" className="success">{message}</p>
  {sel&&<section className="panel"><div className="sectionheading"><h2>{sel.display_name}</h2><button type="button" className="secondary" onClick={()=>setSelected('')}>Close</button></div>
   {!canEditRow?<p>Only the owner can edit the owner's record.</p>:<form onSubmit={save}>
    <fieldset disabled={busy}>
    <h3>Access</h3><div className="fields">
     <label>Full name<input required maxLength={150} value={form.display_name} onChange={e=>change('display_name',e.target.value)}/></label>
     <label>Role{isOwnerRow?<input value="Owner" disabled/>:<select value={form.role} disabled={isMe} onChange={e=>change('role',e.target.value)}><option value="mover">Mover</option><option value="crew_leader">Crew leader</option><option value="office_admin">Office admin</option></select>}</label>
     <label>Worker type<select value={form.worker_type} onChange={e=>change('worker_type',e.target.value)}><option value="">Not set</option>{WORKER_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
     <label>Start date<input type="date" value={form.start_date} onChange={e=>change('start_date',e.target.value)}/></label>
     <div className="field"><span className="fieldlabel">Birthday <small>(month and day only)</small></span><div className="pair"><select aria-label="Birthday month" value={form.birthday_month} onChange={e=>{const m=e.target.value;setForm(f=>({...f,birthday_month:m,birthday_day:m&&Number(f.birthday_day)>daysInMonth(Number(m))?'':f.birthday_day}))}}><option value="">Month</option>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{monthName(i+1)}</option>)}</select><select aria-label="Birthday day" value={form.birthday_day} disabled={!form.birthday_month} onChange={e=>change('birthday_day',e.target.value)}><option value="">Day</option>{Array.from({length:form.birthday_month?daysInMonth(Number(form.birthday_month)):31},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></div></div>
    </div>
    <label className="inlinecheck"><input type="checkbox" checked={form.active} disabled={isOwnerRow||isMe} onChange={e=>{const on=e.target.checked;setForm(f=>({...f,active:on,end_date:on?'':f.end_date||today,separation_reason:on?'':f.separation_reason,separation_note:on?'':f.separation_note}))}}/>Active: can sign in and be assigned to jobs{(isOwnerRow||isMe)?' (you cannot switch off your own or the owner\'s access)':''}</label>
    {!form.active&&<div className="notice"><b>Leaving the company.</b> Their record, contact details and pay history are kept (for the 1099 and your records), but they can't see any company data or be assigned to jobs. Tick Active again to restore access.<div className="fields"><label>End date<input type="date" required value={form.end_date} onChange={e=>change('end_date',e.target.value)}/></label><label>Reason<select required value={form.separation_reason} onChange={e=>change('separation_reason',e.target.value)}><option value="">Choose…</option>{REASONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>Note (optional)<input maxLength={1000} value={form.separation_note} onChange={e=>change('separation_note',e.target.value)}/></label></div></div>}
    <h3>Contact</h3><div className="fields">
     <label>Phone<input type="tel" value={form.phone} onChange={e=>change('phone',e.target.value)} placeholder="(469) 555-1234"/></label>
     <label>Street address<input maxLength={200} value={form.address_line} onChange={e=>change('address_line',e.target.value)}/></label>
     <label>City<input maxLength={100} value={form.city} onChange={e=>change('city',e.target.value)}/></label>
     <label>State<input maxLength={40} value={form.state} onChange={e=>change('state',e.target.value)} placeholder="TX"/></label>
     <label>ZIP<input maxLength={20} value={form.postal_code} onChange={e=>change('postal_code',e.target.value)}/></label>
    </div>
    <h3>Emergency contact</h3><div className="fields">
     <label>Name<input maxLength={150} value={form.emergency_contact_name} onChange={e=>change('emergency_contact_name',e.target.value)}/></label>
     <label>Phone<input type="tel" value={form.emergency_contact_phone} onChange={e=>change('emergency_contact_phone',e.target.value)}/></label>
    </div>
    <h3>Pay</h3>
    <p>Current hourly wage: <b>{currentRate(sel.user_id)?money(currentRate(sel.user_id)!.hourly_rate_cents):'not set'}</b>{currentRate(sel.user_id)?' since '+currentRate(sel.user_id)!.effective_date:''}</p>
    <div className="fields">
     <label>New hourly wage ($)<input inputMode="decimal" value={form.wage} onChange={e=>change('wage',e.target.value)} placeholder="Leave blank to keep"/></label>
     <label>Effective from<input type="date" value={form.rate_effective_date} onChange={e=>change('rate_effective_date',e.target.value)}/></label>
    </div>
    {ratesFor(sel.user_id).length>0&&<div className="tablewrap"><table><thead><tr><th>Effective from</th><th>Hourly wage</th><th>Set by</th></tr></thead><tbody>{ratesFor(sel.user_id).map(r=><tr key={r.effective_date}><td>{r.effective_date}</td><td>{money(r.hourly_rate_cents)}</td><td>{nameOf(r.created_by)}</td></tr>)}</tbody></table></div>}
    <h3>Office notes</h3>
    <label>Private notes (office only)<textarea maxLength={4000} rows={3} value={form.office_notes} onChange={e=>change('office_notes',e.target.value)}/></label>
    <button className="primary">{busy?'Saving…':'Save changes'}</button>
    </fieldset>
   </form>}
   {canEditRow&&<><h3>Login email</h3>
    {isOwnerRow?<p>{form.email}. The owner's login email can't be changed here.</p>:<div className="fields"><label>Email they sign in with<input type="email" value={form.email} disabled={busy} onChange={e=>change('email',e.target.value)}/></label><button type="button" className="secondary" disabled={busy} onClick={changeEmail}>Change login email</button></div>}
    {directory[sel.user_id]?.invite_pending&&<p className="warning">This person hasn't finished setting a password yet. Use "Send invite" below with the same email to send them a new link.</p>}</>}
  </section>}
  <section className="panel"><div className="sectionheading"><h2>Staff</h2><label className="inlinecheck"><input type="checkbox" checked={showInactive} onChange={e=>setShowInactive(e.target.checked)}/>Show inactive</label></div>
   <p>Click a person to view or edit their details, pay and access.</p>
   {birthdays.length>0&&<div className="notice"><b>Upcoming birthdays:</b> {birthdays.map(b=>b.name+' – '+monthName(b.month).slice(0,3)+' '+b.day+(b.inDays===0?' (today!)':b.inDays===1?' (tomorrow)':' (in '+b.inDays+' days)')).join(' · ')}</div>}
   {loading?<p>Loading staff…</p>:<div className="tablewrap"><table className="clickable"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Phone</th><th>Email</th><th>Wage</th></tr></thead><tbody>
    {visible.map(m=><tr key={m.user_id} tabIndex={0} className={m.user_id===selected?'selected':''} onClick={()=>open(m)} onKeyDown={e=>{if(e.key==='Enter')open(m)}}><td>{m.display_name}</td><td>{roleLabel(m.role)}</td><td>{status(m)}</td><td>{formatPhone(profiles[m.user_id]?.phone)||'—'}</td><td>{directory[m.user_id]?.email??'—'}</td><td>{currentRate(m.user_id)?money(currentRate(m.user_id)!.hourly_rate_cents)+'/h':'—'}</td></tr>)}
   </tbody></table></div>}
  </section>
  <section className="panel"><h2>Invite a staff member</h2><p>Enter their name, email and role. They get an email from The Movers with a link to choose their own password. If they already have a login, access is granted right away.</p>
   <form onSubmit={sendInvite}><div className="fields">
    <label>Full name<input required maxLength={150} value={invite.name} onChange={e=>setInvite(v=>({...v,name:e.target.value}))}/></label>
    <label>Email<input required type="email" value={invite.email} onChange={e=>setInvite(v=>({...v,email:e.target.value}))}/></label>
    <label>Role<select value={invite.role} onChange={e=>setInvite(v=>({...v,role:e.target.value as Role}))}><option value="mover">Mover</option><option value="crew_leader">Crew leader</option><option value="office_admin">Office admin</option></select></label>
   </div><button className="primary" disabled={busy}>{busy?'Sending…':'Send invite'}</button></form>
  </section>
 </>;
}
