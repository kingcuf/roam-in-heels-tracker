/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const API='http://127.0.0.1:8787/';
const out='/tmp/ux-out/r1-qa-review'; mkdirSync(out,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage();
const calls=[]; p.on('response',async r=>{if(!r.url().startsWith(API))return;let n=0;try{n=(await r.body()).length}catch{}
  calls.push({a:new URL(r.url()).searchParams.get('action'),kb:+(n/1024).toFixed(1)})});
let taps=0,shot=0; const log=[];
const snap=async n=>p.screenshot({path:`${out}/${String(++shot).padStart(2,'0')}-${n}.png`});
await p.goto('http://127.0.0.1:8124/',{waitUntil:'load'}); await p.waitForTimeout(500);
await p.getByText('Skip').locator('visible=true').first().click(); await p.waitForTimeout(900);
await p.getByPlaceholder('Username').fill('manager'); await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await p.getByText('Unlock').locator('visible=true').first().click();
await p.getByText('need attention').locator('visible=true').first().waitFor({timeout:15000});
await p.waitForTimeout(2500);
const T0=Date.now();
const tap=async(t,exact=true,nth=0)=>{const l=p.getByText(t,{exact}).locator('visible=true').nth(nth);
  await l.waitFor({timeout:10000}); const t0=Date.now(); const c0=calls.length; await l.click(); taps++;
  await p.waitForTimeout(1000); log.push({tap:t,ms:Date.now()-t0,calls:calls.slice(c0)});};
await tap('Team'); await snap('team');
await tap('Approve'); await p.waitForTimeout(800); await snap('approve-list');
const txt=await p.evaluate(()=>document.body.innerText.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,40));
console.log('APPROVE SCREEN:',txt);
const r={taps,totalSec:+((Date.now()-T0)/1000).toFixed(1),log,screen:txt,allCalls:calls};
writeFileSync(`${out}/review.json`,JSON.stringify(r,null,2));
console.log(JSON.stringify({taps,totalSec:r.totalSec,log:r.log},null,1));
await b.close();
