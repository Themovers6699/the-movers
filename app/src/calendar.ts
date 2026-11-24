export type CalendarJob={move_date:string;arrival_time:string|null;scheduled_minutes:number};
export const dateKey=(d:Date)=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
export function addDays(key:string,n:number){const d=new Date(key+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return dateKey(d)}
export function calendarDays(key:string,view:'day'|'week'|'month'){
 if(view==='day')return [key];const d=new Date((view==='month'?key.slice(0,7)+'-01':key)+'T12:00:00Z');const start=addDays(dateKey(d),-d.getUTCDay());return Array.from({length:view==='week'?7:42},(_,i)=>addDays(start,i));
}
export function occursOn(job:CalendarJob,key:string){if(!job.arrival_time)return job.move_date===key;const start=Date.parse(job.move_date+'T'+job.arrival_time.slice(0,5)+':00Z'),end=start+(job.scheduled_minutes??120)*60000;const day=Date.parse(key+'T00:00:00Z');return start<day+86400000&&end>day}
export function movePage(key:string,view:'day'|'week'|'month',direction:number){if(view!=='month')return addDays(key,(view==='week'?7:1)*direction);const d=new Date(key.slice(0,7)+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+direction);return dateKey(d)}
