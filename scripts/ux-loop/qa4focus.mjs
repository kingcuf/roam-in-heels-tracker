/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* r4 #5: sign-in autofocus + Unlock in the tab ring, empty AND filled. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP=process.argv[2]||'http://127.0.0.1:8124/',API='http://127.0.0.1:8787/';
const OUT=process.argv[3]||'/tmp/ux-out/r4-qa-focus';mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:3,timezoneId:'Asia/Kolkata'});
const p=await ctx.newPage();
const nonLocal=[];p.on('request',r=>{const u=r.url();if(/^https?:/.test(u)&&!u.startsWith(API)&&!u.startsWith(APP))nonLocal.push(u.slice(0,110));});
let n=0;const shot=l=>p.screenshot({path:`${OUT}/${String(++n).padStart(2,'0')}-${l}.png`});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
const act=()=>p.evaluate(()=>{const a=document.activeElement;return a?{tag:a.tagName,ph:a.getAttribute&&a.getAttribute('placeholder'),txt:(a.innerText||'').trim().replace(/\s+/g,' ').slice(0,26),ti:a.getAttribute&&a.getAttribute('tabindex')}:null;});
const R={app:APP};
await p.goto(APP,{waitUntil:'load'});
/* sample activeElement across the intro and after it */
R.samples=[];
for(let i=0;i<14;i++){await p.waitForTimeout(400);const a=await act();R.samples.push({t:(i+1)*400,a});}
console.log('activeElement timeline:',JSON.stringify(R.samples.map(s=>s.t+':'+(s.a?(s.a.ph||s.a.txt||s.a.tag):'null'))));
/* skip intro if still up, then sample again */
try{if(await vis('Skip').first().isVisible()){await vis('Skip').first().click();await p.waitForTimeout(1600);}}catch{}
R.afterSkip=await act();
R.autofocusAttr=await p.evaluate(()=>[...document.querySelectorAll('input')].map(e=>({ph:e.placeholder,hasAutofocusAttr:e.hasAttribute('autofocus')})));
console.log('after skip:',JSON.stringify(R.afterSkip),'| autofocus attrs:',JSON.stringify(R.autofocusAttr));
await shot('login');
/* Unlock button state, EMPTY form */
const btnInfo=()=>p.evaluate(()=>{const e=[...document.querySelectorAll('*')].filter(x=>x.offsetParent&&/^Unlock$/.test((x.innerText||'').trim()));const t=e[e.length-1];if(!t)return null;
  const host=t.closest('[tabindex]')||t;return{tabindex:host.getAttribute('tabindex'),ariaDisabled:host.getAttribute('aria-disabled'),disabled:host.hasAttribute('disabled'),tag:host.tagName};});
R.unlockEmpty=await btnInfo();
const ring=async()=>{await p.getByPlaceholder('Username').first().focus();const out=[];
  for(let i=0;i<7;i++){out.push(await act());await p.keyboard.press('Tab');await p.waitForTimeout(90);}return out;};
R.ringEmpty=await ring();
R.unlockInRingEmpty=R.ringEmpty.some(t=>t&&/Unlock/i.test(t.txt||''));
console.log('EMPTY  unlock=',JSON.stringify(R.unlockEmpty),'ring=',JSON.stringify(R.ringEmpty.map(t=>t&&(t.ph||t.txt||t.tag))),'inRing=',R.unlockInRingEmpty);
/* FILLED form */
await p.getByPlaceholder('Username').first().fill('manager');
await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await p.waitForTimeout(600);
R.unlockFilled=await btnInfo();
R.ringFilled=await ring();
R.unlockInRingFilled=R.ringFilled.some(t=>t&&/Unlock/i.test(t.txt||''));
console.log('FILLED unlock=',JSON.stringify(R.unlockFilled),'ring=',JSON.stringify(R.ringFilled.map(t=>t&&(t.ph||t.txt||t.tag))),'inRing=',R.unlockInRingFilled);
await shot('filled');
/* can Enter/Space on the focused Unlock actually sign in? */
if(R.unlockInRingFilled){
  await p.getByPlaceholder('Username').first().focus();
  for(let i=0;i<7;i++){const a=await act();if(a&&/Unlock/i.test(a.txt||''))break;await p.keyboard.press('Tab');await p.waitForTimeout(90);}
  await p.keyboard.press('Enter');await p.waitForTimeout(3200);
  R.enterOnUnlockSignsIn=await p.evaluate(()=>/need attention|Approvals|Total Revenue|Pending/i.test(document.body.innerText));
  console.log('Enter on focused Unlock signs in:',R.enterOnUnlockSignsIn);
}
await shot('after-enter');
R.nonLocal=[...new Set(nonLocal)];
writeFileSync(`${OUT}/focus.json`,JSON.stringify(R,null,2));
console.log('non-local:',R.nonLocal.length?R.nonLocal:'none','|',OUT);
await b.close();
