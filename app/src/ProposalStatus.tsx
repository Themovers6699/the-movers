import {useEffect,useState} from 'react';
import {supabase} from './supabase';
import EmailPrompt from './EmailPrompt';

type Row={id:string;to_email:string;sent_at:string;agreed_at:string|null;agreed_name:string|null;content:{updated?:boolean}};
type Mail={id:string;subject:string;to_email:string;status:string;error:string|null;created_at:string;kind:string};
const when=(t:string)=>new Date(t).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});

/** Written Proposal panel on a job: agreement status, history of emails, and a send button. */
export default function ProposalStatus({companyId,jobId,status,customerName,hasEmail}:{companyId:string;jobId:string;status:string;customerName:string;hasEmail:boolean}){
 const [rows,setRows]=useState<Row[]>([]),[mails,setMails]=useState<Mail[]>([]),[ask,setAsk]=useState(false),[rev,setRev]=useState(0),[problems,setProblems]=useState(0);
 useEffect(()=>{let live=true;Promise.all([
  supabase.from('job_proposals').select('id,to_email,sent_at,agreed_at,agreed_name,content').eq('company_id',companyId).eq('job_id',jobId).order('sent_at',{ascending:false}),
  supabase.from('customer_emails').select('id,subject,to_email,status,error,created_at,kind').eq('company_id',companyId).eq('job_id',jobId).order('created_at',{ascending:false}).limit(20)
,
  supabase.from('job_complaints').select('id',{count:'exact',head:true}).eq('company_id',companyId).eq('job_id',jobId).eq('status','open')
 ]).then(([p,m,k])=>{if(!live)return;setRows((p.data??[]) as Row[]);setMails((m.data??[]) as Mail[]);setProblems(k.count??0)});return()=>{live=false}},[companyId,jobId,rev]);
 const latest=rows[0];const booked=status==='booked',done=status==='completed';const reviewSent=mails.find(m=>m.kind==='review'&&m.status==='sent');
 return <section className="panel">
  {ask&&<EmailPrompt companyId={companyId} jobId={jobId} kind={done?'review':booked?'proposal':'estimate'} reason="manual" customerName={customerName} onClose={()=>{setAsk(false);setRev(r=>r+1)}}/>}
  <div className="sectionheading"><h2>{done?'Customer emails':'Written Proposal'}</h2>{(booked||done||status==='estimate')&&<button type="button" className={done&&!reviewSent?'primary':'secondary'} disabled={!hasEmail} title={hasEmail?undefined:'Add the customer’s email first'} onClick={()=>setAsk(true)}>{done?(reviewSent?'Resend thank-you & review request':'Send thank-you & review request'):booked?(latest?'Resend Written Proposal':'Send Written Proposal'):'Email estimate'}</button>}</div>{done&&<p className={reviewSent?'agreed':'muted'}>{reviewSent?<>✓ Thank-you &amp; review request sent {when(reviewSent.created_at)}</>:'The move is complete. Send a thank-you with links to review you on Google, Facebook, Yelp and BBB.'}</p>}
  {problems>0&&<p className="warning">⚠ <b>The customer reported a problem</b> with this move. See <b>Complaints</b> in the menu.</p>}{!hasEmail&&<p className="warning">This customer has no email address. Add one above to send emails.</p>}
  {!latest?done?null:<p className="muted">{booked?'No Written Proposal has been sent for this job yet.':'The Written Proposal is sent once the job is booked.'}</p>
  :latest.agreed_at?<p className="agreed">✓ <b>Agreed</b> by <b>{latest.agreed_name}</b> on {when(latest.agreed_at)}</p>
  :<p className="warning">⏳ <b>Waiting for the customer to agree</b> to the proposal sent {when(latest.sent_at)} to {latest.to_email}. They can also reply to the email.</p>}
  {(rows.length>1||mails.length>0)&&<details><summary>Email history ({mails.length})</summary><ul className="historylist">{mails.map(m=>{const prop=m.kind==='proposal'?rows.find(r=>Math.abs(new Date(r.sent_at).getTime()-new Date(m.created_at).getTime())<120000):undefined;return <li key={m.id}><b>{m.subject}</b> → {m.to_email} · {when(m.created_at)} · {m.status==='sent'?'sent':<span className="error">failed: {m.error}</span>}{prop?.agreed_at?` · agreed by ${prop.agreed_name}`:''}</li>})}</ul></details>}
 </section>;
}
