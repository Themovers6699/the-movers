import {test} from 'node:test';import assert from 'node:assert/strict';import {stopProblems,emptyStop,toStops,bedroomLabel,minStops} from '../src/stops.ts';
const p=emptyStop('pickup'),d=emptyStop('dropoff');
test('Correct order has no warnings',()=>{assert.deepEqual(stopProblems([p,d]),[]);assert.deepEqual(stopProblems([p,p,d]),[]);assert.deepEqual(stopProblems([p,d,d]),[])});
test('Wrong order is reported right away, both ends',()=>{assert.match(stopProblems([d,p])[0],/first address must be a pick-up/);assert.match(stopProblems([d,p])[1],/last address must be a drop-off/);assert.equal(stopProblems([p,p]).length,1)});
test('Stored stops become editable strings; studio shows as Studio',()=>{const s=toStops([{kind:'dropoff',address:'A',location_type:null,bedrooms:0,floor:12,unit:null,access_notes:null}]);assert.deepEqual(s[0],{kind:'dropoff',address:'A',location_type:'',bedrooms:'0',floor:'12',unit:'',access_notes:''});assert.equal(bedroomLabel('0'),'Studio');assert.equal(bedroomLabel(3),'3 BR');assert.equal(bedroomLabel(''),'')});
test('Load/unload/pack-only jobs may have one address of the right kind; full moves need two',()=>{
 assert.equal(minStops('load_only'),1);assert.equal(minStops('pack_only'),1);assert.equal(minStops('full_move'),2);assert.equal(minStops('same_complex'),2);
 assert.deepEqual(stopProblems([p],'load_only'),[]);assert.match(stopProblems([d],'load_only')[0],/load-only job's address must be a pick-up/);
 assert.deepEqual(stopProblems([d],'unload_only'),[]);assert.match(stopProblems([p],'unload_only')[0],/drop-off/);
 assert.deepEqual(stopProblems([d],'pack_only'),[]);assert.deepEqual(stopProblems([p],'pack_only'),[]);
 assert.match(stopProblems([p],'full_move')[0],/needs a pick-up and a drop-off/);
 assert.deepEqual(stopProblems([p,d],'load_only'),[]);
});
