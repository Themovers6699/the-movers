import {useEffect,useState} from 'react';
import {installMode} from './pwa';

type PromptEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
const KEY='movers-install-hint-dismissed';

// Small banner inviting people to install The Movers on their phone/tablet home screen.
export default function InstallPrompt(){
 const [deferred,setDeferred]=useState<PromptEvent|null>(null);
 const [dismissed,setDismissed]=useState(()=>{try{return localStorage.getItem(KEY)==='1'}catch{return false}});
 const standalone=typeof window!=='undefined'&&(window.matchMedia?.('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone===true);
 useEffect(()=>{const on=(e:Event)=>{e.preventDefault();setDeferred(e as PromptEvent)};window.addEventListener('beforeinstallprompt',on);return()=>window.removeEventListener('beforeinstallprompt',on)},[]);
 const mode=installMode({standalone,dismissed,userAgent:navigator.userAgent,maxTouchPoints:navigator.maxTouchPoints??0,canPrompt:!!deferred});
 if(!mode)return null;
 const dismiss=()=>{setDismissed(true);try{localStorage.setItem(KEY,'1')}catch{/* private mode */}};
 return <div className="installhint" role="note">
  <img src="/brand/icon-180.png" alt="" width={40} height={40}/>
  <div><b>Install The Movers app</b>
   {mode==='apple'?<p>Tap the <b>Share</b> button <span aria-hidden="true">⬆️</span> at the bottom (top on iPad), then <b>Add to Home Screen</b>.</p>:<p>Get an app icon on your home screen. It opens full screen and is always up to date.</p>}
  </div>
  <div className="installactions">
   {mode==='button'&&<button type="button" className="primary" onClick={async()=>{if(!deferred)return;await deferred.prompt();await deferred.userChoice.catch(()=>null);setDeferred(null);dismiss()}}>Install</button>}
   <button type="button" className="secondary" onClick={dismiss}>Not now</button>
  </div>
 </div>;
}
