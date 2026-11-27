// Import rules, tested with made-up examples shaped like the old spreadsheet (no real customer data).
import {test} from 'node:test';import assert from 'node:assert/strict';
import {parsePrice,parseWindow,parseLocation,parseNotes,usDigits,phonesIn,excelDate,splitName,parseCsv} from '../../tools/import/lib.mjs';
test('Hourly prices: crew / hourly / service / deposit, NONE, discounts, missing deposit',()=>{
 assert.deepEqual(parsePrice('3 / 125 / 150 / 50'),{kind:'hourly',crew:3,hourly:12500,service:15000,deposit:5000,extra:'',unusual:false});
 const n=parsePrice('2 / 100 / 85 / NONE + 10% off');assert.equal(n.kind,'hourly');assert.equal(n.deposit,0);assert.equal(n.extra,'+ 10% OFF');
 assert.equal(parsePrice('2/ 90 / 75 / NONE').deposit,0);assert.equal(parsePrice('3 / 110 / 95').service,9500);
 const q=parsePrice('3 / 125 / 95 ??? / NONE + 5% OFF');assert.equal(q.kind,'hourly');assert.equal(q.unusual,true);
 assert.equal(parsePrice('2 / 100 / NONE').service,null);
});
test('Flat prices: price FLAT / deposit, %, NONE, ranges and extras kept as notes',()=>{
 assert.deepEqual(parsePrice('2 / 900 FLAT / 50'),{kind:'flat',crew:2,flat:90000,deposit:5000,extra:'',unusual:false});
 assert.equal(parsePrice('4 / 2000 FLAT / 50%').deposit,100000);assert.equal(parsePrice('2 / 450 FLAT / NONE').deposit,0);
 const r=parsePrice('3 / 900-1000 FLAT / 100');assert.equal(r.flat,90000);assert.match(r.extra,/range 900-1000/);
 const x=parsePrice('3 / 1200 FLAT + 300 PIANO + 100 MASSAGE CHAIR / NONE');assert.equal(x.flat,120000);assert.match(x.extra,/300 PIANO/);
 assert.equal(parsePrice('2 / 600 FLAT / ?').unusual,true);
});
test('Unknown prices stay unknown',()=>{for(const s of ['unknown?','unknown','unknown + 10% off','','0 / 100 / 50 / 50'])assert.equal(parsePrice(s).kind,'unknown')});
test('Arrival windows like the old TIME column',()=>{
 assert.deepEqual(parseWindow('8-9AM'),{start:'08:00',end:'09:00',ok:true});assert.deepEqual(parseWindow('12-2PM'),{start:'12:00',end:'14:00',ok:true});
 assert.deepEqual(parseWindow('11AM-1PM'),{start:'11:00',end:'13:00',ok:true});assert.deepEqual(parseWindow('11-1PM'),{start:'11:00',end:'13:00',ok:true});
 assert.deepEqual(parseWindow('10-12PM'),{start:'10:00',end:'12:00',ok:true});assert.deepEqual(parseWindow('9AM'),{start:'09:00',end:null,ok:true});
 assert.deepEqual(parseWindow('OPEN'),{start:null,end:null,ok:true});assert.equal(parseWindow('morning').ok,false);
});
test('Location codes (owner confirmed)',()=>{
 assert.deepEqual(parseLocation('APT'),{location_type:'apartment',bedrooms:null,extra:'',commercial:false,ok:true});
 assert.equal(parseLocation('2APT').bedrooms,2);assert.deepEqual([parseLocation('4B').location_type,parseLocation('4B').bedrooms],['house',4]);
 assert.equal(parseLocation('2TH').location_type,'townhouse');assert.equal(parseLocation('STR').location_type,'storage');assert.equal(parseLocation('OFC').commercial,true);
 assert.equal(parseLocation('APT STR').extra,'Also: storage');assert.equal(parseLocation('-').location_type,null);assert.equal(parseLocation('XYZ').ok,false);
});
test('Notes become service type, truck flag, tags and cancellations',()=>{
 assert.deepEqual(parseNotes('unload only- no truck'),{service:'unload_only',truck:false,tags:[],cancelled:false,cancelCheck:false});
 assert.equal(parseNotes('load only-no truck').service,'load_only');assert.equal(parseNotes('same complex- need truck').truck,true);
 assert.deepEqual(parseNotes('Repeat customer, VIP').tags,['repeat','vip']);assert.equal(parseNotes('CANCELLED').cancelled,true);
 assert.equal(parseNotes('cancelled 11/14').cancelled,true);
 const redo=parseNotes('cancelled 5/2, re-did 5/9');assert.deepEqual([redo.cancelled,redo.cancelCheck],[false,true]);
 const again=parseNotes('cancelled in may, rescheduled for july, cancelled');assert.deepEqual([again.cancelled,again.cancelCheck],[true,true]);
 assert.equal(parseNotes('cancelled twice, then paid 6/1').cancelled,false);
 const pol=parseNotes('cancel w/in 3 days of non-payment');assert.deepEqual([pol.cancelled,pol.cancelCheck],[false,false]);
});
test('Phones, dates and names',()=>{
 assert.equal(usDigits("'+14695550100"),'4695550100');assert.equal(usDigits('555-0100'),null);
 assert.deepEqual(phonesIn('469-555-0100 214-555-0101'),['4695550100','2145550101']);assert.deepEqual(phonesIn('214718-2244'),['2147182244']);
 assert.equal(excelDate('46000'),'2025-12-09');assert.equal(excelDate('45658'),'2025-01-01');assert.equal(excelDate('TBD'),null);
 assert.deepEqual(splitName('Maria de la Cruz'),{first:'Maria de la',last:'Cruz'});
 assert.deepEqual(parseCsv('a,b\r\n"x, y","He said ""hi"""\n'),[{a:'x, y',b:'He said "hi"'}]);
});