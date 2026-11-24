import {test} from 'node:test';import assert from 'node:assert/strict';import {priceEstimate} from '../src/pricing.ts';
const s={minimum_minutes:120,billing_increment_minutes:15,standard_deposit_cents:5000,out_of_town_deposit_percent:50};
const r={crew_size:2,weekday_rate_cents:11000,weekend_rate_cents:12000,service_base_cents:7500,service_cents_per_mile:120,round_service_up_to_cents:500};
test('Two-hour minimum and 123 dollars rounded to 125 service charge',()=>assert.deepEqual(priceEstimate(r,s,'2026-11-16',30,40,null,false),{hourly:11000,service:12500,billed:120,total:34500,deposit:5000}));
test('Quarter-hour billing begins immediately after minimum',()=>{assert.equal(priceEstimate(r,s,'2026-11-16',121,40,null,false).billed,135);assert.equal(priceEstimate(r,s,'2026-11-16',135,40,null,false).billed,135)});
test('Saturday and Sunday use weekend rate',()=>{for(const d of ['2026-11-14','2026-11-15'])assert.equal(priceEstimate(r,s,d,120,0,null,false).hourly,12000)});
test('Service exact five dollar boundary does not round again',()=>assert.equal(priceEstimate(r,s,'2026-11-16',120,0,null,false).service,7500));
test('Flat quote includes service and outtown deposit is half',()=>assert.deepEqual(priceEstimate(r,s,'2026-11-16',NaN,NaN,123450,true),{hourly:null,service:0,billed:0,total:123450,deposit:61725}));
test('Invalid mileage and hourly long-distance are rejected',()=>{assert.throws(()=>priceEstimate(r,s,'2026-11-16',120,NaN,null,false));assert.throws(()=>priceEstimate(r,s,'2026-11-16',120,-1,null,false));assert.throws(()=>priceEstimate(r,s,'2026-11-16',120,4,null,true))});
