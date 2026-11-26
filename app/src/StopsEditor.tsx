// Editor for a job's 2–5 addresses ("stops"). First must be a pick-up, last a drop-off (checked on save).
export type Stop={kind:'pickup'|'dropoff';address:string;location_type:string;bedrooms:string;floor:string;unit:string;access_notes:string};
export const LOCATION_TYPES:[string,string][]=[['house','House'],['townhouse','Townhouse'],['apartment','Apartment'],['high_rise','High-rise'],['storage','Storage unit'],['office','Office'],['warehouse','Warehouse'],['retail','Retail'],['other','Other']];
const HAS_BEDROOMS=['house','townhouse','apartment','high_rise','other',''];
export const emptyStop=(kind:'pickup'|'dropoff'):Stop=>({kind,address:'',location_type:'',bedrooms:'',floor:'',unit:'',access_notes:''});
/** Stored rows (numbers/nulls) → editable strings. */
export function toStops(rows:{kind:string;address:string;location_type:string|null;bedrooms:number|null;floor:number|null;unit:string|null;access_notes:string|null}[]):Stop[]{
 return rows.map(r=>({kind:r.kind==='dropoff'?'dropoff':'pickup',address:r.address,location_type:r.location_type??'',bedrooms:r.bedrooms==null?'':String(r.bedrooms),floor:r.floor==null?'':String(r.floor),unit:r.unit??'',access_notes:r.access_notes??''}));
}
export const bedroomLabel=(b:string|number|null)=>b===''||b===null||b===undefined?'':Number(b)===0?'Studio':`${b} BR`;

export default function StopsEditor({stops,onChange,disabled=false}:{stops:Stop[];onChange:(next:Stop[],addressChanged:boolean)=>void;disabled?:boolean}){
 const set=(i:number,key:keyof Stop,value:string)=>onChange(stops.map((s,k)=>k===i?{...s,[key]:value}:s),key==='address');
 const move=(i:number,d:-1|1)=>{const n=[...stops];[n[i],n[i+d]]=[n[i+d],n[i]];onChange(n,true)};
 const remove=(i:number)=>onChange(stops.filter((_,k)=>k!==i),true);
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
     <button type="button" className="iconbtn danger" disabled={disabled||stops.length<=2} onClick={()=>remove(i)} aria-label={`Remove stop ${i+1}`} title="Remove">✕</button>
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
  {stops.length<5&&<button type="button" className="secondary addstop" disabled={disabled} onClick={add}>+ Add another address ({5-stops.length} left)</button>}
 </div>;
}
