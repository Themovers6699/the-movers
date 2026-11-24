import {test} from 'node:test';import assert from 'node:assert/strict';import {describeJobHistory} from '../src/history.ts';
const job={id:'j1',company_id:'c',status:'booked',customer_name:'Test',move_date:'2026-12-01',arrival_time:'09:00:00',scheduled_minutes:120,row_version:3,truck_label:'Truck 1',quoted_total_cents:50000};
const owner='u-owner',lead='u-lead',mover='u-mover';
const at1='2026-11-24T18:00:00Z',at2='2026-11-24T19:30:00Z';
test('A save that changes the arrival time reports only that change, with who and when',()=>{
 const rows=[
  {id:1,table_name:'jobs',row_id:'j1',action:'UPDATE',actor:owner,at:at1,old_row:job,new_row:{...job,arrival_time:'10:00:00',row_version:4}},
  {id:2,table_name:'jobs',row_id:'j1',action:'UPDATE',actor:owner,at:at1,old_row:{...job,arrival_time:'10:00:00',row_version:4},new_row:{...job,arrival_time:'10:00:00',row_version:5}},
  // dispatch save deletes and re-inserts the same crew: not a change
  {id:3,table_name:'job_assignments',row_id:'j1/'+lead,action:'DELETE',actor:owner,at:at1,old_row:{user_id:lead,crew_display_name:'Leader'},new_row:null},
  {id:4,table_name:'job_assignments',row_id:'j1/'+lead,action:'INSERT',actor:owner,at:at1,old_row:null,new_row:{user_id:lead,crew_display_name:'Leader'}}];
 assert.deepEqual(describeJobHistory(rows),[{at:at1,actor:owner,changes:['Arrival time: 09:00 → 10:00']}]);
});
test('Crew added and removed are reported by name; newest entry first',()=>{
 const rows=[
  {id:1,table_name:'job_assignments',row_id:'j1/'+lead,action:'INSERT',actor:owner,at:at1,old_row:null,new_row:{user_id:lead,crew_display_name:'Leader'}},
  {id:2,table_name:'job_assignments',row_id:'j1/'+lead,action:'DELETE',actor:owner,at:at2,old_row:{user_id:lead,crew_display_name:'Leader'},new_row:null},
  {id:3,table_name:'job_assignments',row_id:'j1/'+mover,action:'INSERT',actor:owner,at:at2,old_row:null,new_row:{user_id:mover,crew_display_name:'Mover'}}];
 const h=describeJobHistory(rows);
 assert.equal(h[0].at,at2);assert.deepEqual(h[0].changes,['Assigned Mover','Removed Leader']);assert.deepEqual(h[1].changes,['Assigned Leader']);
});
test('Creating an estimate, booking it and price changes read clearly',()=>{
 const est={...job,status:'estimate'};
 const rows=[
  {id:1,table_name:'jobs',row_id:'j1',action:'INSERT',actor:owner,at:at1,old_row:null,new_row:est},
  {id:2,table_name:'jobs',row_id:'j1',action:'UPDATE',actor:owner,at:at1,old_row:est,new_row:{...est,row_version:4}},
  {id:3,table_name:'jobs',row_id:'j1',action:'UPDATE',actor:owner,at:at2,old_row:est,new_row:{...est,status:'booked',quoted_total_cents:55000}}];
 const h=describeJobHistory(rows);
 assert.deepEqual(h[0].changes,['Status: estimate → booked','Quoted total: $500.00 → $550.00']);
 assert.deepEqual(h[1].changes,['Created estimate']);
});
test('Saves with no visible change are left out; dashboard edits have no actor',()=>{
 const rows=[{id:1,table_name:'jobs',row_id:'j1',action:'UPDATE',actor:null,at:at1,old_row:job,new_row:{...job,row_version:9}},
  {id:2,table_name:'jobs',row_id:'j1',action:'UPDATE',actor:null,at:at2,old_row:job,new_row:{...job,status:'cancelled'}}];
 assert.deepEqual(describeJobHistory(rows),[{at:at2,actor:null,changes:['Status: booked → cancelled']}]);
});
