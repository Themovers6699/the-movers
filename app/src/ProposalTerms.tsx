import {useEffect,useState} from 'react';
import {supabase} from './supabase';
import {errorText} from './access';
import {Rich} from './ProposalPage';

/** Settings: the *** terms printed in every Written Proposal. */
export default function ProposalTerms({companyId}:{companyId:string}){
 const [terms,setTerms]=useState(''),[saved,setSaved]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{supabase.from('company_settings').select('proposal_terms').eq('company_id',companyId).single().then(r=>{if(r.error)setError(errorText(r.error,'Could not load the terms.'));else{setTerms(r.data.proposal_terms??'');setSaved(r.data.proposal_terms??'')}})},[companyId]);
 async function save(){setBusy(true);setError('');setMessage('');try{const r=await supabase.rpc('save_proposal_terms',{target_company:companyId,terms});if(r.error)throw r.error;setSaved(terms.trim());setMessage('Terms saved. New Written Proposals will use them; proposals already sent keep the terms the customer saw.')}catch(e){setError(errorText(e,'Could not save the terms.'))}finally{setBusy(false)}}
 return <section className="panel">
  <div className="sectionheading"><h2>Written Proposal terms</h2></div>
  <p className="muted">One term per line; each line is shown with *** in front. Put <b>**two stars**</b> around words to make them <b>bold</b>. Leave an empty line to start a new group (like the NO REFUNDS line).</p>
  <div className="termsgrid">
   <label>Terms<textarea rows={22} value={terms} onChange={e=>setTerms(e.target.value)} maxLength={20000}/></label>
   <div><span className="fieldlabel">Preview</span><div className="proposalterms termspreview">{terms.replace(/\r/g,'').split('\n').map((t,i)=>t.trim()?<p key={i}><b>***</b> <Rich text={t.trim()}/></p>:<div key={i} className="gap"/>)}</div></div>
  </div>
  <p className="error" role="alert">{error}</p><p className="success" role="status">{message}</p>
  <div className="formactions"><button type="button" className="primary" disabled={busy||terms.trim()===saved.trim()} onClick={save}>{busy?'Saving…':'Save terms'}</button>{terms!==saved&&<button type="button" className="secondary" onClick={()=>setTerms(saved)}>Undo changes</button>}</div>
 </section>;
}
