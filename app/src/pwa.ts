// Installable app helpers (no screen code, so tests can import them).

/** iPhone / iPad (iPadOS reports itself as a Mac, so also check for a touch screen). */
export function isAppleMobile(userAgent:string,maxTouchPoints=0){
 return /iphone|ipad|ipod/i.test(userAgent)||(/macintosh/i.test(userAgent)&&maxTouchPoints>1);
}
/** Which install help to show: 'apple' = Share → Add to Home Screen, 'button' = browser install prompt, null = none. */
export function installMode(o:{standalone:boolean;dismissed:boolean;userAgent:string;maxTouchPoints:number;canPrompt:boolean}):'apple'|'button'|null{
 if(o.standalone||o.dismissed)return null;
 if(o.canPrompt)return 'button';
 if(isAppleMobile(o.userAgent,o.maxTouchPoints)&&/safari/i.test(o.userAgent)&&!/crios|fxios|edgios/i.test(o.userAgent))return 'apple';
 return null;
}
