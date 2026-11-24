export type Rate={crew_size:number;weekday_rate_cents:number;weekend_rate_cents:number;service_base_cents:number;service_cents_per_mile:number;round_service_up_to_cents:number};
export type Settings={depot_address:string;minimum_minutes:number;billing_increment_minutes:number;standard_deposit_cents:number;out_of_town_deposit_percent:number};
export function priceEstimate(rate:Rate,settings:Settings,date:string,minutes:number,miles:number,flat:number|null,outtown:boolean){
 const day=new Date(date+'T12:00:00Z').getUTCDay();
 if(!date||!Number.isFinite(day))throw Error('Choose a move date.');
 let hourly:number|null=null,service=0,billed=0,total=0;
 if(flat!==null){if(!Number.isSafeInteger(flat)||flat<=0||flat>100000000)throw Error('Enter a positive flat rate.');total=flat}
 else {if(outtown)throw Error('Out-of-town moves require a flat rate.');if(!Number.isFinite(minutes)||minutes<1||minutes>10080||!Number.isFinite(miles)||miles<0||miles>100000)throw Error('Enter estimated time and round-trip miles.');billed=Math.max(settings.minimum_minutes,Math.ceil(minutes/settings.billing_increment_minutes)*settings.billing_increment_minutes);hourly=Number(day===0||day===6?rate.weekend_rate_cents:rate.weekday_rate_cents);service=Math.ceil((Number(rate.service_base_cents)+Math.round(miles*100)/100*rate.service_cents_per_mile)/rate.round_service_up_to_cents)*rate.round_service_up_to_cents;total=Math.round(hourly*billed/60)+service;}
 return {hourly,service,billed,total,deposit:outtown?Math.round(total*settings.out_of_town_deposit_percent/100):Number(settings.standard_deposit_cents)};
}
