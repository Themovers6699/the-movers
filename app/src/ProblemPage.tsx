import {useEffect,useState} from 'react';
import {supabase} from './supabase';
import {errorText} from './access';

const Phone=()=><a href="tel:+14692006699">469-200-6699</a>;
const mdy=(d:string)=>{const [y,m,day]=d.slice(0,10).split('-');return `${Number(m)}/${Number(day)}/${y}`};

/** Public page from the thank-you email's "Tell us about a problem" button (?problem=<code>). No login. */
export default function ProblemPage({token}:{token:string}){
 const [ctx,setCtx]=useState<{first_name:string;move_date:string}|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[phone,setPhone]=useState(''),[busy,setBusy]=useState(false),[formError,setFormError]=useState(''),[sent,setSent]=useState(false);
 useEffect(()=>{supabase.rpc('get_feedback_context',{token}).then(r=>{if(r.error)setError(errorText(r.error,'This link could not be opened.'));else setCtx(r.data)})},[token]);
 async function submit(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setFormError('');
  try{const r=await supabase.functions.invoke('movers-customer-email',{body:{mode:'problem',token,message,phone}});
   if(r.error){let m='Your message could not be sent.';try{const b=await r.error.context.json();m=b.error??m}catch{/* keep generic */}throw Error(m)}
   setSent(true)}catch(e){setFormError(errorText(e,'Your message could not be sent. Please call us at 469-200-6699.'))}finally{setBusy(false)}}
 return <div className="proposalpage"><div className="proposalcard">
  <img className="proposalbanner" src="/brand/email-review.jpg" alt="Thanks for moving with The Movers!"/>
  <h1>Tell us about a problem</h1>
  {error?<><p className="error">{error}</p><p>Please call us at <Phone/> or reply to our email.</p></>
  :!ctx?<p>Loading…</p>
  :sent?<p className="agreed">✓ Thank you, {ctx.first_name}. We received your message and will contact you as soon as possible. If it’s urgent, call us at <Phone/>.</p>
  :<form onSubmit={submit} className="problemform">
    <p>Hi {ctx.first_name}, we’re sorry something wasn’t right with your move on {mdy(ctx.move_date)}. Tell us what happened and we’ll do our best to make it right.</p>
    <label>What happened?<textarea required rows={7} minLength={3} maxLength={5000} value={message} onChange={e=>setMessage(e.target.value)} placeholder="For example: which item, what is wrong with it, and where it is now."/></label>
    <label>Best phone number to reach you (optional)<input type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={e=>setPhone(e.target.value)}/></label>
    <p className="muted">If something was damaged, please keep the item and any packaging so we can look at it.</p>
    <p className="error" role="alert">{formError}</p>
    <button className="primary" disabled={busy||message.trim().length<3}>{busy?'Sending…':'Send to The Movers'}</button>
   </form>}
  <footer className="proposalfoot"><img src="/brand/logo-email.png" alt="The Movers"/><div><b>The Movers</b><br/>Our Faith Can Move Mountains<br/><Phone/> · <a href="https://www.themoverz.com">www.themoverz.com</a></div></footer>
 </div></div>;
}
