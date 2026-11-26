// Arrival windows. The window start is jobs.arrival_time (used for scheduling conflicts);
// the end is jobs.arrival_window_end. Times are "HH:MM" or "HH:MM:SS" strings.

export const WINDOW_PRESETS:[label:string,start:string,end:string][]=[
 ['8–9 AM','08:00','09:00'],['9–10 AM','09:00','10:00'],['10–11 AM','10:00','11:00'],['11 AM–1 PM','11:00','13:00'],
 ['12–2 PM','12:00','14:00'],['1–3 PM','13:00','15:00'],['2–4 PM','14:00','16:00'],['3–5 PM','15:00','17:00'],
];

const hm=(t:string)=>t.slice(0,5);
function parts(t:string){const [h,m]=hm(t).split(':').map(Number);return {h12:h%12===0?12:h%12,m,ampm:h<12?'AM':'PM'}}
/** "08:00" → "8 AM", "13:30" → "1:30 PM" */
export function formatTime(t:string|null|undefined):string{if(!t)return '';const p=parts(t);return `${p.h12}${p.m?':'+String(p.m).padStart(2,'0'):''} ${p.ampm}`}
/** "08:00"+"09:00" → "8–9 AM"; "11:00"+"13:00" → "11 AM–1 PM"; start only → "8 AM"; nothing → "Time not set" */
export function formatWindow(start:string|null|undefined,end:string|null|undefined):string{
 if(!start)return 'Time not set';
 if(!end)return formatTime(start);
 const a=parts(start),b=parts(end);
 const left=`${a.h12}${a.m?':'+String(a.m).padStart(2,'0'):''}`;
 return a.ampm===b.ampm?`${left}–${formatTime(end)}`:`${formatTime(start)}–${formatTime(end)}`;
}
/** Index of the matching preset, or -1 for a custom window. */
export function presetIndex(start:string|null|undefined,end:string|null|undefined):number{
 if(!start||!end)return -1;return WINDOW_PRESETS.findIndex(([,s,e])=>s===hm(start)&&e===hm(end));
}
