import {createClient} from 'npm:@supabase/supabase-js@2.119.0';

// Office staff invite a person by email. Supabase sends the invite (through the project's custom SMTP);
// the person opens the link and chooses their own password. Access is granted by
// register_invited_member() using the OFFICE USER'S session, so the database enforces permissions
// and the audit log records who granted access.

const env=(name:string)=>Deno.env.get(name)??'';
function platformKey(kind:'public'|'secret'){
 const raw=env(kind==='public'?'SUPABASE_PUBLISHABLE_KEYS':'SUPABASE_SECRET_KEYS');
 if(raw){try{const keys=JSON.parse(raw);if(keys.default)return keys.default;}catch{}}
 return env(kind==='public'?'SUPABASE_ANON_KEY':'SUPABASE_SERVICE_ROLE_KEY');
}
const MAIN_SITE='https://the-movers-login-dev.vercel.app';
function allowed(origin:string){return origin==='https://app.themoverz.com'||origin===MAIN_SITE||/^https:\/\/the-movers-login-[a-z0-9]+-the-movers\.vercel\.app$/.test(origin)}
// Invite links must land on an address listed in Supabase Auth Redirect URLs: the main site, or app.themoverz.com later.
const siteFor=(origin:string)=>origin==='https://app.themoverz.com'?origin+'/':(env('APP_SITE_URL')||MAIN_SITE+'/');
const uuid=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const emailOk=(x:unknown)=>typeof x==='string'&&x.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x.trim());
const ROLES=['office_admin','crew_leader','mover'];

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
  const raw=await req.text();if(raw.length>4096)return reply({error:'Request too large'},413);
  let data;try{data=JSON.parse(raw)}catch{return reply({error:'Invalid request'},400)}
  const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
  const name=typeof data.name==='string'?data.name.trim():'';
  if(!uuid(data.company_id))return reply({error:'Invalid company'},400);
  if(!emailOk(email))return reply({error:'Enter a valid email address'},400);
  if(name.length<1||name.length>150)return reply({error:'Enter the person\'s name'},400);
  if(!ROLES.includes(data.role))return reply({error:'Invite as office admin, crew leader or mover'},400);

  const userClient=createClient(url,publicKey,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
  const verified=await userClient.auth.getUser(auth.slice(7));
  if(verified.error||!verified.data.user)return reply({error:'Your login expired. Sign in again.'},401);
  if(verified.data.user.email?.toLowerCase()===email)return reply({error:'You cannot invite yourself'},400);
  const membership=await userClient.from('company_members').select('role,active').eq('company_id',data.company_id).eq('user_id',verified.data.user.id).single();
  if(membership.error||!membership.data?.active||!['owner','office_admin'].includes(membership.data.role))return reply({error:'Office access required'},403);

  const admin=createClient(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const lookup=await admin.rpc('staff_invite_lookup',{member_email:email});
  if(lookup.error)return reply({error:'Could not check this email. Try again.'},503);
  const existing=(lookup.data??[])[0] as {user_id:string;confirmed:boolean;has_membership:boolean;has_password?:boolean}|undefined;

  let userId:string,invited=false,needsPassword=false;
  if(existing?.confirmed){
   userId=existing.user_id;
   // Confirmed but no password = an invite link was opened but "choose your password" never finished.
   needsPassword=existing.has_password===false;
  }else{
   if(existing&&!existing.has_membership){
    // An unfinished self sign-up nobody confirmed. Remove it so a stranger who signed up with this
    // email first cannot end up owning the account; the real person gets a fresh invite.
    const removed=await admin.auth.admin.deleteUser(existing.user_id);
    if(removed.error)return reply({error:'Could not clear an unfinished sign-up for this email. Try again.'},502);
   }
   // New person, or a pending invite being re-sent.
   const sent=await admin.auth.admin.inviteUserByEmail(email,{redirectTo:siteFor(origin),data:{display_name:name}});
   if(sent.error||!sent.data?.user?.id)return reply({error:'The invite email could not be sent: '+(sent.error?.message??'unknown error')},502);
   userId=sent.data.user.id;invited=true;
  }

  const registered=await userClient.rpc('register_invited_member',{target_company:data.company_id,invited_user:userId,member_name:name,member_role:data.role});
  if(registered.error)return reply({error:registered.error.message,invited},400);
  if(needsPassword){
   const anon=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
   const reset=await anon.auth.resetPasswordForEmail(email,{redirectTo:siteFor(origin)});
   if(reset.error)return reply({error:'Access is set up, but the set-password email could not be sent: '+reset.error.message,invited:false},502);
   return reply({ok:true,invited:false,password_email:true,user_id:userId,note:'Set-password email sent.'});
  }
  return reply({ok:true,invited,user_id:userId,note:invited?'Invite email sent.':'This person already had a login; access granted.'});
 }catch{return reply({error:'Could not complete the invite. Check Edge Function logs.'},500)}
}
Deno.serve(handler);
