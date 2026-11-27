import {useEffect,useState} from 'react';
import {supabase} from './supabase';
import {errorText} from './access';

type Note={id:string;body:string;created_at:string;author:string;mine:boolean};
// Office view of the crew's notes on a job (same data the crew sees), with the option to add one.
export default function OfficeCrewNotes({companyId,jobId}:{companyId:string;jobId:string}){
 const [notes,setNotes]=useState<Note[]>([]),[text,setText]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{let live=true;Promise.resolve(supabase.rpc('crew_job_detail',{target_company:companyId,target_job:jobId}))
  .then(r=>{if(!live)return;if(r.error)throw r.error;setNotes(((r.data as {notes?:Note[]})?.notes)??[])}).catch((e:unknown)=>{if(live)setError(errorText(e,'Could not load crew notes.'))});return()=>{live=false}},[companyId,jobId,revision]);
 async function add(e:React.FormEvent){e.preventDefault();if(!text.trim()||busy)return;setBusy(true);setError('');
  try{const r=await supabase.rpc('add_job_note',{target_company:companyId,target_job:jobId,note:text});if(r.error)throw r.error;setText('');setRevision(n=>n+1)}catch(e){setError(errorText(e,'Could not save the note.'))}finally{setBusy(false)}}
 return <section className="panel"><h2>Crew notes ({notes.length})</h2>
  {error&&<p role="alert" className="error">{error}</p>}
  {notes.length?<ul className="notelist">{notes.map(n=><li key={n.id}><p>{n.body}</p><small>{n.mine?'You':n.author} · {new Date(n.created_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</small></li>)}</ul>:<p className="muted">No notes from the crew yet. Notes are visible to the crew assigned to this job.</p>}
  <form onSubmit={add}><label>Add a note for the crew<textarea rows={2} maxLength={2000} value={text} onChange={e=>setText(e.target.value)}/></label><button className="primary" disabled={busy||!text.trim()}>Save note</button></form>
 </section>;
}