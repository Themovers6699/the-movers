import {Fragment,useEffect,useState} from 'react';
import {supabase} from './supabase';
import {errorText} from './access';

type Proposal={content:{kind:string;paragraphs:string[];terms:string[]};sent_at:string;agreed_at:string|null;agreed_name:string|null;newest:boolean;job_status:string};

/** Text with **bold** marks -> React (no HTML is injected). */
export function Rich({text}:{text:string}){return <>{text.split(/\*\*(.+?)\*\*/g).map((part,i)=>i%2?<b key={i}>{part}</b>:<Fragment key={i}>{part}</Fragment>)}</>}
const when=(t:string)=>new Date(t).toLocaleString('en-US',{dateStyle:'long',timeStyle:'short'});
const Phone=()=><a href="tel:+14692006699">469-200-6699</a>;

/** Public page the customer opens from the Written Proposal email (?agree=<code>). No login. */
export default function ProposalPage({token}:{token:string}){
 const [p,setP]=useState<Proposal|null>(null),[error,setError]=useState(''),[name,setName]=useState(''),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[formError,setFormError]=useState('');
 useEffect(()=>{supabase.rpc('get_proposal',{token}).then(r=>{if(r.error)setError(errorText(r.error,'This link could not be opened.'));else setP(r.data as Proposal)})},[token]);
 async function agree(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setFormError('');
  try{const r=await supabase.rpc('agree_to_proposal',{token,signer_name:name,user_agent:navigator.userAgent.slice(0,300)});if(r.error)throw r.error;
   const d=r.data as {agreed_at:string;agreed_name:string};setP(old=>old&&{...old,agreed_at:d.agreed_at,agreed_name:d.agreed_name})}
  catch(e){setFormError(errorText(e,'Could not record your agreement. Please try again or call 469-200-6699.'))}finally{setBusy(false)}}
 return <div className="proposalpage"><div className="proposalcard">
  <img className="proposalbanner" src="/brand/email-banner.jpg" alt="A warm hello from The Movers: Time to move"/>
  {error?<><h1>Written Proposal</h1><p className="error">{error}</p><p>Questions? Call us at <Phone/> or reply to the email we sent you.</p></>
  :!p?<p>Loading your proposal…</p>
  :<>
   <h1>Written Proposal</h1>
   {p.content.paragraphs.map((x,i)=><p key={i}><Rich text={x}/></p>)}
   <div className="proposalterms">{p.content.terms.map((t,i)=>t?<p key={i}><b>***</b> <Rich text={t}/></p>:<div key={i} className="gap"/>)}</div>
   <p><a className="pdflink" href="/docs/rights-and-responsibilities.pdf" target="_blank" rel="noopener">📄 Your Rights &amp; Responsibilities When You Move in Texas (PDF)</a></p>
   <section className="agreebox">
    {p.agreed_at?<p className="agreed">✓ Thank you, <b>{p.agreed_name}</b>. You agreed to these terms on {when(p.agreed_at)}. We look forward to your move!</p>
    :!p.newest?<p className="warning">This proposal was replaced by a newer one. Please open the link in your <b>latest</b> email from The Movers.</p>
    :p.job_status!=='booked'?<p className="warning">This move can no longer be confirmed online. Please call us at <Phone/>.</p>
    :<form onSubmit={agree}>
      <label>Your full name<input required minLength={2} maxLength={100} autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/></label>
      <label className="checkline"><input type="checkbox" required checked={checked} onChange={e=>setChecked(e.target.checked)}/> I have read and agree to the terms above and the Rights &amp; Responsibilities pamphlet.</label>
      <p className="error" role="alert">{formError}</p>
      <button className="primary" disabled={busy||!checked||name.trim().length<2}>{busy?'Saving…':'I agree to the terms'}</button>
     </form>}
   </section>
  </>}
  <footer className="proposalfoot"><img src="/brand/logo-email.png" alt="The Movers"/><div><b>The Movers</b><br/>Our Faith Can Move Mountains<br/><Phone/> · <a href="https://www.themoverz.com">www.themoverz.com</a></div></footer>
 </div></div>;
}
