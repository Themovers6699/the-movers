// Staff birthdays are stored as month + day only (no year). These helpers find upcoming ones.

const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
export const monthName=(m:number)=>MONTHS[m-1]??'';
export const daysInMonth=(m:number)=>m===2?29:[4,6,9,11].includes(m)?30:31;

const isLeap=(y:number)=>(y%4===0&&y%100!==0)||y%400===0;
const utc=(y:number,m:number,d:number)=>Date.UTC(y,m-1,d);

/** Days from `today` (YYYY-MM-DD) until the next birthday (0 = today). Feb 29 is celebrated on Feb 28 in non-leap years. */
export function daysUntilBirthday(month:number,day:number,today:string):number{
 const [ty,tm,td]=today.split('-').map(Number);
 const t=utc(ty,tm,td);
 for(const y of [ty,ty+1]){
  const d=month===2&&day===29&&!isLeap(y)?28:day;
  const when=utc(y,month,d);
  if(when>=t)return Math.round((when-t)/86400000);
 }
 return 365;
}

export type BirthdayPerson={name:string;month:number;day:number};
/** People with a birthday within `withinDays` of today, soonest first. */
export function upcomingBirthdays(people:BirthdayPerson[],today:string,withinDays=30){
 return people.map(p=>({...p,inDays:daysUntilBirthday(p.month,p.day,today)}))
  .filter(p=>p.inDays<=withinDays).sort((a,b)=>a.inDays-b.inDays||a.name.localeCompare(b.name));
}
