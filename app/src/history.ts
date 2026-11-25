// Turns raw audit_log rows into a readable job change history.
// One "save" in the app writes several audit rows in the same database transaction
// (same `at` timestamp): the job update(s) plus assignment rows that are deleted and re-inserted.
// We group by transaction + actor, then report only what actually changed.

export type AuditRow = {
  id: number;
  table_name: string;
  row_id: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  actor: string | null;
  at: string;
  old_row: Record<string, unknown> | null;
  new_row: Record<string, unknown> | null;
};

export type HistoryEntry = { at: string; actor: string | null; changes: string[] };

const money = (v: unknown) =>
  v === null || v === undefined ? 'none' : (Number(v) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const hours = (v: unknown) => (v === null || v === undefined ? 'none' : `${Number(v) / 60} h`);
const time = (v: unknown) => (v ? String(v).slice(0, 5) : 'not set');
const plain = (v: unknown) => (v === null || v === undefined || v === '' ? 'blank' : String(v).replaceAll('_', ' '));
const yesNo = (v: unknown) => (v ? 'yes' : 'no');

// Fields shown in the history, in display order. Internal fields (ids, row_version, …) are left out.
const FIELDS: [key: string, label: string, format: (v: unknown) => string][] = [
  ['status', 'Status', plain],
  ['customer_name', 'Customer', plain],
  ['move_date', 'Move date', plain],
  ['arrival_time', 'Arrival time', time],
  ['scheduled_minutes', 'Scheduled duration', hours],
  ['pick_up_address', 'Pick-up', plain],
  ['drop_off_address', 'Drop-off', plain],
  ['access_instructions', 'Instructions', plain],
  ['move_type', 'Move type', plain],
  ['out_of_town', 'Out of town', yesNo],
  ['crew_size', 'Crew size', plain],
  ['truck_label', 'Truck', plain],
  ['pricing_model', 'Pricing', plain],
  ['hourly_rate_cents', 'Hourly rate', money],
  ['flat_rate_cents', 'Flat rate', money],
  ['estimated_minutes', 'Estimated labor', hours],
  ['round_trip_miles', 'Round-trip miles', plain],
  ['service_charge_cents', 'Service charge', money],
  ['quoted_total_cents', 'Quoted total', money],
  ['deposit_required_cents', 'Deposit required', money],
];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function describeJobHistory(rows: AuditRow[]): HistoryEntry[] {
  const groups = new Map<string, AuditRow[]>();
  for (const r of [...rows].sort((a, b) => a.id - b.id)) {
    const key = `${r.at}|${r.actor ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const entries: HistoryEntry[] = [];
  for (const group of groups.values()) {
    const changes: string[] = [];
    const jobRows = group.filter((r) => r.table_name === 'jobs');
    if (jobRows.some((r) => r.action === 'INSERT')) {
      changes.push('Created estimate');
    } else if (jobRows.length) {
      const before = jobRows[0].old_row ?? {};
      const after = jobRows[jobRows.length - 1].new_row ?? {};
      for (const [key, label, format] of FIELDS) {
        if (!same(before[key], after[key])) changes.push(`${label}: ${format(before[key])} → ${format(after[key])}`);
      }
    }
    // Crew: compare who was assigned before vs after this save (delete + re-insert of the same person is no change).
    const removed = new Map<string, string>(), added = new Map<string, string>();
    for (const r of group.filter((x) => x.table_name === 'job_assignments')) {
      const row = (r.new_row ?? r.old_row ?? {}) as Record<string, unknown>;
      const user = String(row.user_id), name = String(row.crew_display_name ?? 'crew member');
      if (r.action === 'DELETE') removed.set(user, name);
      if (r.action === 'INSERT') added.set(user, name);
    }
    for (const [user, name] of added) if (!removed.has(user)) changes.push(`Assigned ${name}`);
    for (const [user, name] of removed) if (!added.has(user)) changes.push(`Removed ${name}`);
    if (group.some((r) => r.table_name === 'job_office_notes')) changes.push('Office notes changed');
    if (changes.length) entries.push({ at: group[0].at, actor: group[0].actor, changes });
  }
  return entries.reverse(); // newest first
}

// ---- Generic single-table history (used for customers) -------------------------------------
export type Field=[key:string,label:string,format:(v:unknown)=>string];
const list=(v:unknown)=>Array.isArray(v)&&v.length?v.join(', '):'none';
const referral=(v:unknown)=>v?String(v).replaceAll('_',' / ').replace('friend / family','friend/family'):'blank';
export const CUSTOMER_FIELDS:Field[]=[
  ['first_name','First name',plain],['last_name','Last name',plain],['email','Email',plain],
  ['phone','Phone',plain],['phone2','Second phone',plain],['referral_source','Referral source',referral],
  ['tags','Tags',list],['office_notes','Office notes',v=>v?'updated':'cleared'],
];
/** One entry per save (transaction + actor), listing only changed fields. Newest first. */
export function describeRecordHistory(rows:AuditRow[],fields:Field[],createdText='Created'):HistoryEntry[]{
  const groups=new Map<string,AuditRow[]>();
  for(const r of [...rows].sort((a,b)=>a.id-b.id)){const k=`${r.at}|${r.actor??''}`;if(!groups.has(k))groups.set(k,[]);groups.get(k)!.push(r)}
  const out:HistoryEntry[]=[];
  for(const g of groups.values()){
    const changes:string[]=[];
    if(g.some(r=>r.action==='INSERT'))changes.push(createdText);
    else{const before=g[0].old_row??{},after=g[g.length-1].new_row??{};
      for(const [k,label,fmt] of fields)if(!same(before[k],after[k]))changes.push(k==='office_notes'?`Office notes ${fmt(after[k])}`:`${label}: ${fmt(before[k])} → ${fmt(after[k])}`)}
    if(changes.length)out.push({at:g[0].at,actor:g[0].actor,changes});
  }
  return out.reverse();
}
