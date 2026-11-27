import {useEffect,useState} from 'react';
import {supabase} from './supabase';
import {errorText} from './access';
import {formatWindow} from './windows';
import {formatPhone} from './phone';
import JobPhotos from './JobPhotos';
import {mapsUrl,telUrl,stopDetails,dayLabel,STATUS_LABELS,SERVICE_LABELS} from './crew';

type JobRow={id:string;move_date:string;arrival_time:string|null;arrival_window_end:string|null;status:string;service_type:string;truck_needed:boolean;truck_name:string|null;customer_name:string;first_address:string;last_address:string;stop_count:number;crew_names:string[];i_am_leader:boolean};
type Detail={id:string;move_date:string;arrival_time:string|null;arrival_window_end:string|null;status:string;service_type:string;truck_needed:boolean;customer_name:string;instructions:string|null;actual_start_at:string|null;actual_end_at:string|null;i_am_leader:boolean;truck:string|null;
 crew:{name:string;role:string}[];stops:{position:number;kind:string;address:string;location_type:string|null;bedrooms:number|null;floor:number|null;unit:string|null;access_notes:string|null}[];
 notes:{id:string;body:string;created_at:string;author:string;mine:boolean}[];
 customer?:{name:string;phone:string|null;phone2:string|null;email:string|null}|null;
 pricing?:{pricing_model:string;crew_size:number;hourly_rate_cents:number|null;flat_rate_cents:number|null;service_charge_cents:number|null;add_ons_cents:number;quoted_total_cents:number|null;deposit_required_cents:number|null};
 add_ons?:{name:string;unit_label:string;quantity:number;total_cents:number}[]};
const money=(c:number|null|undefined)=>c==null?'—':(c/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
const todayIn=(tz:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const addDays=(key:string,n:number)=>{const d=new Date(key+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
const time=(iso:string|null)=>iso?new Date(iso).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'';

// Phone-first crew screens: my jobs list → job page. Data comes from crew_jobs / crew_job_detail, which only return
// what the person's role may see (movers: no prices, no customer contact).
export default function CrewHome({companyId,userId,timezone='America/Chicago'}:{companyId:string;userId:string;timezone?:string}){
 const today=todayIn(timezone);
 const [jobs,setJobs]=useState<JobRow[]>([]),[showPast,setShowPast]=useState(false),[openId,setOpenId]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let live=true;setLoading(true);setError('');
  Promise.resolve(supabase.rpc('crew_jobs',{target_company:companyId,from_date:showPast?addDays(today,-60):addDays(today,-1),to_date:addDays(today,120)}))
   .then(r=>{if(!live)return;if(r.error)throw r.error;setJobs((r.data??[]) as JobRow[])}).catch((e:unknown)=>{if(live)setError(errorText(e,'Could not load your jobs.'))}).finally(()=>{if(live)setLoading(false)});
  return()=>{live=false}},[companyId,showPast,revision,today]);
 useEffect(()=>{const fn=()=>setRevision(n=>n+1);window.addEventListener('focus',fn);return()=>window.removeEventListener('focus',fn)},[]);

 if(openId)return <CrewJob companyId={companyId} jobId={openId} userId={userId} onBack={()=>{setOpenId(null);setRevision(n=>n+1)}}/>;
 const visible=jobs.filter(j=>showPast||j.move_date>=today||j.status==='in_progress');
 return <section className="panel crew">
  <div className="sectionheading"><h2>My jobs</h2><label className="inlinecheck"><input type="checkbox" checked={showPast} onChange={e=>setShowPast(e.target.checked)}/>Show past</label></div>
  {error&&<p role="alert" className="error">{error}</p>}
  {loading?<p>Loading your jobs…</p>:!visible.length?<div className="empty"><h3>No jobs assigned yet.</h3><p>The office will assign you to jobs. They appear here as soon as they do.</p></div>:
  <div className="crewlist">{visible.map(j=><button type="button" key={j.id} className={'crewcard status-'+j.status} onClick={()=>setOpenId(j.id)}>
   <span className="crewcardtop"><b>{dayLabel(today,j.move_date)}</b> · {formatWindow(j.arrival_time,j.arrival_window_end)}<span className={'badge '+(j.status==='in_progress'?'badge-pending':j.status==='completed'?'badge-done':j.status==='cancelled'?'badge-off':'badge-on')}>{STATUS_LABELS[j.status]??j.status}</span></span>
   <strong>{j.customer_name}</strong>
   <span className="crewroute">{j.first_address}{j.stop_count>1?<> → {j.last_address}</>:null}{j.stop_count>2?<small> (+{j.stop_count-2} more)</small>:null}</span>
   <span className="muted">{j.service_type!=='full_move'?SERVICE_LABELS[j.service_type]+' · ':''}{j.truck_needed?(j.truck_name??'Truck not assigned yet'):'No truck'} · {j.crew_names.join(', ')}{j.i_am_leader?' · You lead':''}</span>
  </button>)}</div>}
 </section>;
}

function CrewJob({companyId,jobId,userId,onBack}:{companyId:string;jobId:string;userId:string;onBack:()=>void}){
 const [d,setD]=useState<Detail|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let live=true;Promise.resolve(supabase.rpc('crew_job_detail',{target_company:companyId,target_job:jobId}))
  .then(r=>{if(!live)return;if(r.error)throw r.error;setD(r.data as Detail)}).catch((e:unknown)=>{if(live)setError(errorText(e,'Could not load this job.'))});return()=>{live=false}},[companyId,jobId,revision]);
 async function step(fn:'start_job'|'finish_job'){if(!d||busy)return;
  if(!window.confirm(fn==='start_job'?'Start this job now? The start time is recorded.':'Finish this job now? The finish time is recorded.'))return;
  setBusy(true);setError('');setMessage('');try{const r=await supabase.rpc(fn,{target_company:companyId,target_job:jobId});if(r.error)throw r.error;setMessage(fn==='start_job'?'Job started.':'Job finished. Great work!');setRevision(n=>n+1)}
  catch(e){setError(errorText(e,'Could not update the job.'))}finally{setBusy(false)}}
 async function addNote(e:React.FormEvent){e.preventDefault();if(!note.trim()||busy)return;setBusy(true);setError('');
  try{const r=await supabase.rpc('add_job_note',{target_company:companyId,target_job:jobId,note});if(r.error)throw r.error;setNote('');setRevision(n=>n+1)}
  catch(e){setError(errorText(e,'Could not save the note. Check your signal and try again.'))}finally{setBusy(false)}}
 if(!d)return <section className="panel crew"><button type="button" className="secondary" onClick={onBack}>← My jobs</button>{error?<p role="alert" className="error">{error}</p>:<p>Loading job…</p>}</section>;
 const call=telUrl(d.customer?.phone),call2=telUrl(d.customer?.phone2);
 return <div className="crew">
  <div className="crewtop"><button type="button" className="secondary" onClick={onBack}>← My jobs</button><span className={'badge '+(d.status==='in_progress'?'badge-pending':d.status==='completed'?'badge-done':d.status==='cancelled'?'badge-off':'badge-on')}>{STATUS_LABELS[d.status]??d.status}</span></div>
  {error&&<p role="alert" className="error">{error}</p>}<p role="status" className="success">{message}</p>
  <section className="panel">
   <h2>{d.customer_name}</h2>
   <p className="crewwhen"><b>{new Date(d.move_date+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric'})}</b> · arrive {formatWindow(d.arrival_time,d.arrival_window_end)}</p>
   <p className="muted">{SERVICE_LABELS[d.service_type]??d.service_type} · {d.truck_needed?(d.truck??'Truck not assigned yet'):'No truck needed'} · Crew: {d.crew.map(c=>c.name+(c.role==='crew_leader'?' (lead)':'')).join(', ')}</p>
   {(d.actual_start_at||d.actual_end_at)&&<p>Started {time(d.actual_start_at)}{d.actual_end_at?` · Finished ${time(d.actual_end_at)}`:''}</p>}
   {d.i_am_leader&&d.status==='booked'&&<button type="button" className="primary bigbtn" disabled={busy} onClick={()=>step('start_job')}>▶ Start job</button>}
   {d.i_am_leader&&d.status==='in_progress'&&<button type="button" className="primary bigbtn finish" disabled={busy} onClick={()=>step('finish_job')}>■ Finish job</button>}
  </section>
  {d.customer&&<section className="panel"><h2>Customer</h2><p><b>{d.customer.name}</b></p>
   <div className="contactbtns">{call&&<a className="secondary contactbtn" href={call}>📞 {formatPhone(d.customer.phone)}</a>}{call2&&<a className="secondary contactbtn" href={call2}>📞 {formatPhone(d.customer.phone2)}</a>}{d.customer.email&&<a className="secondary contactbtn" href={'mailto:'+d.customer.email}>✉ Email</a>}</div>
   {!call&&!call2&&!d.customer.email&&<p className="muted">No phone or email on file. Ask the office.</p>}</section>}
  <section className="panel"><h2>Addresses</h2>
   {d.stops.map(s=><div className={'stopcard '+s.kind} key={s.position}>
    <div className="stophead"><span className="stopnum">{s.position}</span><b>{s.kind==='pickup'?'Pick-up':'Drop-off'}</b></div>
    <a className="mapslink" href={mapsUrl(s.address)} target="_blank" rel="noopener noreferrer">📍 {s.address}</a>
    {stopDetails(s)&&<p className="muted">{stopDetails(s)}</p>}
    {s.access_notes&&<p className="accessnote">🔑 {s.access_notes}</p>}
   </div>)}
   {d.instructions&&<p className="accessnote">📝 {d.instructions}</p>}
  </section>
  {d.pricing&&<section className="panel"><h2>Quote</h2>
   {d.pricing.pricing_model==='hourly'?<p>{d.pricing.crew_size} movers at <b>{money(d.pricing.hourly_rate_cents)}/hour</b> · service charge {money(d.pricing.service_charge_cents)}</p>:<p>Flat rate <b>{money(d.pricing.flat_rate_cents)}</b></p>}
   {d.add_ons&&d.add_ons.length>0&&<ul className="plainlist">{d.add_ons.map((a,i)=><li key={i}>{Number(a.quantity)} × {a.name} · {money(a.total_cents)}</li>)}</ul>}
   <p>Quoted total {money(d.pricing.quoted_total_cents)} · deposit {money(d.pricing.deposit_required_cents)}</p>
   <p className="muted">The bill of lading with final times, add-ons and signatures comes in the next update.</p></section>}
  <section className="panel"><h2>Notes</h2>
   {d.notes.length?<ul className="notelist">{d.notes.map(n=><li key={n.id}><p>{n.body}</p><small>{n.mine?'You':n.author} · {new Date(n.created_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</small></li>)}</ul>:<p className="muted">No notes yet.</p>}
   <form onSubmit={addNote}><label>Add a note<textarea rows={2} maxLength={2000} value={note} onChange={e=>setNote(e.target.value)} placeholder="Damage found, customer requests, parking, anything the office should know…"/></label><button className="primary" disabled={busy||!note.trim()}>Save note</button></form>
  </section>
  <JobPhotos companyId={companyId} jobId={jobId} userId={userId}/>
 </div>;
}
