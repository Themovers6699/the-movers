// Pure helpers for job stops (no screen code, so tests can import them directly).
export type Stop={kind:'pickup'|'dropoff';address:string;location_type:string;bedrooms:string;floor:string;unit:string;access_notes:string};
export const LOCATION_TYPES:[string,string][]=[['house','House'],['townhouse','Townhouse'],['apartment','Apartment'],['high_rise','High-rise'],['storage','Storage unit'],['office','Office'],['warehouse','Warehouse'],['retail','Retail'],['other','Other']];
export const HAS_BEDROOMS=['house','townhouse','apartment','high_rise','other',''];
export const emptyStop=(kind:'pickup'|'dropoff'):Stop=>({kind,address:'',location_type:'',bedrooms:'',floor:'',unit:'',access_notes:''});
/** Stored rows (numbers/nulls) → editable strings. */
export function toStops(rows:{kind:string;address:string;location_type:string|null;bedrooms:number|null;floor:number|null;unit:string|null;access_notes:string|null}[]):Stop[]{
 return rows.map(r=>({kind:r.kind==='dropoff'?'dropoff':'pickup',address:r.address,location_type:r.location_type??'',bedrooms:r.bedrooms==null?'':String(r.bedrooms),floor:r.floor==null?'':String(r.floor),unit:r.unit??'',access_notes:r.access_notes??''}));
}
/** Load-only, unload-only and pack-only jobs may have a single address; everything else needs a pick-up and a drop-off. */
export const minStops=(serviceType?:string)=>['load_only','unload_only','pack_only'].includes(serviceType??'')?1:2;
/** Problems to show right away (the same rules are enforced by the database). */
export function stopProblems(stops:Stop[],serviceType='full_move'):string[]{
 const p:string[]=[];const min=minStops(serviceType);
 if(stops.length<min){p.push('A full move or same-complex job needs a pick-up and a drop-off. Add another address, or change the service type.');return p}
 if(stops.length===1){
  if(serviceType==='load_only'&&stops[0].kind!=='pickup')p.push('A load-only job\'s address must be a pick-up.');
  if(serviceType==='unload_only'&&stops[0].kind!=='dropoff')p.push('An unload-only job\'s address must be a drop-off.');
  return p;
 }
 if(stops[0].kind!=='pickup')p.push('The first address must be a pick-up. Use ↑ ↓ to reorder, or change its type.');
 if(stops[stops.length-1].kind!=='dropoff')p.push('The last address must be a drop-off. Use ↑ ↓ to reorder, or change its type.');
 return p;
}export const bedroomLabel=(b:string|number|null)=>b===''||b===null||b===undefined?'':Number(b)===0?'Studio':`${b} BR`;
