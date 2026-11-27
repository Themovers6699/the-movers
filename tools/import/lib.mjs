// Readers and conversion rules for the one-time import. No customer data lives in this repository:
// the program reads the owner's files from disk and writes its review report next to them.
import {readFileSync} from 'node:fs';
import {inflateRawSync} from 'node:zlib';

// ---------- CSV (RFC 4180: quotes, escaped quotes, commas/newlines inside quotes) ----------
export function parseCsv(text){
 text=text.replace(/^﻿/,'');const rows=[];let row=[],field='',q=false;
 for(let i=0;i<text.length;i++){const ch=text[i];
  if(q){if(ch==='"'){if(text[i+1]==='"'){field+='"';i++}else q=false}else field+=ch}
  else if(ch==='"')q=true;else if(ch===','){row.push(field);field=''}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field=''}
  else field+=ch}
 if(field!==''||row.length){row.push(field);rows.push(row)}
 const [head,...body]=rows.filter(r=>r.some(c=>c!==''));
 return body.map(r=>Object.fromEntries(head.map((h,i)=>[h.trim(),(r[i]??'').trim()])));
}

// ---------- XLSX (zip + XML), first sheet, enough for a plain data sheet ----------
function unzip(buf){
 const files={};let eocd=-1;for(let i=buf.length-22;i>=0;i--)if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break}
 if(eocd<0)throw Error('Not a valid .xlsx (zip) file');
 let p=buf.readUInt32LE(eocd+16);const n=buf.readUInt16LE(eocd+10);
 for(let k=0;k<n;k++){const method=buf.readUInt16LE(p+10),csize=buf.readUInt32LE(p+20),nlen=buf.readUInt16LE(p+28),xlen=buf.readUInt16LE(p+30),clen=buf.readUInt16LE(p+32),off=buf.readUInt32LE(p+42);
  const name=buf.toString('utf8',p+46,p+46+nlen);const ln=buf.readUInt16LE(off+26),lx=buf.readUInt16LE(off+28);const data=buf.subarray(off+30+ln+lx,off+30+ln+lx+csize);
  files[name]=method===0?data:inflateRawSync(data);p+=46+nlen+xlen+clen}
 return files;
}
const unxml=s=>s.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi,(m,e)=>e==='amp'?'&':e==='lt'?'<':e==='gt'?'>':e==='quot'?'"':e==='apos'?"'":String.fromCodePoint(e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):parseInt(e.slice(1),10)));
const textOf=xml=>[...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>unxml(m[1])).join('');
export function readXlsx(path){
 const f=unzip(readFileSync(path));
 const shared=f['xl/sharedStrings.xml']?[...f['xl/sharedStrings.xml'].toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m=>textOf(m[1])):[];
 const sheetName=Object.keys(f).filter(k=>/^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
 const xml=f[sheetName].toString('utf8');const grid=[];
 for(const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)){const row={};
  for(const cm of rm[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){const attrs=cm[1],body=cm[2]??'';const ref=/r="([A-Z]+)\d+"/.exec(attrs)?.[1];if(!ref)continue;
   const type=/t="([^"]+)"/.exec(attrs)?.[1];const v=/<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
   row[ref]=type==='s'?shared[Number(v)]:type==='inlineStr'?textOf(body):v!==undefined?unxml(v):''}
  grid.push(row)}
 const [head,...body]=grid;const cols=Object.keys(head);
 return body.filter(r=>Object.values(r).some(v=>String(v??'').trim()!=='')).map((r,i)=>({_row:i+2,...Object.fromEntries(cols.map(c=>[String(head[c]).trim(),String(r[c]??'').trim()]))}));
}

// ---------- Field rules ----------
/** Ten US digits or null (same rule as the database's normalize_us_phone). */
export function usDigits(s){let d=String(s??'').replace(/\D/g,'');if(d.length===11&&d.startsWith('1'))d=d.slice(1);return /^[2-9]\d{2}[2-9]\d{6}$/.test(d)?d:null}
export const e164=d=>d?'+1'+d:null;
/** All phone numbers in a text like "469-555-0100 214-555-0101". */
export function phonesIn(s){const found=[];for(const m of String(s??'').matchAll(/\+?1?[\s.(-]*\d{3}[\s.)-]*\d{3}[\s.-]*\d{4}/g)){const d=usDigits(m[0]);if(d&&!found.includes(d))found.push(d)}return found}
export const emailOrNull=s=>{const e=String(s??'').trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)?e:null};
export const dollarsToCents=s=>{const n=Number(String(s??'').replace(/[$,\s]/g,''));return Number.isFinite(n)?Math.round(n*100):null};

/** Excel serial day → YYYY-MM-DD (Excel's 1900 system; serial 25569 = 1970-01-01). */
export function excelDate(v){const n=Number(v);if(!Number.isFinite(n)||n<20000||n>80000)return null;const d=new Date(Math.round((n-25569)*86400000));return d.toISOString().slice(0,10)}

/** "8-9AM", "12-2PM", "11AM-1PM", "9AM", "9:30AM", "OPEN" → {start,end} in HH:MM 24h, or null. */
export function parseWindow(s){
 const t=String(s??'').toUpperCase().replace(/\s+/g,'');if(!t||t==='OPEN'||t==='-'||t==='TBD')return {start:null,end:null,ok:true};
 const to24=(h,m,ap)=>{let x=Number(h)%12;if(ap==='PM')x+=12;return x*60+Number(m||0)};
 const fmt=min=>`${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`;
 let m=/^(\d{1,2})(?::(\d{2}))?(AM|PM)?-(\d{1,2})(?::(\d{2}))?(AM|PM)$/.exec(t);
 if(m){const e=to24(m[4],m[5],m[6]);let s=to24(m[1],m[2],m[3]??m[6]);if(!m[3]&&s>=e)s=to24(m[1],m[2],m[6]==='PM'?'AM':'PM');if(s>=e)return {start:null,end:null,ok:false};return {start:fmt(s),end:fmt(e),ok:true}}
 m=/^(\d{1,2})(?::(\d{2}))?(AM|PM)$/.exec(t);if(m)return {start:fmt(to24(m[1],m[2],m[3])),end:null,ok:true};
 return {start:null,end:null,ok:false};
}

/** PRICE column, as used in the old spreadsheet:
 *   hourly: "crew / hourly / service / deposit"  (deposit may be NONE, "?" or missing; text after = note, e.g. "+ 10% off")
 *   flat:   "crew / price FLAT / deposit"         (price may be a range "900-1000" -> lower bound + note; extras like
 *           "+ 300 PIANO" between FLAT and the deposit -> note; deposit may be NONE, a %, or "?")
 *   anything else -> unknown (imported with a $0 flat price and a clear note, listed for review). */
export function parsePrice(s){
 const raw=String(s??'').trim();const t=raw.toUpperCase().replace(/\s+/g,' ');const N='(\\d+(?:\\.\\d+)?)';const c=v=>Math.round(Number(v)*100);
 let m=new RegExp(`^(\\d+) ?/ ?${N}(?: ?- ?${N})? ?FLAT(.*?)(?:/ ?(${N.slice(1,-1)}%?|NONE|\\?+))? ?$`).exec(t);
 if(m){const crew=Number(m[1]);if(crew<1||crew>30)return {kind:'unknown',raw};
  const flat=c(m[2]);const notes=[];if(m[3])notes.push(`price range ${m[2]}-${m[3]}`);
  const mid=(m[4]??'').trim();if(mid)notes.push(mid.replace(/^\+\s*/,'+ '));
  let dep=0,unusual=!!m[3];const d=m[5];
  if(d&&d!=='NONE'&&!/^\?+$/.test(d))dep=d.endsWith('%')?Math.round(flat*Number(d.slice(0,-1))/100):c(d);
  if(d&&/^\?+$/.test(d)){unusual=true;notes.push('deposit unknown')}
  return {kind:'flat',crew,flat,deposit:dep,extra:notes.join('; '),unusual}}
 m=new RegExp(`^(\\d+) ?/ ?${N} ?/ ?${N} ?(\\?+)? ?(?:/ ?(${N.slice(1,-1)}|NONE|\\?+) ?(\\?+)?)? ?(.*)$`).exec(t);
 if(m){const crew=Number(m[1]);if(crew<1||crew>30)return {kind:'unknown',raw};
  const d=m[5];const extra=(m[7]??'').replace(/^[/+]\s*/,'+ ').trim();
  const unusual=!!(m[4]||m[6]||(d&&/^\?+$/.test(d)));
  return {kind:'hourly',crew,hourly:c(m[2]),service:c(m[3]),deposit:d&&/^\d/.test(d)?c(d):0,extra:[extra,unusual?'some values marked "?" in the old list':''].filter(Boolean).join('; '),unusual}}
 m=new RegExp(`^(\\d+) ?/ ?${N} ?/ ?NONE ?(.*)$`).exec(t);
 if(m){const crew=Number(m[1]);return crew>=1&&crew<=30?{kind:'hourly',crew,hourly:c(m[2]),service:null,deposit:0,extra:(m[3]??'').trim(),unusual:true}:{kind:'unknown',raw}}
 return {kind:'unknown',raw};
}
/** P/U and D/O codes (owner confirmed 2026-11-24). First code = location; any further codes go into notes. */
const CODE=/^(\d{1,2})?(APT|B|HS|H|TH|STR|WH|OFC|RET)$/;
export function parseLocation(code){
 const parts=String(code??'').toUpperCase().trim().split(/\s+/).filter(p=>p&&p!=='-');
 if(!parts.length)return {location_type:null,bedrooms:null,extra:'',commercial:false,ok:true};
 const one=p=>{const m=CODE.exec(p);if(!m)return null;const n=m[1]?Number(m[1]):null;
  const type={APT:'apartment',B:'house',HS:'house',H:'house',TH:'townhouse',STR:'storage',WH:'warehouse',OFC:'office',RET:'retail'}[m[2]];
  return {location_type:type,bedrooms:m[2]==='B'||m[2]==='APT'||m[2]==='TH'||m[2]==='HS'||m[2]==='H'?(n!==null&&n<=10?n:null):null,code:p}};
 const first=one(parts[0]);const rest=parts.slice(1).map(p=>one(p)?.location_type?.replace('_',' ')??p);
 if(!first)return {location_type:null,bedrooms:null,extra:`Old code: ${parts.join(' ')}`,commercial:false,ok:false};
 return {location_type:first.location_type,bedrooms:first.bedrooms,extra:rest.length?`Also: ${rest.join(', ')}`:'',commercial:['office','warehouse','retail'].includes(first.location_type),ok:true};
}

/** NOTES → service type, truck needed, tags, cancelled. */
export function parseNotes(s){
 const n=String(s??'').toLowerCase();
 const service=/unload\s*only/.test(n)?'unload_only':/load\s*only/.test(n)?'load_only':/pack\s*only/.test(n)?'pack_only':/same\s*complex/.test(n)?'same_complex':'full_move';
 const truck=/no\s*truck/.test(n)?false:true;
 const tags=[];if(/repeat/.test(n))tags.push('repeat');if(/\bvip\b/.test(n))tags.push('vip');
 // Cancellations: "cancelled 11/14" = cancelled. Mixed notes ("cancelled 5/2, re-did 5/9") follow whichever happened
 // LAST; policy wording ("cancel w/in 3 days of non-payment") is not a cancellation. Mixed ones are flagged for review.
 const withoutPolicy=n.replace(/cancel\w*\s*(w\/\s*in|within)/g,'');
 const mentions=/cancel/.test(withoutPolicy);
 const redo=/re-?did|resched\w*|then paid|then changed|changed from|paid\s+\d/g;
 let lastRedo=-1;for(const m of withoutPolicy.matchAll(redo))lastRedo=m.index;
 const lastCancel=withoutPolicy.lastIndexOf('cancel');
 const mixed=mentions&&lastRedo>=0;
 return {service,truck,tags,cancelled:mentions&&!(mixed&&lastRedo>lastCancel),cancelCheck:mixed};
}

/** "Maria de la Cruz" → first "Maria de la", last "Cruz" (same rule as the database). */
export function splitName(s){const n=String(s??'').trim().replace(/\s+/g,' ');if(!n)return {first:'',last:null};const i=n.lastIndexOf(' ');return i<0?{first:n,last:null}:{first:n.slice(0,i),last:n.slice(i+1)}}
