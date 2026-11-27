import {test} from 'node:test';import assert from 'node:assert/strict';import {isAppleMobile,installMode} from '../src/pwa.ts';
const iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const ipad='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const mac=ipad, chromeIos='Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1';
const base={standalone:false,dismissed:false,maxTouchPoints:0,canPrompt:false};
test('iPhone and iPad (which reports itself as a Mac) are recognised; a real Mac is not',()=>{assert.equal(isAppleMobile(iphone),true);assert.equal(isAppleMobile(ipad,5),true);assert.equal(isAppleMobile(mac,0),false)});
test('Install help: Apple instructions in Safari, a button where the browser offers it, nothing once installed or dismissed',()=>{
 assert.equal(installMode({...base,userAgent:iphone}),'apple');assert.equal(installMode({...base,userAgent:ipad,maxTouchPoints:5}),'apple');
 assert.equal(installMode({...base,userAgent:chromeIos}),null);assert.equal(installMode({...base,userAgent:mac}),null);
 assert.equal(installMode({...base,userAgent:'Android Chrome',canPrompt:true}),'button');
 assert.equal(installMode({...base,userAgent:iphone,standalone:true}),null);assert.equal(installMode({...base,userAgent:iphone,dismissed:true}),null);
});
