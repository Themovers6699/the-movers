import {useEffect,useState} from 'react';
import {supabase} from './supabase';
import Estimates from './Estimates';
import {formatPhone} from './phone';
import {errorText} from './access';

type Complaint={id:string;job_id:string;customer_id:string|null;customer_name:string;message:string;contact_phone:string|null;created_at:string;status:'open'|'resolved';resolved_at:string|null;resolution_note:string|null};
type Contact={id:string;email:string|null;phone:string|null};
const stamp=(t:string)=>new Date(t).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});

/** Problems customers reported from the thank-you email. Open ones first; resolve with a note. */
export default function Complaints({companyId,onChanged}:{companyId:string;onChanged:()=>void}){
 const [rows,setRows]=useState<Complaint[]>([]),[contacts,setContacts]=useState<Record<string,Contact>>({}),[filter,setFilter]=useState<'open'|'resolved'|'all'>('open'),[error,setError]=useState(''),[loading,setLoading]=useState(true),[rev,setRev]=useState(0),[viewing,setViewing]=useState(''),[notes,setNotes]=useState<Record<string,string>>({}),[busy,setBusy]=useState('');
 useEffect(()=>{let live=true;setLoading(true);(async()=>{try{
  let q=supabase.from('job_complaints').select('id,job_id,customer_id,customer_name,message,contact_phone,created_at,status,resolved_at,resolution_note').eq('company_id',companyId).order('created_at',{ascending:false}).limit(300);
  if(filter!=='all')q=q.eq('status',filter);const r=await q;if(r.error)throw r.error;const list=(r.data??[]) as Complaint[];
  const ids=[...new Set(list.map(c=>c.customer_id).filter(Boolean))] as string[];
  const c=ids.length?await supabase.from('customers').select('id,email,phone').eq('company_id',companyId).in('id',ids):{data:[],error:null};
  if(!live)return;setRows(list);setContacts(Object.fromEntries(((c.data??[]) as Contact[]).map(x=>[x.id,x])));setError('')}
  catch(e){if(live)setError(errorText(e,'Could not load complaints.'))}finally{if(live)setLoading(false)}})();return()=>{live=false}},[companyId,filter,rev]);
 async function resolve(c:Complaint,reopen=false){setBusy(c.id);setError('');try{const r=await supabase.rpc('resolve_complaint',{target_company:companyId,complaint:c.id,note:notes[c.id]??null,reopen});if(r.error)throw r.error;setRev(n=>n+1);onChanged()}catch(e){setError(errorText(e,'Could not update the complaint.'))}finally{setBusy('')}}
 if(viewing)return <Estimates key={viewing} companyId={companyId} initialJobId={viewing} onClose={()=>{setViewing('');setRev(n=>n+1)}} onSaved={onChanged}/>;
 return <section className="panel">
  <div className="sectionheading"><h2>Complaints</h2><div className="miniswitch" role="group" aria-label="Show">{(['open','resolved','all'] as const).map(f=><button key={f} type="button" className="yes" aria-pressed={filter===f} onClick={()=>setFilter(f)}>{f==='open'?'Open':f==='resolved'?'Resolved':'All'}</button>)}</div></div>
  <p className="muted">Tell“Tell us about a problem” button in the thank-you email. Each one is also emailed to your inbox; reply there to answer the customer.</p>
  <p className="error" role="alert">{error}</p>
  {loading?<p>Loading…</p>:!rows.length?<div className="empty"><h3>{filter==='open'?'No open complaints.':'Nothing here.'}</h3><p>{filter==='open'?'When a customer reports a problem, it appears here.':''}</p></div>
  :<div className="complaintlist">{rows.map(c=>{const ct=c.customer_id?contacts[c.customer_id]:undefined;const phone=c.contact_phone||formatPhone(ct?.phone);return <article key={c.id} className={'complaint '+c.status}>
   <div className="complainttop"><b>{c.customer_name}</b><span className={'badge '+(c.status==='open'?'badge-off':'badge-done')}>{c.status==='open'?'Open':'Resolved'}</span><small className="muted">{stamp(c.created_at)}</small></div>
   <p className="muted">{[phone&&<a key="p" href={'tel:'+phone.replace(/[^0-9+]/g,'')}>{phone}</a>,ct?.email].filter(Boolean).map((x,i)=><span key={i}>{i?' · ':''}{x}</span>)}</p>
   <blockquote>{c.message}</blockquote>
   {c.status==='resolved'?<p className="agreed">✓ Resolved {c.resolved_at?stamp(c.resolved_at):''}{c.resolution_note?<>: {c.resolution_note}</>:null}</p>
   :<label>What was done (optional)<input maxLength={2000} value={notes[c.id]??''} onChange={e=>setNotes(n=>({...n,[c.id]:e.target.value}))} placeholder="e.g. Called her, repaired the dresser leg"/></label>}
   <div className="formactions"><button type="button" className="secondary" onClick={()=>setViewing(c.job_id)}>View job</button>{c.status==='open'?<button type="button" className="primary" disabled={busy===c.id} onClick={()=>resolve(c)}>Mark resolved</button>:<button type="button" className="secondary" disabled={busy===c.id} onClick={()=>resolve(c,true)}>Reopen</button>}</div>
  </article>})}</div>}
 </section>;
}
