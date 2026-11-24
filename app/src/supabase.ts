import {createClient} from '@supabase/supabase-js';
import {projectUrl,publishableKey} from './config';
export const supabase=createClient(projectUrl,publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'implicit'}});
