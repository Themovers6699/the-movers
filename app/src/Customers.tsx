import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';
import {errorText} from './access';
import {formatPhone} from './phone';
import {describeRecordHistory,CUSTOMER_FIELDS,type AuditRow,type HistoryEntry} from './history';

type Customer={id:string;name:string;first_name:string|null;last_name:string|null;email:string|null;phone:string|null;phone2:string|null;referral_source:string|null;tags:string[];office_notes:string|null;job_count:number;last_move_date:string|null;total_matches:number};
type Move={id:string;move_date:string;status:string;quoted_total_cents:number|null;pick_up_address:string;drop_off_address:string};

export const REFERRALS:[string,string][]=[['google','Google'],['facebook','Facebook'],['instagram','Instagram'],['yelp','Yelp'],['nextdoor','Nextdoor'],['friend_family','Friend / family'],['realtor','Realtor'],['apartment_manager','Apartment manager'],['repeat_customer','Repeat customer'],['website','Our website'],['other','Other']];
export const TAGS:[string,string][]=[['repeat','Repeat'],['vip','VIP'],['referral','Referral']];
export const tagLabel=(t:string)=>TAGS.find(x=>x[0]===t)?.[1]??t;
const referralLabel=(v:string|null)=>REFERRALS.find(r=>r[0]===v)?.[1]??'—';
const money=(c:number|null)=>c===null?'—':(c/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
const blank={id:'',first_name:'',last_name:'',email:'',phone:'',phone2:'',referral_source:'',tags:[] as string[],office_notes:''};
const statusClass=(s:string)=>s==='cancelled'?'badge-off':s==='completed'?'badge-done':s==='estimate'?'badge-pending':'badge-on';

export default function Customers({companyId}:{companyId:string}){
 const [query,setQuery]=useState(''),[rows,setRows]=useState<Customer[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[revision,setRevision]=useState(0);
 const [openId,setOpenId]=useState<string|null>(null),[form,setForm]=useState(blank),[moves,setMoves]=useState<Move[]>([]),[history,setHistory]=useState<HistoryEntry[]>([]),[names,setNames]=useState<Record<string,string>>({});
 const panelRef=useRef<HTMLElement|null>(null);

 // Search as you type (short pause so every keystroke doesn't hit the server).
 useEffect(()=>{let live=true;setLoading(true);const t=setTimeout(()=>{
  Promise.resolve(supabase.rpc('search_customers',{target_company:companyId,query,max_rows:200})).then(r=>{if(!live)return;if(r.error)throw r.error;setRows((r.data??[]) as Customer[])})
   .catch((e:unknown)=>{if(live)setError(errorText(e,'Could not search customers.'))}).finally(()=>{if(live)setLoading(false)})},query?300:0);
  return()=>{live=false;clearTimeout(t)}},[companyId,query,revision]);

 // Moves and change history for the open customer.
 useEffect(()=>{if(!openId){setMoves([]);setHistory([]);return}let live=true;
  Promise.all([
   supabase.from('jobs').select('id,move_date,status,quoted_total_cents,pick_up_address,drop_off_address').eq('company_id',companyId).eq('customer_id',openId).order('move_date',{ascending:false}),
   supabase.from('audit_log').select('id,table_name,row_id,action,actor,at,old_row,new_row').eq('company_id',companyId).eq('table_name','customers').eq('row_id',openId).order('id',{ascending:false}).limit(200),
   supabase.from('company_members').select('user_id,display_name').eq('company_id',companyId)
  ]).then(([j,a,m])=>{if(!live)return;const bad=[j,a,m].find(x=>x.error);if(bad?.error)throw bad.error;
   setMoves((j.data??[]) as Move[]);setHistory(describeRecordHistory((a.data??[]) as AuditRow[],CUSTOMER_FIELDS,'Customer created'));
   setNames(Object.fromEntries((m.data??[]).map(x=>[x.user_id,x.display_name])))})
  .catch(e=>{if(live)setError(errorText(e,'Could not load this customer\'s moves.'))});
  return()=>{live=false}},[companyId,openId,revision]);

 function open(c?:Customer){setError('');setMessage('');
  if(!c){setOpenId('');setForm(blank)}
  else{setOpenId(c.id);setForm({id:c.id,first_name:c.first_name??c.name,last_name:c.last_name??'',email:c.email??'',phone:formatPhone(c.phone),phone2:formatPhone(c.phone2),referral_source:c.referral_source??'',tags:c.tags??[],office_notes:c.office_notes??''})}
  setTimeout(()=>panelRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),0)}
 const change=(k:keyof typeof blank,v:string)=>setForm(f=>({...f,[k]:v}));
 const toggleTag=(t:string)=>setForm(f=>({...f,tags:f.tags.includes(t)?f.tags.filter(x=>x!==t):[...f.tags,t]}));

 async function save(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError('');setMessage('');
  try{const r=await supabase.rpc('save_customer',{target_company:companyId,payload:form});if(r.error)throw r.error;
   setMessage((form.id?'Saved ':'Added ')+[form.first_name,form.last_name].filter(Boolean).join(' ')+'.');setOpenId(r.data as string);setForm(f=>({...f,id:r.data as string}));setRevision(n=>n+1)}
  catch(e){setError(errorText(e,'Could not save this customer.'))}finally{setBusy(false)}}

 const total=rows[0]?.total_matches??0;
 const who=(a:string|null)=>a?names[a]??'Former staff member':'Supabase dashboard / system';
 const when=(at:string)=>new Date(at).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
 return <>
  <p role="alert" className="error">{error}</p><p role="status" className="success">{message}</p>
  {openId!==null&&<section className="panel" ref={panelRef}>
   <div className="sectionheading"><h2>{form.id?[form.first_name,form.last_name].filter(Boolean).join(' ')||'Customer':'New customer'}</h2><button type="button" className="secondary" onClick={()=>setOpenId(null)}>Close</button></div>
   <form onSubmit={save}><fieldset disabled={busy}>
    <div className="fields">
     <label>First name<input required maxLength={100} value={form.first_name} onChange={e=>change('first_name',e.target.value)}/></label>
     <label>Last name<input maxLength={100} value={form.last_name} onChange={e=>change('last_name',e.target.value)}/></label>
     <label>Phone<input type="tel" value={form.phone} onChange={e=>change('phone',e.target.value)} placeholder="(469) 555-1234"/></label>
     <label>Second phone<input type="tel" value={form.phone2} onChange={e=>change('phone2',e.target.value)}/></label>
     <label>Email<input type="email" value={form.email} onChange={e=>change('email',e.target.value)}/></label>
     <label>How did they hear about us?<select value={form.referral_source} onChange={e=>change('referral_source',e.target.value)}><option value="">Not recorded</option>{REFERRALS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    </div>
    <div className="field"><span className="fieldlabel">Tags</span><div className="tagpicker">{TAGS.map(([v,l])=><button type="button" key={v} aria-pressed={form.tags.includes(v)} className={'tagpill '+(form.tags.includes(v)?'tag-'+v:'')} onClick={()=>toggleTag(v)}>{form.tags.includes(v)?'✓ ':''}{l}</button>)}</div></div>
    <label>Office notes (private, office only)<textarea rows={3} maxLength={4000} value={form.office_notes} onChange={e=>change('office_notes',e.target.value)}/></label>
    {form.id&&<small>Name changes also update this customer's open estimates and booked jobs. Completed jobs keep the name they were done under.</small>}
    <button className="primary">{busy?'Saving…':form.id?'Save customer':'Add customer'}</button>
   </fieldset></form>
   {form.id&&<><h3>Moves ({moves.length})</h3>
    {moves.length?<div className="tablewrap"><table><thead><tr><th>Date</th><th>Status</th><th>Pick-up → Drop-off</th><th>Quote</th></tr></thead><tbody>
     {moves.map(m=><tr key={m.id}><td>{m.move_date}</td><td><span className={'badge '+statusClass(m.status)}>{m.status.replaceAll('_',' ')}</span></td><td>{m.pick_up_address} → {m.drop_off_address}</td><td>{money(m.quoted_total_cents)}</td></tr>)}
    </tbody></table></div>:<p>No estimates or moves yet. Create one from the Estimates tab.</p>}
    <h3>Change history</h3>
    {history.length?<div className="tablewrap"><table><thead><tr><th>When</th><th>Who</th><th>What changed</th></tr></thead><tbody>
     {history.map((h,i)=><tr key={i}><td>{when(h.at)}</td><td>{who(h.actor)}</td><td>{h.changes.map((c,k)=><div key={k}>{c}</div>)}</td></tr>)}
    </tbody></table></div>:<p>No recorded changes yet.</p>}</>}
  </section>}
  <section className="panel"><div className="sectionheading"><h2>Customers</h2><button className="primary" onClick={()=>open()}>New customer</button></div>
   <label>Search<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, phone, email or address"/></label>
   <p className="muted">{loading?'Searching…':query?`${total} match${total===1?'':'es'}`:`${total} customers`}{!loading&&total>rows.length?` · showing the first ${rows.length}; search to narrow it down`:''}</p>
   <div className="tablewrap"><table className="clickable"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Heard from</th><th>Moves</th><th>Last move</th></tr></thead><tbody>
    {rows.map(c=><tr key={c.id} tabIndex={0} className={c.id===openId?'selected':''} onClick={()=>open(c)} onKeyDown={e=>{if(e.key==='Enter')open(c)}}>
     <td>{c.name}{c.tags.map(t=><span key={t} className={'badge tag-'+t+' tagbadge'}>{tagLabel(t)}</span>)}</td>
     <td>{formatPhone(c.phone)||'—'}{c.phone2&&<div className="muted">{formatPhone(c.phone2)}</div>}</td><td>{c.email||'—'}</td><td>{referralLabel(c.referral_source)}</td><td>{c.job_count}</td><td>{c.last_move_date??'—'}</td></tr>)}
   </tbody></table>{!loading&&!rows.length&&<p>No matching customers.</p>}</div>
  </section>
 </>;
}
