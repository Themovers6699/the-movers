import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
const env=(name:string)=>Deno.env.get(name)??'';
function secretKey(){try{const keys=JSON.parse(env('SUPABASE_SECRET_KEYS')||'{}');if(keys.default)return keys.default}catch{}return env('SUPABASE_SERVICE_ROLE_KEY')}
export async function validSignature(token:string,url:string,params:URLSearchParams,signature:string){
 try{
 const payload=url+Array.from(params.keys()).sort().map(k=>k+params.get(k)).join('');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(token),{name:'HMAC',hash:'SHA-1'},false,['verify']);
 const bytes=Uint8Array.from(atob(signature),c=>c.charCodeAt(0));
 return await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(payload));
 }catch{return false}
}
export async function handler(req:Request){
 const xml=()=>new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>',{headers:{'Content-Type':'text/xml','Cache-Control':'no-store'}});
 if(req.method!=='POST')return new Response('POST required',{status:405});
 try{
 const url=env('SUPABASE_URL'),token=env('TWILIO_AUTH_TOKEN'),sid=env('TWILIO_ACCOUNT_SID'),from=env('TWILIO_FROM_NUMBER');
 if(!url||!token||!sid||!from||!secretKey())return new Response('Not configured',{status:503});
 if(!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return new Response('Form body required',{status:415});
 const raw=await req.text();if(raw.length>65536)return new Response('Too large',{status:413});
 const params=new URLSearchParams(raw);if(new Set(params.keys()).size!==Array.from(params.keys()).length)return new Response('Duplicate fields',{status:400});
 // Use the external configured URL, not the gateway's internal host.
 const incoming=new URL(req.url),publicUrl=url+'/functions/v1/movers-sms-webhook'+incoming.search;
 if(!await validSignature(token,publicUrl,params,req.headers.get('x-twilio-signature')??''))return new Response('Invalid signature',{status:403});
 if(params.get('AccountSid')!==sid)return new Response('Wrong account',{status:403});
 const messageSid=params.get('MessageSid')??params.get('SmsSid')??'';
 if(!/^(SM|MM)[a-f0-9]{32}$/i.test(messageSid))return new Response('Invalid message',{status:400});
 const admin=createClient(url,secretKey(),{auth:{persistSession:false,autoRefreshToken:false}});
 const company=await admin.from('companies').select('id').eq('slug','the-movers').single();if(company.error||!company.data)return new Response('Connection unavailable',{status:503});
 const id=incoming.searchParams.get('message_id');
 if(id){
 if(!/^[a-f0-9-]{36}$/i.test(id))return new Response('Invalid ID',{status:400});
 const row=await admin.from('sms_test_messages').select('id,to_phone,provider_sid').eq('id',id).eq('company_id',company.data.id).eq('direction','outbound').single();
 if(row.error||!row.data||params.get('From')!==from||params.get('To')!==row.data.to_phone||(row.data.provider_sid&&row.data.provider_sid!==messageSid))return new Response('Message mismatch',{status:400});
 const status=params.get('MessageStatus')??params.get('SmsStatus')??'';
 if(!['accepted','queued','sending','sent','delivered','undelivered','failed'].includes(status))return xml();
 const done=await admin.rpc('finish_sms_test',{message_id:id,message_sid:messageSid,new_status:status,provider_error:params.get('ErrorCode')});
 if(done.error)return new Response('Try again',{status:503});return xml();
 }
 if(params.get('To')!==from)return new Response('Wrong number',{status:403});
 const phone=params.get('From')??'';if(!/^\+1[2-9][0-9]{9}$/.test(phone))return xml();
 const body=params.get('Body')??'',keyword=body.trim().toUpperCase(),providerEvent=params.get('OptOutType')?.toUpperCase();
 const event=providerEvent==='STOP'||['STOP','STOPALL','UNSUBSCRIBE','OPTOUT','CANCEL','END','REVOKE','QUIT'].includes(keyword)?'STOP':providerEvent==='START'||['START','YES','UNSTOP'].includes(keyword)?'START':null;
 const saved=await admin.rpc('record_sms_test_reply',{target_company:company.data.id,message_sid:messageSid,phone,message_body:body,opt_event:event});
 if(saved.error)return new Response('Try again',{status:503});
 // Twilio's configured opt-out/help handler sends its keyword responses. Do not duplicate them here.
 return xml();
 }catch{return new Response('Webhook processing failed',{status:503})}
}
Deno.serve(handler);
