import {createClient} from '@supabase/supabase-js';
import {projectUrl,publishableKey} from './config';
// Read before the client consumes the URL: invite links arrive as #access_token=…&type=invite.
export const arrivedFromInvite=typeof window!=='undefined'&&/(^|[#&])type=invite(&|$)/.test(window.location.hash);
export const supabase=createClient(projectUrl,publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'implicit'}});
