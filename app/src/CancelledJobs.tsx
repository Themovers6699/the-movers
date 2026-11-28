import {useEffect,useState} from 'react';
import {supabase} from './supabase';
import Estimates from './Estimates';
import EmailPrompt from './EmailPrompt';
import {formatPhone} from './phone';
import {formatWindow} from './windows';
import {errorText} from './access';

type Row={id:string;customer_id:string|null;customer_name:string;phone:string|null;email:string|null;move_date:string;arrival_time:string|null;arrival_window_end:string|null;pick_up_address:string;drop_off_address:string;quoted_total_cents:number|null;cancelled_at:string|null;cancelled_by_name:string|null;total_matches:number};
const todayIn=(tz:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const day=(d:string)=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(new Date(d.slice(0,10)+'T12:00:00Z'));
const stamp=(t:string)=>new Date(t).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
const money=(c:number|null)=>c==null?'—':(c/100).toLocaleString('en-US',{style:'currency',currency:'USD'});

/** Cancelled jobs: newest cancellation first, searchable like the customer list, with Restore. */
export default function CancelledJobs({companyId,timezone,onChanged}:{companyId:string;timezone:string;onChanged:()=>void}){
 const [query,setQuery]=useState(''),[rows,setRows]=useState<Row[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState(''),[rev,setRev]=useState(0);
 const [viewing,setViewing]=useState(''),[restoring,setRestoring]=useState<Row|null>(null),[emailFor,setEmailFor]=useState<{id:string;name:string;moved:boolean;detail:string}|null>(null);
 useEffect(()=>{let live=true;setLoading(true);const t=setTimeout(()=>{supabase.rpc('search_cancelled_jobs',{target_company:companyId,query:query.trim(),max_rows:200}).then(r=>{if(!live)return;if(r.error)setError(errorText(r.error,'Could not load cancelled jobs.'));else{setError('');setRows((r.data??[]) as Row[])}setLoading(false)})},query?250:0);return()=>{live=false;clearTimeout(t)}},[companyId,query,rev]);
 if(viewing)return <Estimates key={viewing} companyId={companyId} initialJobId={viewing} onClose={()=>{setViewing('');setRev(n=>n+1)}} onSaved={onChanged}/>;
 const total=rows[0]?.total_matches??0;
 return <>
  {restoring&&<RestoreDialog companyId={companyId} row={restoring} today={todayIn(timezone)} onClose={()=>setRestoring(null)} onRestored={(moved,date)=>{const r=restoring;setRestoring(null);setRev(n=>n+1);onChanged();
   setNotice(`${r.customer_name}’s job is back on the schedule for ${day(date)}.`);if(r.email?.trim())setEmailFor({id:r.id,name:r.customer_name,moved,detail:`Restored for ${day(date)}.`})}}/>}
  {emailFor&&<EmailPrompt companyId={companyId} jobId={emailFor.id} kind="proposal" reason={emailFor.moved?'date_changed':'booked'} customerName={emailFor.name} detail={emailFor.detail} onClose={()=>setEmailFor(null)}/>}
  <p role="status" className="success">{notice}</p>
  <section className="panel">
   <div className="sectionheading"><h2>Cancelled jobs</h2><span className="count">{loading?'…':`${total} ${total===1?'job':'jobs'}`}</span></div>
   <p className="muted">Most recently cancelled first. Open a job to see everything about it, or restore it to put it back on the schedule.</p>
   <label>Search cancelled jobs<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, phone, email or address"/></label>
   <p className="error" role="alert">{error}</p>
   {!loading&&!rows.length?<div className="empty"><h3>{query.trim()?'No cancelled jobs match your search.':'No cancelled jobs.'}</h3><p>{query.trim()?'Try part of the name, the last 4 digits of the phone, or a street name.':'When you cancel a booked job, it is listed here.'}</p></div>
   :<div className="tablewrap"><table className="cancelledtable"><thead><tr><th>Cancelled</th><th>Customer</th><th>Was scheduled for</th><th>Addresses</th><th>Quote</th><th>Actions</th></tr></thead><tbody>
    {rows.map(r=><tr key={r.id}>
     <td>{r.cancelled_at?stamp(r.cancelled_at):'—'}{r.cancelled_by_name&&<small className="muted"><br/>by {r.cancelled_by_name}</small>}</td>
     <td><b>{r.customer_name}</b>{(r.phone||r.email)&&<small className="muted"><br/>{[formatPhone(r.phone),r.email].filter(Boolean).join(' · ')}</small>}</td>
     <td>{day(r.move_date)}{r.arrival_time&&<small className="muted"><br/>{formatWindow(r.arrival_time,r.arrival_window_end)}</small>}</td>
     <td><small>{r.pick_up_address}{r.drop_off_address&&r.drop_off_address!==r.pick_up_address?<><br/>→ {r.drop_off_address}</>:null}</small></td>
     <td>{money(r.quoted_total_cents)}</td>
     <td className="actions"><button className="secondary" onClick={()=>setViewing(r.id)}>View</button><button className="primary" onClick={()=>{setNotice('');setRestoring(r)}}>Restore</button></td>
    </tr>)}
   </tbody></table>{total>rows.length&&<p className="muted">Showing the {rows.length} most recent. Search to find older ones.</p>}</div>}
  </section>
 </>;
}

function RestoreDialog({companyId,row,today,onClose,onRestored}:{companyId:string;row:Row;today:string;onClose:()=>void;onRestored:(moved:boolean,date:string)=>void}){
 const past=row.move_date.slice(0,10)<today;
 const [mode,setMode]=useState<'same'|'new'>(past?'new':'same'),[date,setDate]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function go(){if(busy)return;const target=mode==='same'?row.move_date.slice(0,10):date;if(!target){setError('Choose the new move date.');return}setBusy(true);setError('');
  try{const v=await supabase.from('jobs').select('row_version').eq('company_id',companyId).eq('id',row.id).single();if(v.error)throw v.error;
   const r=await supabase.rpc('restore_cancelled_job',{target_company:companyId,target_job:row.id,expected_version:v.data.row_version,new_date:mode==='same'?null:date});if(r.error)throw r.error;
   onRestored(mode==='new'&&target!==row.move_date.slice(0,10),target)}
  catch(e){setError(errorText(e,'Could not restore the job.'))}finally{setBusy(false)}}
 return <div className="modalback" role="dialog" aria-modal="true" aria-labelledby="restore-title"><div className="modal">
  <h2 id="restore-title">Restore {row.customer_name}’s job?</h2>
  <p className="muted">It goes back on the schedule as a booked job, with the same truck, crew and price{mode==='new'?' (the hourly rate follows the new day: weekday or weekend)':''}.</p>
  <div className="restorechoices">
   <label className="checkline"><input type="radio" name="restoredate" disabled={past} checked={mode==='same'} onChange={()=>setMode('same')}/> Original date: <b>{day(row.move_date)}</b>{past&&<span className="muted"> (already passed)</span>}</label>
   <label className="checkline"><input type="radio" name="restoredate" checked={mode==='new'} onChange={()=>setMode('new')}/> A new date</label>
   {mode==='new'&&<input type="date" aria-label="New move date" min={today} value={date} onChange={e=>setDate(e.target.value)}/>}
  </div>
  <p className="error" role="alert">{error}</p>
  <div className="formactions"><button type="button" className="primary" disabled={busy||(mode==='new'&&!date)} onClick={go}>{busy?'Restoring…':'Restore job'}</button><button type="button" className="secondary" onClick={onClose}>Keep cancelled</button></div>
 </div></div>;
}
