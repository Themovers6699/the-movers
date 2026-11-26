export type Rate={crew_size:number;weekday_rate_cents:number;weekend_rate_cents:number;service_base_cents:number;service_cents_per_mile:number;round_service_up_to_cents:number};
export type Settings={depot_address:string;minimum_minutes:number;billing_increment_minutes:number;standard_deposit_cents:number;out_of_town_deposit_percent:number};
/** Optional extras: a service charge typed in by hand (mileage then not needed) and the add-ons total. */
export type Extras={manualServiceCents?:number|null;addOnsCents?:number};
// Mirrors the server: labor (minimum + increments) + service charge (base + miles, rounded up, or manual) + add-ons.
export function priceEstimate(rate:Rate,settings:Settings,date:string,minutes:number,miles:number,flat:number|null,outtown:boolean,extras:Extras={}){
 const day=new Date(date+'T12:00:00Z').getUTCDay();
 if(!date||!Number.isFinite(day))throw Error('Choose a move date.');
 const addOns=Math.max(0,Math.round(extras.addOnsCents??0));
 const manual=extras.manualServiceCents??null;
 let hourly:number|null=null,service=0,billed=0,total=0;
 if(flat!==null){if(!Number.isSafeInteger(flat)||flat<=0||flat>100000000)throw Error('Enter a positive flat rate.');total=flat+addOns}
 else {
  if(outtown)throw Error('Out-of-town moves require a flat rate.');
  if(!Number.isFinite(minutes)||minutes<1||minutes>10080)throw Error('Enter estimated time.');
  if(manual===null&&(!Number.isFinite(miles)||miles<0||miles>100000))throw Error('Enter estimated time and round-trip miles, or enter the service charge manually.');
  if(manual!==null&&(!Number.isSafeInteger(manual)||manual<0||manual>10000000))throw Error('Enter a valid service charge.');
  billed=Math.max(settings.minimum_minutes,Math.ceil(minutes/settings.billing_increment_minutes)*settings.billing_increment_minutes);
  hourly=Number(day===0||day===6?rate.weekend_rate_cents:rate.weekday_rate_cents);
  service=manual!==null?manual:Math.ceil((Number(rate.service_base_cents)+Math.round(miles*100)/100*rate.service_cents_per_mile)/rate.round_service_up_to_cents)*rate.round_service_up_to_cents;
  total=Math.round(hourly*billed/60)+service+addOns;
 }
 return {hourly,service,billed,total,addOns,deposit:outtown?Math.round(total*settings.out_of_town_deposit_percent/100):Number(settings.standard_deposit_cents)};
}
