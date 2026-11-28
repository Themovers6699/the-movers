import {useState} from 'react';
import {supabase} from './supabase';
import {errorText} from './access';

/** "Send the customer an updated confirmation?" pop-up, shown after a date or time change. */
export default function EmailPrompt({companyId,jobId,kind,customerName,detail,onClose}:{companyId:string;jobId:string;kind:'estimate'|'confirmation';customerName?:string;detail?:string;onClose:()=>void}){
 const [state,setState]=useState<'ask'|'sending'|'sent'|'error'>('ask'),[result,setResult]=useState('');
 async function send(){setState('sending');
  try{const r=await supabase.functions.invoke('movers-customer-email',{body:{company_id:companyId,job_id:jobId,reason:'date_changed'}});
   if(r.error){let m='Could not reach the email service.';try{const b=await r.error.context.json();m=b.error??m}catch{/* keep generic */}throw Error(m)}
   if(r.data?.error)throw Error(r.data.error);setResult(`Sent to ${r.data?.to}.`);setState('sent')}
  catch(e){setResult(errorText(e,'The email could not be sent.'));setState('error')}}
 const what=kind==='estimate'?'an updated estimate':'an updated move confirmation';
 return <div className="modalback" role="dialog" aria-modal="true" aria-labelledby="emailprompt-title">
  <div className="modal">
   <h2 id="emailprompt-title">{state==='sent'?'Email sent':'Email the customer?'}</h2>
   {detail&&<p className="muted">{detail}</p>}
   {state==='ask'&&<p>Send {customerName?<b>{customerName}</b>:'the customer'} {what} with the new date and time?</p>}
   {state==='sending'&&<p>Sending…</p>}
   {(state==='sent'||state==='error')&&<p className={state==='sent'?'success':'error'}>{result}</p>}
   <div className="formactions">
    {state==='ask'&&<><button type="button" className="primary" onClick={send}>Send email</button><button type="button" className="secondary" onClick={onClose}>Not now</button></>}
    {state==='error'&&<><button type="button" className="primary" onClick={send}>Try again</button><button type="button" className="secondary" onClick={onClose}>Close</button></>}
    {state==='sent'&&<button type="button" className="primary" onClick={onClose}>Done</button>}
   </div>
  </div>
 </div>;
}
