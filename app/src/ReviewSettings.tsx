import {useEffect,useState} from 'react';
import {supabase} from './supabase';
import {errorText} from './access';

/** Settings: automatic thank-you & review emails 24 hours after each move. */
export default function ReviewSettings({companyId}:{companyId:string}){
 const [on,setOn]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{supabase.from('company_settings').select('auto_review_emails').eq('company_id',companyId).single().then(r=>{if(r.error)setError(errorText(r.error,'Could not load the setting.'));else setOn(!!r.data.auto_review_emails)})},[companyId]);
 async function set(next:boolean){if(busy||next===on)return;setBusy(true);setError('');setMessage('');
  try{const r=await supabase.functions.invoke('movers-customer-email',{body:{mode:'schedule',company_id:companyId,enabled:next}});
   if(r.error){let m='Could not change the setting.';try{const b=await r.error.context.json();m=b.error??m}catch{/* keep generic */}throw Error(m)}
   setOn(next);setMessage(next?'On. Customers get the thank-you email about 24 hours after the crew finishes their move.':'Off. You can still send it by hand from a completed job.')}
  catch(e){setError(errorText(e,'Could not change the setting.'))}finally{setBusy(false)}}
 return <section className="panel">
  <div className="sectionheading"><h2>Thank-you &amp; review emails</h2></div>
  <p>Send the thank-you email automatically <b>24 hours after the crew finishes a move</b>. It goes out between 9 AM and 7 PM, once per move, and never to customers who opted out of emails. It invites the customer to message you first with any questions or concerns, then shows your Google, Facebook, Yelp and BBB review links.</p>
  <div className="field"><span className="fieldlabel">Automatic thank-you emails</span><div className="miniswitch" role="group" aria-label="Automatic thank-you emails"><button type="button" className="yes" aria-pressed={on===true} disabled={busy||on===null} onClick={()=>set(true)}>On</button><button type="button" className="no" aria-pressed={on===false} disabled={busy||on===null} onClick={()=>set(false)}>Off</button></div></div>
  <p className="error" role="alert">{error}</p><p className="success" role="status">{message}</p>
 </section>;
}
