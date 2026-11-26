import {useEffect,useState} from 'react';
import {supabase} from './supabase';
import {describeJobHistory,type AuditRow,type HistoryEntry} from './history';

// Office-only "Change history" for one job, read from the audit log (RLS lets only office staff read it).
export default function JobHistory({companyId,jobId,refreshKey}:{companyId:string;jobId:string;refreshKey:unknown}){
 const [entries,setEntries]=useState<HistoryEntry[]>([]),[names,setNames]=useState<Record<string,string>>({}),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let live=true;setLoading(true);setError('');
  Promise.all([
   supabase.from('audit_log').select('id,table_name,row_id,action,actor,at,old_row,new_row').eq('company_id',companyId)
    .in('table_name',['jobs','job_assignments','job_office_notes','job_stops']).or(`row_id.eq.${jobId},row_id.like.${jobId}/*`).order('id',{ascending:false}).limit(300),
   supabase.from('company_members').select('user_id,display_name').eq('company_id',companyId)
  ]).then(([log,members])=>{if(!live)return;if(log.error)throw log.error;if(members.error)throw members.error;
   setEntries(describeJobHistory((log.data??[]) as AuditRow[]));
   setNames(Object.fromEntries((members.data??[]).map(m=>[m.user_id,m.display_name])));
  }).catch(e=>{if(live)setError(e?.message??'Could not load the change history.')}).finally(()=>{if(live)setLoading(false)});
  return()=>{live=false}},[companyId,jobId,refreshKey]);
 const who=(actor:string|null)=>actor?names[actor]??'Former staff member':'Supabase dashboard / system';
 const when=(at:string)=>new Date(at).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
 return <section className="panel"><h2>Change history</h2>
  <p>Every change to this job is recorded with the signed-in person and the time. History cannot be edited.</p>
  {error&&<p role="alert" className="error">{error}</p>}
  {loading?<p>Loading history…</p>:!entries.length?<p>No recorded changes yet. Changes are recorded from Nov 24, 2026 onward.</p>:
  <div className="tablewrap"><table><thead><tr><th>When</th><th>Who</th><th>What changed</th></tr></thead><tbody>
   {entries.map((e,i)=><tr key={i}><td>{when(e.at)}</td><td>{who(e.actor)}</td><td>{e.changes.map((c,k)=><div key={k}>{c}</div>)}</td></tr>)}
  </tbody></table></div>}
 </section>
}
