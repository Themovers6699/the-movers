import {useEffect,useState} from 'react';
import {supabase} from './supabase';
import {errorText} from './access';

type RateRow={crew_size:string;weekday:string;weekend:string;base:string;perMile:string;roundTo:string};
type Item={id:string;name:string;category:'fee'|'material';unit_label:string;price:string;active:boolean};
const dollars=(c:number|null|undefined)=>c==null?'':(Number(c)/100).toFixed(2).replace(/\.00$/,'');
const cents=(d:string,label:string)=>{const t=d.trim();if(!/^\d+(\.\d{1,2})?$/.test(t))throw Error(`${label}: enter an amount like 110 or 1.20`);return Math.round(Number(t)*100)};

export default function PricingSettings({companyId}:{companyId:string}){
 const [rates,setRates]=useState<RateRow[]>([]),[settings,setSettings]=useState({depot:'',minHours:'2',increment:'15',deposit:'50',outPct:'50'}),[items,setItems]=useState<Item[]>([]);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[revision,setRevision]=useState(0);

 useEffect(()=>{let live=true;setLoading(true);setError('');
  Promise.all([
   supabase.from('crew_rates').select('*').eq('company_id',companyId).order('crew_size'),
   supabase.from('company_settings').select('*').eq('company_id',companyId).single(),
   supabase.from('price_items').select('id,name,category,unit_label,unit_price_cents,active,sort_order').eq('company_id',companyId).order('sort_order')
  ]).then(([r,s,p])=>{if(!live)return;const bad=[r,s,p].find(x=>x.error);if(bad?.error)throw bad.error;
   setRates((r.data??[]).map(x=>({crew_size:String(x.crew_size),weekday:dollars(x.weekday_rate_cents),weekend:dollars(x.weekend_rate_cents),base:dollars(x.service_base_cents),perMile:dollars(x.service_cents_per_mile),roundTo:dollars(x.round_service_up_to_cents)})));
   const st=s.data;setSettings({depot:st.depot_address,minHours:String(st.minimum_minutes/60),increment:String(st.billing_increment_minutes),deposit:dollars(st.standard_deposit_cents),outPct:String(Number(st.out_of_town_deposit_percent))});
   setItems((p.data??[]).map(x=>({id:x.id,name:x.name,category:x.category,unit_label:x.unit_label,price:dollars(x.unit_price_cents),active:x.active})));
  }).catch(e=>{if(live)setError(errorText(e,'Could not load pricing.'))}).finally(()=>{if(live)setLoading(false)});
  return()=>{live=false}},[companyId,revision]);

 const setRate=(i:number,k:keyof RateRow,v:string)=>setRates(rs=>rs.map((r,j)=>j===i?{...r,[k]:v}:r));
 const addRate=()=>{const used=rates.map(r=>Number(r.crew_size));const next=[2,3,4,5,6,7,8,9,10,1].find(n=>!used.includes(n));if(!next)return;
  const last=rates[rates.length-1];setRates(rs=>[...rs,{crew_size:String(next),weekday:'',weekend:'',base:last?.base??'',perMile:last?.perMile??'1.20',roundTo:last?.roundTo??'5'}].sort((a,b)=>Number(a.crew_size)-Number(b.crew_size)))};
 const setItem=(i:number,k:keyof Item,v:string|boolean)=>setItems(xs=>xs.map((x,j)=>j===i?{...x,[k]:v}:x));

 async function savePricing(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError('');setMessage('');
  try{
   const payload={settings:{depot_address:settings.depot,minimum_minutes:Math.round(Number(settings.minHours)*60),billing_increment_minutes:Number(settings.increment),standard_deposit_cents:cents(settings.deposit,'Standard deposit'),out_of_town_deposit_percent:Number(settings.outPct)},
    rates:rates.map(r=>({crew_size:Number(r.crew_size),weekday_rate_cents:cents(r.weekday,r.crew_size+' movers weekday rate'),weekend_rate_cents:cents(r.weekend,r.crew_size+' movers weekend rate'),service_base_cents:cents(r.base,r.crew_size+' movers service base'),service_cents_per_mile:cents(r.perMile,r.crew_size+' movers per mile'),round_service_up_to_cents:cents(r.roundTo,r.crew_size+' movers rounding')}))};
   const r=await supabase.rpc('save_pricing',{target_company:companyId,payload});if(r.error)throw r.error;
   setMessage('Pricing saved. New and edited quotes use these rates; existing quotes keep their prices until edited.');setRevision(n=>n+1)}
  catch(e){setError(errorText(e,'Could not save pricing.'))}finally{setBusy(false)}}

 async function saveItems(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError('');setMessage('');
  try{const payload=items.map(x=>({id:x.id||null,name:x.name,category:x.category,unit_label:x.unit_label||'each',unit_price_cents:cents(x.price||'0',x.name||'New add-on'),active:x.active}));
   const r=await supabase.rpc('save_price_items',{target_company:companyId,items:payload});if(r.error)throw r.error;
   setMessage('Add-on prices saved.');setRevision(n=>n+1)}
  catch(e){setError(errorText(e,'Could not save add-ons.'))}finally{setBusy(false)}}

 if(loading)return <p>Loading pricing…</p>;
 return <>
  <p role="alert" className="error">{error}</p><p role="status" className="success">{message}</p>
  <form onSubmit={savePricing}><fieldset disabled={busy}>
   <section className="panel"><h2>Crew rates</h2>
    <p>Hourly rates by crew size, and the service charge: <b>base + per-mile × round-trip miles</b>, rounded up. Changes apply to new quotes and to estimates/jobs when they're next edited.</p>
    <div className="tablewrap"><table className="ratetable"><thead><tr><th>Crew</th><th>Weekday $/hr</th><th>Weekend $/hr</th><th>Service base $</th><th>Per mile $</th><th>Round up to $</th><th></th></tr></thead><tbody>
     {rates.map((r,i)=><tr key={i}>
      <td><select aria-label="Crew size" value={r.crew_size} onChange={e=>setRate(i,'crew_size',e.target.value)}>{Array.from({length:10},(_,k)=>k+1).filter(n=>n===Number(r.crew_size)||!rates.some(x=>Number(x.crew_size)===n)).map(n=><option key={n} value={n}>{n} movers</option>)}</select></td>
      <td><input aria-label={`${r.crew_size} movers weekday rate`} inputMode="decimal" required value={r.weekday} onChange={e=>setRate(i,'weekday',e.target.value)}/></td>
      <td><input aria-label={`${r.crew_size} movers weekend rate`} inputMode="decimal" required value={r.weekend} onChange={e=>setRate(i,'weekend',e.target.value)}/></td>
      <td><input aria-label={`${r.crew_size} movers service base`} inputMode="decimal" required value={r.base} onChange={e=>setRate(i,'base',e.target.value)}/></td>
      <td><input aria-label={`${r.crew_size} movers per mile`} inputMode="decimal" required value={r.perMile} onChange={e=>setRate(i,'perMile',e.target.value)}/></td>
      <td><input aria-label={`${r.crew_size} movers rounding`} inputMode="decimal" required value={r.roundTo} onChange={e=>setRate(i,'roundTo',e.target.value)}/></td>
      <td>{rates.length>1&&<button type="button" className="iconbtn iconbtn-remove" title="Remove this crew size" aria-label={`Remove ${r.crew_size} movers`} onClick={()=>{if(window.confirm(`Remove the ${r.crew_size}-mover rates? Existing quotes keep their prices, but new ${r.crew_size}-mover quotes won't be possible.`))setRates(rs=>rs.filter((_,j)=>j!==i))}}>✕</button>}</td>
     </tr>)}
    </tbody></table></div>
    {rates.length<10&&<button type="button" className="secondary" onClick={addRate}>+ Add crew size</button>}
   </section>
   <section className="panel"><h2>General pricing rules</h2>
    <div className="fields">
     <label>Depot address (start/end of mileage)<input required value={settings.depot} onChange={e=>setSettings(s=>({...s,depot:e.target.value}))}/></label>
     <label>Minimum billed hours<input type="number" min="0.25" max="24" step="0.25" required value={settings.minHours} onChange={e=>setSettings(s=>({...s,minHours:e.target.value}))}/></label>
     <label>Billing increment (minutes)<input type="number" min="1" max="120" required value={settings.increment} onChange={e=>setSettings(s=>({...s,increment:e.target.value}))}/></label>
     <label>Standard deposit ($)<input inputMode="decimal" required value={settings.deposit} onChange={e=>setSettings(s=>({...s,deposit:e.target.value}))}/></label>
     <label>Out-of-town deposit (% of total)<input type="number" min="0" max="100" step="0.5" required value={settings.outPct} onChange={e=>setSettings(s=>({...s,outPct:e.target.value}))}/></label>
    </div>
    <button className="primary">{busy?'Saving…':'Save rates and rules'}</button>
   </section>
  </fieldset></form>
  <form onSubmit={saveItems}><fieldset disabled={busy}>
   <section className="panel"><h2>Add-ons and packing materials</h2>
    <p>Add these to estimates with a quantity. Switch an item off instead of deleting it: quotes that already include it keep their price.</p>
    <div className="tablewrap"><table className="ratetable"><thead><tr><th>Name</th><th>Type</th><th>Unit</th><th>Price $</th><th>Available</th></tr></thead><tbody>
     {items.map((x,i)=><tr key={x.id||'new'+i} className={x.active?'':'inactive'}>
      <td><input aria-label="Add-on name" required maxLength={100} value={x.name} onChange={e=>setItem(i,'name',e.target.value)}/></td>
      <td><select aria-label="Type" value={x.category} onChange={e=>setItem(i,'category',e.target.value)}><option value="fee">Fee</option><option value="material">Packing material</option></select></td>
      <td><input aria-label="Unit" maxLength={20} value={x.unit_label} onChange={e=>setItem(i,'unit_label',e.target.value)} placeholder="each"/></td>
      <td><input aria-label={`${x.name} price`} inputMode="decimal" required value={x.price} onChange={e=>setItem(i,'price',e.target.value)}/></td>
      <td><div className="miniswitch" role="group" aria-label={`${x.name} available`}><button type="button" className="yes" aria-pressed={x.active} onClick={()=>setItem(i,'active',true)}>On</button><button type="button" className="no" aria-pressed={!x.active} onClick={()=>setItem(i,'active',false)}>Off</button></div></td>
     </tr>)}
    </tbody></table></div>
    {items.some(x=>x.active&&(x.price===''||Number(x.price)===0))&&<p className="warning">Some add-ons are still $0. Set their prices before quoting them.</p>}
    <div className="formactions"><button type="button" className="secondary" onClick={()=>setItems(xs=>[...xs,{id:'',name:'',category:'fee',unit_label:'each',price:'',active:true}])}>+ Add an add-on</button><button className="primary">{busy?'Saving…':'Save add-ons'}</button></div>
   </section>
  </fieldset></form>
 </>;
}
