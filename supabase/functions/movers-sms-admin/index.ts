import {createClient} from 'npm:@supabase/supabase-js@2.119.0';

const env=(name:string)=>Deno.env.get(name)??'';
function platformKey(kind:'public'|'secret'){
 const raw=env(kind==='public'?'SUPABASE_PUBLISHABLE_KEYS':'SUPABASE_SECRET_KEYS');
 if(raw){try{const keys=JSON.parse(raw);if(keys.default)return keys.default;}catch{}}
 return env(kind==='public'?'SUPABASE_ANON_KEY':'SUPABASE_SERVICE_ROLE_KEY');
}
function allowed(origin:string){return origin==='https://app.themoverz.com'||origin==='https://the-movers-login-dev.vercel.app'||/^https:\/\/the-movers-login-[a-z0-9]+-the-movers\.vercel\.app$/.test(origin)}
const uuid=(x:unknown)=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
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
 const userClient=createClient(url,publicKey,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
 const verified=await userClient.auth.getUser(auth.slice(7));
 if(verified.error||!verified.data.user)return reply({error:'Your login expired. Sign in again.'},401);
 const raw=await req.text();if(raw.length>4096)return reply({error:'Request too large'},413);
 let data;try{data=JSON.parse(raw)}catch{return reply({error:'Invalid request'},400)}
 if(!uuid(data.company_id)||!['check','send_test'].includes(data.action))return reply({error:'Invalid action or company'},400);
 const membership=await userClient.from('company_members').select('role,active').eq('company_id',data.company_id).eq('user_id',verified.data.user.id).single();
 if(membership.error||!membership.data?.active||!['owner','office_admin'].includes(membership.data.role))return reply({error:'Office access required'},403);
 const admin=createClient(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
 // Credentials currently belong to The Movers only, never another tenant.
 const company=await admin.from('companies').select('id').eq('slug','the-movers').single();
 if(company.error||company.data?.id!==data.company_id)return reply({error:'This company has no Twilio connection configured'},403);
 const sid=env('TWILIO_ACCOUNT_SID'),token=env('TWILIO_AUTH_TOKEN'),from=env('TWILIO_FROM_NUMBER');
 if(!/^AC[a-f0-9]{32}$/i.test(sid)||!token||!/^\+1[2-9][0-9]{9}$/.test(from))return reply({error:'Check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER in Edge Function Secrets'},503);
 const authHeader='Basic '+btoa(sid+':'+token),api='https://api.twilio.com/2010-04-01/Accounts/'+sid;
 if(data.action==='check'){
 const response=await fetch(api+'/IncomingPhoneNumbers.json?PhoneNumber='+encodeURIComponent(from),{headers:{Authorization:authHeader},signal:AbortSignal.timeout(15000)});
 const remote=await response.json();if(!response.ok)return reply({error:'Twilio rejected the connection. Check the Account SID and Auth Token.',code:remote.code??null},502);
 const number=(remote.incoming_phone_numbers??[]).find((n:{phone_number:string})=>n.phone_number===from);
 if(!number||!number.capabilities?.sms)return reply({error:'The configured number was not found as an SMS-capable number in this Twilio account'},400);
 return reply({connected:true,from_number:from,webhook_url:url+'/functions/v1/movers-sms-webhook',note:'Credentials and SMS sender verified. This does not independently verify campaign approval or carrier delivery.'});
 }
 if(data.confirm_own_phone!==true||!uuid(data.request_id)||typeof data.test_phone!=='string'||!/^\+1[2-9][0-9]{9}$/.test(data.test_phone))return reply({error:'Confirm that you control the saved test number'},400);
 const reservation=await userClient.rpc('reserve_sms_test',{target_company:data.company_id,test_request:data.request_id,expected_phone:data.test_phone});
 if(reservation.error)return reply({error:reservation.error.message},400);
 const item=reservation.data;
 if(!item.created)return reply({message_id:item.id,status:item.status,reused:true,note:'Existing request; no second message was submitted.'});
 const finish=async(messageSid:string|null,status:string,error:string|null)=>admin.rpc('finish_sms_test',{message_id:item.id,message_sid:messageSid,new_status:status,provider_error:error});
 try{
 const service=env('TWILIO_MESSAGING_SERVICE_SID');
 if(service&&!/^MG[a-f0-9]{32}$/i.test(service)){await finish(null,'failed','INVALID_SERVICE_SID');return reply({error:'Check TWILIO_MESSAGING_SERVICE_SID in Secrets'},503)}
 const form=new URLSearchParams({To:item.phone,From:from,Body:item.body,StatusCallback:url+'/functions/v1/movers-sms-webhook?message_id='+item.id});
 if(service)form.set('MessagingServiceSid',service);
 const response=await fetch(api+'/Messages.json',{method:'POST',headers:{Authorization:authHeader,'Content-Type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(20000)});
 const remote=await response.json();
 if(!response.ok){await finish(null,'failed',String(remote.code??response.status));return reply({error:'Twilio rejected the test. See the error code in the message log.',code:remote.code??response.status,message_id:item.id},400)}
 if(typeof remote.sid!=='string'||!/^SM[a-f0-9]{32}$/i.test(remote.sid)){await finish(null,'unknown','UNEXPECTED_RESPONSE');return reply({error:'Submission outcome is uncertain. Check Twilio message logs before trying another test.',message_id:item.id},502)}
 const status=['accepted','queued','sending','sent','delivered','undelivered','failed'].includes(remote.status)?remote.status:'queued';
 const saved=await finish(remote.sid,status,null);
 if(saved.error)return reply({error:'Twilio accepted the test, but its local status could not be saved. Check Twilio logs; do not immediately resend.',message_id:item.id},502);
 return reply({message_id:item.id,status,note:'Submitted to Twilio. Queued or sent does not mean delivered.'});
 }catch{
 await finish(null,'unknown','NETWORK_OR_TIMEOUT');
 return reply({error:'Submission outcome is uncertain. Check Twilio message logs before trying another test.',message_id:item.id},502);
 }
 }catch{return reply({error:'Could not complete the connection test. Check Edge Function logs without sharing credentials.'},500)}
}
Deno.serve(handler);
