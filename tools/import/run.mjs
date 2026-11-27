// One-time import of the Square customer export and the old move-history spreadsheet.
//   node tools/import/run.mjs --square <csv> --moves <xlsx> --out <folder> --dry-run
//   node tools/import/run.mjs --square <csv> --moves <xlsx> --out <folder> --commit      (needs DATABASE_URL)
// --dry-run imports into a private in-memory copy of the database (all migrations) and writes the review report.
// --commit imports into the database in DATABASE_URL in ONE transaction, tagged with an import batch id.
// Prints counts only; customer details go to the review files in --out (outside the repository).
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {parseCsv,readXlsx,usDigits,e164,phonesIn,emailOrNull,dollarsToCents,excelDate,parseWindow,parsePrice,parseLocation,parseNotes,splitName} from './lib.mjs';

const args=Object.fromEntries(process.argv.slice(2).map((a,i,all)=>a.startsWith('--')?[a.slice(2),all[i+1]&&!all[i+1].startsWith('--')?all[i+1]:true]:null).filter(Boolean));
if(!args.square||!args.moves||!args.out||!(args['dry-run']||args.commit)){console.error('Usage: --square <csv> --moves <xlsx> --out <folder> (--dry-run | --commit)');process.exit(2)}
const TODAY=args.today??new Date().toISOString().slice(0,10);
const batch=randomUUID();

// ---------------- 1. Read ----------------
const squareRows=parseCsv(readFileSync(args.square,'utf8'));
const moveRows=readXlsx(args.moves);

// ---------------- 2. Customers from Square ----------------
const customers=[];const byPhone=new Map(),byEmail=new Map();
const review={cancelCheck:[],possibleDuplicates:[],noDate:[],priceUnknown:[],priceUnusual:[],timeUnusual:[],locationUnusual:[],dayMismatch:[],farFuture:[],newCustomersFromMoves:[],missingAddress:[]};
const index=c=>{for(const d of [c._phone,c._phone2])if(d){if(byPhone.has(d)&&byPhone.get(d)!==c)review.possibleDuplicates.push({reason:'same phone',phone:d,a:byPhone.get(d).name,b:c.name});else byPhone.set(d,c)}
 if(c.email){if(byEmail.has(c.email)&&byEmail.get(c.email)!==c)review.possibleDuplicates.push({reason:'same email',email:c.email,a:byEmail.get(c.email).name,b:c.name});else byEmail.set(c.email,c)}};
for(const r of squareRows){
 const first=r['First Name']||'',last=r['Last Name']||'';const sqId=r['Square Customer ID'];
 const phone=usDigits(r['Phone Number']);const email=emailOrNull(r['Email Address']);
 const unnamed=!first&&!last;
 const c={id:randomUUID(),first_name:unnamed?`Unnamed (Square ${String(sqId).slice(-6)})`:(first||last),last_name:unnamed?null:(first?last||null:null),
  email,phone:e164(phone)??(r['Phone Number']?.replace(/^'/,'')||null),phone2:null,tags:new Set(),square_customer_id:sqId||null,
  email_opt_out:['unsubscribed','bounced'].includes((r['Email Subscription Status']||'').toLowerCase()),
  square_history:{first_visit:r['First Visit']||null,last_visit:r['Last Visit']||null,transaction_count:Number(r['Transaction Count']||0),lifetime_spend_cents:dollarsToCents(r['Lifetime Spend'])??0,total_spend_cents:dollarsToCents(r['Total Spend'])??0,creation_source:r['Creation Source']||null},
  _phone:phone,_phone2:null,source:'square'};
 c.name=[c.first_name,c.last_name].filter(Boolean).join(' ');
 customers.push(c);index(c);
}

// ---------------- 3. Moves ----------------
const jobs=[],stops=[],notes=[];const DAYS=['SUN','MON','TUE','WED','THU','FRI','SAT'];
for(const r of moveRows){
 const ref={row:r._row,name:r.NAME,date:r.DATE};
 const date=excelDate(r.DATE);if(!date){review.noDate.push({...ref,phone:r.PHONE,notes:r.NOTES});continue}
 const day=DAYS[new Date(date+'T12:00:00Z').getUTCDay()];if(r.DAY&&!String(r.DAY).toUpperCase().includes(day))review.dayMismatch.push({...ref,date,sheet_day:r.DAY,actual_day:day});
 if(date>new Date(Date.parse(TODAY)+400*86400000).toISOString().slice(0,10))review.farFuture.push({...ref,date});
 // customer: phone, then email, else new
 const ph=phonesIn(r.PHONE);const em=emailOrNull(r.EMAIL);
 let c=ph.map(d=>byPhone.get(d)).find(Boolean)??(em?byEmail.get(em):undefined);
 if(!c){const nm=splitName(r.NAME);c={id:randomUUID(),first_name:nm.first||'Unnamed (old move list)',last_name:nm.last,email:em,phone:e164(ph[0]??null),phone2:e164(ph[1]??null),tags:new Set(),square_customer_id:null,email_opt_out:false,square_history:null,_phone:ph[0]??null,_phone2:ph[1]??null,source:'moves'};
  c.name=[c.first_name,c.last_name].filter(Boolean).join(' ');customers.push(c);index(c);review.newCustomersFromMoves.push({...ref,phones:ph.map(e164).join(' '),email:em})}
 else{ // fill gaps on the matched customer without overwriting anything
  for(const d of ph){if(d!==c._phone&&d!==c._phone2){if(!c._phone){c._phone=d;c.phone=e164(d)}else if(!c._phone2){c._phone2=d;c.phone2=e164(d)}byPhone.set(d,c)}}
  if(!c.email&&em){c.email=em;byEmail.set(em,c)}}
 const n=parseNotes(r.NOTES);for(const t of n.tags)c.tags.add(t);
 const price=parsePrice(r.PRICE);const win=parseWindow(r.TIME);
 if(!win.ok)review.timeUnusual.push({...ref,date,time:r.TIME});
 const pu=parseLocation(r['P/U']),dov=parseLocation(r['D/O']);
 if(!pu.ok)review.locationUnusual.push({...ref,date,column:'P/U',code:r['P/U']});if(!dov.ok)review.locationUnusual.push({...ref,date,column:'D/O',code:r['D/O']});
 const status=n.cancelled||/cancel/i.test(r.EMAIL??'')?'cancelled':date>TODAY?'booked':'completed';
 if(n.cancelCheck)review.cancelCheck.push({...ref,date,imported_as:status,notes:r.NOTES});
 const importNotes=[];
 let pricing;
 if(price.kind==='flat')pricing={pricing_model:'flat',crew_size:price.crew,hourly_rate_cents:null,flat_rate_cents:price.flat,service_charge_cents:0,quoted_total_cents:price.flat,deposit_required_cents:price.deposit};
 else if(price.kind==='hourly')pricing={pricing_model:'hourly',crew_size:price.crew,hourly_rate_cents:price.hourly,flat_rate_cents:null,service_charge_cents:price.service,quoted_total_cents:null,deposit_required_cents:price.deposit};
 else{pricing={pricing_model:'flat',crew_size:2,hourly_rate_cents:null,flat_rate_cents:0,service_charge_cents:0,quoted_total_cents:null,deposit_required_cents:0};importNotes.push(`Price unknown in the old spreadsheet ("${String(r.PRICE??'').slice(0,60)}")`);review.priceUnknown.push({...ref,date,price:r.PRICE})}
 if(price.extra)importNotes.push(`Price note: ${price.extra}`);if(price.unusual){importNotes.push(`Unusual price format: ${r.PRICE}`);review.priceUnusual.push({...ref,date,price:r.PRICE})}
 const pick=String(r['PICK-UP']??'').trim().slice(0,300),drop=String(r['DROP OFF']??'').trim().slice(0,300);
 if(!pick||!drop)review.missingAddress.push({...ref,date});
 const job={id:randomUUID(),customer_id:c.id,customer_name:String(r.NAME||c.name).trim()||c.name,move_date:date,arrival_time:win.start,arrival_window_end:win.end,
  pick_up_address:pick||'(not recorded)',drop_off_address:drop||'(not recorded)',move_type:pu.commercial||dov.commercial?'commercial':'residential',status,...pricing,
  service_type:n.service,truck_needed:n.truck,import_note:importNotes.join(' · ')||null};
 jobs.push(job);
 stops.push({job_id:job.id,position:1,kind:'pickup',address:job.pick_up_address,location_type:pu.location_type,bedrooms:pu.bedrooms,access_notes:pu.extra||null});
 stops.push({job_id:job.id,position:2,kind:'dropoff',address:job.drop_off_address,location_type:dov.location_type,bedrooms:dov.bedrooms,access_notes:dov.extra||null});
 if(String(r.NOTES??'').trim())notes.push({job_id:job.id,notes:`Old move list note: ${String(r.NOTES).trim()}`});
}
for(const c of customers){c.needs_contact_info=!c.phone&&!c.email;c.tags=[...c.tags].sort()}

// ---------------- 4. Write into a database ----------------
async function insertRows(db,table,cols,rows,map){
 for(let i=0;i<rows.length;i+=200){const chunk=rows.slice(i,i+200);const params=[];
  const values=chunk.map(r=>`(${map(r).map(v=>{params.push(v);return '$'+params.length}).join(',')})`).join(',');
  await db.query(`INSERT INTO public.${table}(${cols.join(',')}) VALUES ${values}`,params)}
}
async function load(db){
 const co=(await db.query("SELECT id FROM public.companies WHERE slug='the-movers'")).rows[0]?.id;if(!co)throw Error('The Movers company not found in this database');
 const already=(await db.query('SELECT count(*)::int n FROM public.customers WHERE company_id=$1 AND square_customer_id IS NOT NULL',[co])).rows[0].n;
 if(already>0)throw Error(`This database already has ${already} imported Square customers. Not importing twice.`);
 await insertRows(db,'customers',['id','company_id','name','first_name','last_name','email','phone','phone2','tags','square_customer_id','email_opt_out','square_history','needs_contact_info','import_batch_id'],customers,
  c=>[c.id,co,c.name,c.first_name,c.last_name,c.email,c.phone,c.phone2,c.tags,c.square_customer_id,c.email_opt_out,c.square_history?JSON.stringify(c.square_history):null,c.needs_contact_info,batch]);
 await insertRows(db,'jobs',['id','company_id','customer_id','customer_name','move_date','arrival_time','arrival_window_end','pick_up_address','drop_off_address','move_type','status','crew_size','pricing_model','hourly_rate_cents','flat_rate_cents','service_charge_cents','quoted_total_cents','deposit_required_cents','service_type','truck_needed','import_note','import_batch_id'],jobs,
  j=>[j.id,co,j.customer_id,j.customer_name,j.move_date,j.arrival_time,j.arrival_window_end,j.pick_up_address,j.drop_off_address,j.move_type,j.status,j.crew_size,j.pricing_model,j.hourly_rate_cents,j.flat_rate_cents,j.service_charge_cents,j.quoted_total_cents,j.deposit_required_cents,j.service_type,j.truck_needed,j.import_note,batch]);
 await insertRows(db,'job_stops',['company_id','job_id','position','kind','address','location_type','bedrooms','access_notes'],stops,s=>[co,s.job_id,s.position,s.kind,s.address,s.location_type,s.bedrooms,s.access_notes]);
 await insertRows(db,'job_office_notes',['company_id','job_id','notes'],notes,n=>[co,n.job_id,n.notes]);
 const q=async sql=>(await db.query(sql,[batch])).rows[0];
 return {customers:await q('SELECT count(*)::int n FROM public.customers WHERE import_batch_id=$1'),jobs:await q('SELECT count(*)::int n, count(*) FILTER (WHERE status=\'completed\')::int completed, count(*) FILTER (WHERE status=\'booked\')::int booked, count(*) FILTER (WHERE status=\'cancelled\')::int cancelled FROM public.jobs WHERE import_batch_id=$1'),
  stops:await q('SELECT count(*)::int n FROM public.job_stops s JOIN public.jobs j ON j.id=s.job_id WHERE j.import_batch_id=$1'),
  phones:await q("SELECT count(*) FILTER (WHERE phone ~ '^\\+1[0-9]{10}$')::int e164, count(*) FILTER (WHERE phone IS NOT NULL AND phone !~ '^\\+1[0-9]{10}$')::int other FROM public.customers WHERE import_batch_id=$1")};
}
async function memoryDb(){
 const here=dirname(fileURLToPath(import.meta.url));const root=join(here,'..','..');
 const {PGlite}=await import(new URL('file:///'+join(root,'tests','database','node_modules','@electric-sql','pglite','dist','index.js').replace(/\\/g,'/')).href);
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text UNIQUE,email_confirmed_at timestamptz,invited_at timestamptz,encrypted_password text,last_sign_in_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth,storage TO authenticated,anon;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;`);
 const mig=join(root,'supabase','migrations');for(const f of readdirSync(mig).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(join(mig,f),'utf8'));
 return db;
}

// ---------------- 5. Review report (outside the repository) ----------------
function writeReview(result,mode){
 mkdirSync(args.out,{recursive:true});
 const csv=rows=>{if(!rows.length)return 'nothing to review\n';const cols=[...new Set(rows.flatMap(r=>Object.keys(r)))];const esc=v=>{const s=String(v??'');return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};return [cols.join(','),...rows.map(r=>cols.map(c=>esc(r[c])).join(','))].join('\n')+'\n'};
 const files={'1_moves_left_out_no_date.csv':review.noDate,'2_prices_unknown.csv':review.priceUnknown,'3_prices_unusual.csv':review.priceUnusual,'4_new_customers_from_moves.csv':review.newCustomersFromMoves,
  '5_possible_duplicate_customers.csv':review.possibleDuplicates,'6_times_not_understood.csv':review.timeUnusual,'7_location_codes_not_understood.csv':review.locationUnusual,'8_day_does_not_match_date.csv':review.dayMismatch,
  '9_dates_far_in_future.csv':review.farFuture,'10_missing_addresses.csv':review.missingAddress,'11_cancellations_to_check.csv':review.cancelCheck};
 for(const [f,rows] of Object.entries(files))writeFileSync(join(args.out,f),csv(rows));
 const sq=customers.filter(c=>c.source==='square');
 const summary=[`The Movers import ${mode} - ${new Date().toISOString()}`,`Import batch id: ${batch}`,'',
  `Square customers read: ${squareRows.length}   imported: ${sq.length}`,
  `   without phone or email (flagged "needs contact info"): ${customers.filter(c=>c.needs_contact_info).length}`,
  `   email marketing blocked (unsubscribed/bounced): ${customers.filter(c=>c.email_opt_out).length}`,
  `Move rows read: ${moveRows.length}   imported: ${jobs.length}   left out (no real date): ${review.noDate.length}`,
  `   completed: ${jobs.filter(j=>j.status==='completed').length}   booked (future): ${jobs.filter(j=>j.status==='booked').length}   cancelled: ${jobs.filter(j=>j.status==='cancelled').length}`,
  `   linked to a Square customer: ${jobs.length-review.newCustomersFromMoves.length}   new customers created from moves: ${review.newCustomersFromMoves.length}`,
  `   hourly prices: ${jobs.filter(j=>j.pricing_model==='hourly').length}   flat prices: ${jobs.filter(j=>j.pricing_model==='flat'&&!j.import_note?.startsWith('Price unknown')).length}   price unknown: ${review.priceUnknown.length}`,
  `   service types: ${Object.entries(jobs.reduce((a,j)=>(a[j.service_type]=(a[j.service_type]||0)+1,a),{})).map(([k,v])=>k+' '+v).join(', ')}   no truck: ${jobs.filter(j=>!j.truck_needed).length}`,
  `Tags from notes: repeat ${customers.filter(c=>c.tags.includes('repeat')).length}, VIP ${customers.filter(c=>c.tags.includes('vip')).length}`,
  `Possible duplicate customers to review: ${review.possibleDuplicates.length}`,`Mixed cancel/redo notes to check: ${review.cancelCheck.length}`,'',
  'Database check after import:',JSON.stringify(result,null,1),'',
  'Review files in this folder (open with Excel): 1_ ... 11_. Nothing in them is deleted; they list rows to check.'].join('\n');
 writeFileSync(join(args.out,'0_SUMMARY.txt'),summary+'\n');
 return summary;
}

// ---------------- 6. Run ----------------
if(args['dry-run']){
 const db=await memoryDb();await db.exec('BEGIN');const result=await load(db);await db.exec('COMMIT');
 const s=writeReview(result,'DRY RUN (private copy, nothing imported)');
 // Counts only to the console: no customer details.
 console.log(s.split('\n').filter(l=>!l.startsWith('Import batch')).join('\n'));
}else{
 if(!process.env.DATABASE_URL){console.error('Set DATABASE_URL in this PowerShell window first (see instructions).');process.exit(2)}
 const {default:pg}=await import('pg');const client=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
 await client.connect();
 try{await client.query('BEGIN');const result=await load(client);await client.query('COMMIT');const s=writeReview(result,'COMMITTED to the database');console.log(s);console.log(`\nTo undo this whole import later (only if nothing was done with it yet): SELECT public.undo_import('${batch}');`)}
 catch(e){await client.query('ROLLBACK').catch(()=>{});console.error('Import failed and was rolled back. Nothing was imported.\n'+e.message);process.exitCode=1}
 finally{await client.end()}
}
