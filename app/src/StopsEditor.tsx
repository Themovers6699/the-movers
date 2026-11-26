import {useEffect,useState} from 'react';
// Editor for a job's 2–5 addresses ("stops"). First must be a pick-up, last a drop-off (shown live, enforced on save).
import {emptyStop,stopProblems,minStops,LOCATION_TYPES,HAS_BEDROOMS,type Stop} from './stops';
export {emptyStop,toStops,stopProblems,minStops,bedroomLabel,LOCATION_TYPES,type Stop} from './stops';

export default function StopsEditor({stops,onChange,disabled=false,serviceType='full_move'}:{stops:Stop[];onChange:(next:Stop[],addressChanged:boolean)=>void;disabled?:boolean;serviceType?:string}){
 const min=minStops(serviceType);
 const [notice,setNotice]=useState('');
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),5000);return()=>clearTimeout(t)},[notice]);
 const problems=stopProblems(stops,serviceType);
 const set=(i:number,key:keyof Stop,value:string)=>onChange(stops.map((s,k)=>k===i?{...s,[key]:value}:s),key==='address');
 const move=(i:number,d:-1|1)=>{const n=[...stops];[n[i],n[i+d]]=[n[i+d],n[i]];onChange(n,true)};
 const remove=(i:number)=>{const a=stops[i].address.trim();if(a&&!window.confirm(`Remove stop ${i+1} (${a})?`))return;onChange(stops.filter((_,k)=>k!==i),true);setNotice(`Stop ${i+1}${a?' ('+a+')':''} removed.`)};
 // New stops go just before the final drop-off (e.g. a second pick-up at a storage unit).
 const add=()=>{const n=[...stops];n.splice(n.length-1,0,emptyStop('pickup'));onChange(n,true)};
 return <div className="stops">
  {stops.map((s,i)=><div className={'stopcard '+s.kind} key={i}>
   <div className="stophead">
    <span className="stopnum">{i+1}</span>
    <select aria-label={`Stop ${i+1} type`} value={s.kind} disabled={disabled} onChange={e=>set(i,'kind',e.target.value)}><option value="pickup">Pick-up</option><option value="dropoff">Drop-off</option></select>
    <span className="stoptools">
     <button type="button" className="iconbtn" disabled={disabled||i===0} onClick={()=>move(i,-1)} aria-label={`Move stop ${i+1} up`} title="Move up">↑</button>
     <button type="button" className="iconbtn" disabled={disabled||i===stops.length-1} onClick={()=>move(i,1)} aria-label={`Move stop ${i+1} down`} title="Move down">↓</button>
     {i>0&&stops.length>min&&<button type="button" className="iconbtn iconbtn-remove" disabled={disabled} onClick={()=>remove(i)} aria-label={`Remove stop ${i+1}`} title="Remove this address">✕</button>}
    </span>
   </div>
   <label>Address<input required maxLength={300} value={s.address} disabled={disabled} onChange={e=>set(i,'address',e.target.value)} placeholder="Street, city"/></label>
   <div className="stopgrid">
    <label>Location type<select value={s.location_type} disabled={disabled} onChange={e=>set(i,'location_type',e.target.value)}><option value="">Not set</option>{LOCATION_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    {HAS_BEDROOMS.includes(s.location_type)&&<label>Bedrooms<select value={s.bedrooms} disabled={disabled} onChange={e=>set(i,'bedrooms',e.target.value)}><option value="">Not set</option><option value="0">Studio</option>{Array.from({length:10},(_,k)=><option key={k+1} value={k+1}>{k+1}</option>)}</select></label>}
    <label>Floor<input type="number" min={-5} max={200} value={s.floor} disabled={disabled} onChange={e=>set(i,'floor',e.target.value)} placeholder="1"/></label>
    <label>Unit / apt<input maxLength={40} value={s.unit} disabled={disabled} onChange={e=>set(i,'unit',e.target.value)}/></label>
   </div>
   <label>Access notes for the crew<input maxLength={1000} value={s.access_notes} disabled={disabled} onChange={e=>set(i,'access_notes',e.target.value)} placeholder="Gate code, elevator reservation, parking…"/></label>
  </div>)}
  {problems.length>0&&<div className="stopwarning" role="alert">{problems.map(p=><div key={p}>⚠ {p}</div>)}</div>}
  {notice&&<div className="stopnotice" role="status">{notice}</div>}
  {stops.length<=min&&<p className="muted">{min===1?'Load-only, unload-only and pack-only jobs can have just this one address.':'A full move needs at least one pick-up and one drop-off. For a single address, set the service type to Load only, Unload only or Pack only.'}</p>}
  {stops.length<5&&<button type="button" className="secondary addstop" disabled={disabled} onClick={add}>+ Add another address ({5-stops.length} left)</button>}
 </div>;
}
