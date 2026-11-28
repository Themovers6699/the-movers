import {useState} from 'react';
import {supabase} from './supabase';
import {errorText} from './access';

export type EmailKind='estimate'|'proposal'|'review';
export type EmailReason='date_changed'|'booked'|'manual';

/** "Email the customer?" pop-up: the estimate (estimates) or the Written Proposal (booked jobs). */
export default function EmailPrompt({companyId,jobId,kind,reason='date_changed',customerName,detail,onClose}:{companyId:string;jobId:string;kind:EmailKind;reason?:EmailReason;customerName?:string;detail?:string;onClose:(sent:boolean)=>void}){
 const [state,setState]=useState<'ask'|'sending'|'sent'|'error'>('ask'),[result,setResult]=useState('');
 async function send(){setState('sending');
  try{const r=await supabase.functions.invoke('movers-customer-email',{body:{company_id:companyId,job_id:jobId,reason}});
   if(r.error){let m='Could not reach the email service.';try{const b=await r.error.context.json();m=b.error??m}catch{/* keep generic */}throw Error(m)}
   if(r.data?.error)throw Error(r.data.error);setResult(`“${r.data?.subject}” sent to ${r.data?.to}.`);setState('sent')}
  catch(e){setResult(errorText(e,'The email could not be sent.'));setState('error')}}
 const what=kind==='review'?'a thank-you email asking for a review (Google, Facebook, Yelp, BBB)':kind==='estimate'?(reason==='date_changed'?'an updated estimate':'the estimate'):(reason==='date_changed'?'an updated Written Proposal':'the Written Proposal');
 const who=customerName?<b>{customerName}</b>:'the customer';
 return <div className="modalback" role="dialog" aria-modal="true" aria-labelledby="emailprompt-title">
  <div className="modal">
   <h2 id="emailprompt-title">{state==='sent'?'Email sent':reason==='booked'?'Send the Written Proposal?':'Email the customer?'}</h2>
   {detail&&<p className="muted">{detail}</p>}
   {state==='ask'&&<p>Send {who} {what}{reason==='date_changed'?' with the new date and time':''}?{kind==='proposal'&&<><br/><small className="muted">Includes your terms, an “I agree” button and the Rights &amp; Responsibilities PDF.</small></>}</p>}
   {state==='sending'&&<p>Sending…</p>}
   {(state==='sent'||state==='error')&&<p className={state==='sent'?'success':'error'}>{result}</p>}
   <div className="formactions">
    {state==='ask'&&<><button type="button" className="primary" onClick={send}>Send email</button><button type="button" className="secondary" onClick={()=>onClose(false)}>Not now</button></>}
    {state==='error'&&<><button type="button" className="primary" onClick={send}>Try again</button><button type="button" className="secondary" onClick={()=>onClose(false)}>Close</button></>}
    {state==='sent'&&<button type="button" className="primary" onClick={()=>onClose(true)}>Done</button>}
   </div>
  </div>
 </div>;
}
