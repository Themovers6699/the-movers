/// <reference types="vite/client" />
// Browser-safe connection settings. NEVER put a secret/service-role key here.
// Publishable keys are public by design (every visitor's browser receives them); access is enforced by RLS.
// The build target is chosen with VITE_TARGET=testing|production (see scripts/deploy.ps1). Default: testing.
const TARGETS={
 testing:{projectUrl:'https://yohmygccqdomiynnkobn.supabase.co',publishableKey:'sb_publishable_pSyItyg8Kfwv7i6y9dfqiw_k5r2Kvfh',label:'TESTING'},
 production:{projectUrl:'https://oeiotkbwpnvvjxweppwi.supabase.co',publishableKey:'sb_publishable_ZhU00v-SFosK4gQJH0SFxA_SC2Srdv-',label:''},
} as const;
export const target:keyof typeof TARGETS=import.meta.env.VITE_TARGET==='production'?'production':'testing';
export const {projectUrl,publishableKey}=TARGETS[target];
/** Shown in the app header so nobody mistakes the testing app for the real one. Empty in production. */
export const environmentLabel=TARGETS[target].label;
