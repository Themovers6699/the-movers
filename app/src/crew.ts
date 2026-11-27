// Helpers for the crew screens (no screen code, so tests can import them).

/** Opens the address in Google Maps (app on phones, website on computers). */
export const mapsUrl=(address:string)=>'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address.trim());
/** "tel:" link for a stored +1 number; null if there is no usable number. */
export const telUrl=(phone:string|null|undefined)=>{const d=(phone??'').replace(/[^\d+]/g,'');return /^\+?\d{10,11}$/.test(d)?'tel:'+d:null};

export const STATUS_LABELS:Record<string,string>={booked:'Booked',in_progress:'In progress',completed:'Completed',cancelled:'Cancelled'};
export const SERVICE_LABELS:Record<string,string>={full_move:'Full move',load_only:'Load only',unload_only:'Unload only',pack_only:'Pack only',same_complex:'Same complex'};
export const LOCATION_LABELS:Record<string,string>={house:'House',townhouse:'Townhouse',apartment:'Apartment',high_rise:'High-rise',storage:'Storage unit',office:'Office',warehouse:'Warehouse',retail:'Retail',other:'Other'};

/** One line describing a stop: "Apartment · 2 BR · Floor 3 · Unit 12B". */
export function stopDetails(s:{location_type?:string|null;bedrooms?:number|null;floor?:number|null;unit?:string|null}){
 return [s.location_type?LOCATION_LABELS[s.location_type]??s.location_type:'',s.bedrooms==null?'':s.bedrooms===0?'Studio':`${s.bedrooms} BR`,s.floor==null?'':`Floor ${s.floor}`,s.unit?`Unit ${s.unit}`:''].filter(Boolean).join(' · ');
}

/** Size to shrink a phone photo to (longest side at most `max`), keeping its shape. */
export function fitWithin(width:number,height:number,max=1600){
 if(width<=max&&height<=max)return {width,height};
 const k=max/Math.max(width,height);return {width:Math.round(width*k),height:Math.round(height*k)};
}

/** Days from `today` to `date` (both YYYY-MM-DD): 0 = today, 1 = tomorrow, -1 = yesterday. */
export const daysFrom=(today:string,date:string)=>Math.round((Date.parse(date+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000);
export function dayLabel(today:string,date:string){
 const n=daysFrom(today,date);if(n===0)return 'Today';if(n===1)return 'Tomorrow';if(n===-1)return 'Yesterday';
 return new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'}).format(new Date(date+'T12:00:00Z'));
}
