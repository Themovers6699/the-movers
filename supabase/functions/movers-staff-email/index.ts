import {createClient} from 'npm:@supabase/supabase-js@2.119.0';

// Office staff change a staff member's LOGIN email (owner decision: owner and office admins may do this).
// The owner's email can never be changed here. The change takes effect immediately and is written to the
// audit log with the office user who made it.

const env=(name:string)=>Deno.env.get(name)??'';
function platformKey(kind:'public'|'secret'){
 const raw=env(kind==='public'?'SUPABASE_PUBLISHABLE_KEYS':'SUPABASE_SECRET_KEYS');
 if(raw){try{const keys=JSON.parse(raw);if(keys.default)return keys.default;}catch{}}
 return env(kind==='public'?'SUPABASE_ANON_KEY':'SUPABASE_SERVICE_ROLE_KEY');
}
function allowed(origin:string){return origin==='https://app.themoverz.com'||origin==='https://the-movers-login-dev.vercel.app'||/^https:\/\/the-movers-login-[a-z0-9]+-the-movers\.vercel\.app$/.test(origin)}
const uuid=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const emailOk=(x:string)=>x.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x);

export async function handler(req:Request){
 const origin=req.headers.get('origin')??'';
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(origin&&allowed(origin))headers['Access-Control-Allow-Origin']=origin;
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!allowed(origin))return reply({error:'Origin not allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'POST required'},405);
 const auth=req.headers.get('authorization')??'';
 if(!auth.startsWith('Bearer '))return reply({error:'Sign in first'},401);
 try{
  const url=env('SUPABASE_URL'),publicKey=platformKey('public'),secretKey=platformKey('secret');
  if(!url||!publicKey||!secretKey)return reply({error:'Server environment is incomplete'},503);
  const raw=await req.text();if(raw.length>2048)return reply({error:'Request too large'},413);
  let data;try{data=JSON.parse(raw)}catch{return reply({error:'Invalid request'},400)}
  const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
  if(!uuid(data.company_id)||!uuid(data.user_id))return reply({error:'Invalid company or staff member'},400);
  if(!emailOk(email))return reply({error:'Enter a valid email address'},400);

  const userClient=createClient(url,publicKey,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const verified=await userClient.auth.getUser(auth.slice(7));
  if(verified.error||!verified.data.user)return reply({error:'Your login expired. Sign in again.'},401);
  const me=await userClient.from('company_members').select('role,active').eq('company_id',data.company_id).eq('user_id',verified.data.user.id).single();
  if(me.error||!me.data?.active||!['owner','office_admin'].includes(me.data.role))return reply({error:'Office access required'},403);

  const admin=createClient(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const target=await admin.from('company_members').select('role').eq('company_id',data.company_id).eq('user_id',data.user_id).single();
  if(target.error||!target.data)return reply({error:'Staff member not found in this company'},404);
  if(target.data.role==='owner')return reply({error:'The owner\'s login email cannot be changed here'},403);

  const current=await admin.auth.admin.getUserById(data.user_id);
  if(current.error||!current.data?.user)return reply({error:'Could not load this login. Try again.'},503);
  const oldEmail=(current.data.user.email??'').toLowerCase();
  if(oldEmail===email)return reply({ok:true,changed:false,note:'The email is unchanged.'});

  const updated=await admin.auth.admin.updateUserById(data.user_id,{email,email_confirm:true});
  if(updated.error){
   const taken=/already|exists|registered/i.test(updated.error.message??'');
   return reply({error:taken?'Another login already uses this email.':'The email could not be changed: '+updated.error.message},taken?409:502);
  }
  const logged=await admin.rpc('record_staff_email_change',{target_company:data.company_id,target_user:data.user_id,changed_by:verified.data.user.id,old_email:oldEmail,new_email:email});
  return reply({ok:true,changed:true,audit_saved:!logged.error,note:'Login email changed. They now sign in with '+email+'; their password is unchanged.'});
 }catch{return reply({error:'Could not change the email. Check Edge Function logs.'},500)}
}
Deno.serve(handler);
