import {useEffect,useRef,useState} from 'react';
import {supabase} from './supabase';
import {errorText} from './access';
import {fitWithin} from './crew';

type Photo={id:string;object_path:string;category:string;caption:string|null;created_at:string;url?:string};
const CATEGORIES:[string,string][]=[['before','Before'],['after','After'],['damage','Damage'],['other','Other']];

/** Shrink a phone photo to max 1600 px JPEG before upload (faster on mobile data, smaller storage). */
async function compress(file:File):Promise<Blob>{
 const bmp=await createImageBitmap(file);const {width,height}=fitWithin(bmp.width,bmp.height);
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 canvas.getContext('2d')!.drawImage(bmp,0,0,width,height);bmp.close?.();
 return await new Promise((ok,fail)=>canvas.toBlob(b=>b?ok(b):fail(Error('Could not process the photo')),'image/jpeg',0.82));
}

// Private job photos: assigned crew and office can view; crew leaders and movers can add (owner decision).
export default function JobPhotos({companyId,jobId,userId,canAdd=true}:{companyId:string;jobId:string;userId:string;canAdd?:boolean}){
 const [photos,setPhotos]=useState<Photo[]>([]),[category,setCategory]=useState('before'),[busy,setBusy]=useState(''),[error,setError]=useState(''),[revision,setRevision]=useState(0),[open,setOpen]=useState<Photo|null>(null);
 const input=useRef<HTMLInputElement|null>(null);
 useEffect(()=>{let live=true;(async()=>{try{
  const r=await supabase.from('job_photos').select('id,object_path,category,caption,created_at').eq('company_id',companyId).eq('job_id',jobId).order('created_at',{ascending:false});
  if(r.error)throw r.error;const rows=(r.data??[]) as Photo[];
  if(rows.length){const s=await supabase.storage.from('job-photos').createSignedUrls(rows.map(p=>p.object_path),3600);if(s.error)throw s.error;const urls=new Map((s.data??[]).map(x=>[x.path,x.signedUrl]));rows.forEach(p=>p.url=urls.get(p.object_path)??undefined)}
  if(live)setPhotos(rows)}catch(e){if(live)setError(errorText(e,'Could not load photos.'))}})();return()=>{live=false}},[companyId,jobId,revision]);

 async function upload(files:FileList|null){if(!files?.length)return;setError('');
  for(const [i,file] of [...files].entries()){
   setBusy(`Uploading ${i+1} of ${files.length}…`);
   try{const blob=await compress(file);const path=`${companyId}/${jobId}/${userId}/${crypto.randomUUID()}.jpg`;
    const up=await supabase.storage.from('job-photos').upload(path,blob,{contentType:'image/jpeg',upsert:false});if(up.error)throw up.error;
    const row=await supabase.from('job_photos').insert({company_id:companyId,job_id:jobId,object_path:path,category});if(row.error)throw row.error}
   catch(e){setError(errorText(e,'A photo could not be uploaded. Check your signal and try again.'));break}}
  setBusy('');if(input.current)input.current.value='';setRevision(n=>n+1)}

 const label=(c:string)=>CATEGORIES.find(x=>x[0]===c)?.[1]??c;
 return <section className="panel"><div className="sectionheading"><h2>Photos ({photos.length})</h2></div>
  {canAdd&&<div className="photoadd">
   <div className="miniswitch" role="group" aria-label="Photo type">{CATEGORIES.map(([v,l])=><button type="button" key={v} className="yes" aria-pressed={category===v} onClick={()=>setCategory(v)}>{l}</button>)}</div>
   <label className="primary camerabtn">📷 {busy||'Take or add photos'}<input ref={input} type="file" accept="image/*" capture="environment" multiple hidden disabled={!!busy} onChange={e=>upload(e.target.files)}/></label>
  </div>}
  {error&&<p role="alert" className="error">{error}</p>}
  {photos.length?<div className="photogrid">{photos.map(p=><button type="button" key={p.id} className="photothumb" onClick={()=>setOpen(p)}>{p.url?<img src={p.url} alt={`${label(p.category)} photo`} loading="lazy"/>:<span>Photo</span>}<span className={'phototag tag-'+p.category}>{label(p.category)}</span></button>)}</div>:<p className="muted">No photos yet.{canAdd?' Take "before" photos of furniture and walls when you arrive.':''}</p>}
  {open&&<div className="photoviewer" role="dialog" aria-label="Photo" onClick={()=>setOpen(null)}>{open.url&&<img src={open.url} alt="Job photo"/>}<p>{label(open.category)} · {new Date(open.created_at).toLocaleString()}</p><button type="button" className="secondary">Close</button></div>}
 </section>;
}
