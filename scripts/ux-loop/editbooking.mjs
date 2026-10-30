/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const API='http://127.0.0.1:8787/';
const out='/tmp/ux-out/r1-qa-editbooking'; mkdirSync(out,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage();
const calls=[]; p.on('response',async r=>{if(!r.url().startsWith(API))return;let n=0;try{n=(await r.body()).length}catch{}
  calls.push({a:new URL(r.url()).searchParams.get('action'),kb:+(n/1024).toFixed(1),at:Date.now()})});
const log=[]; let taps=0, shot=0;
const snap=async(n)=>{await p.screenshot({path:`${out}/${String(++shot).padStart(2,'0')}-${n}.png`})};
await p.goto('http://127.0.0.1:8124/',{waitUntil:'load'}); await p.waitForTimeout(500);
await p.getByText('Skip').locator('visible=true').first().click(); await p.waitForTimeout(900);
await p.getByPlaceholder('Username').fill('manager'); await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await p.getByText('Unlock').locator('visible=true').first().click();
await p.getByText('need attention').locator('visible=true').first().waitFor({timeout:15000});
await p.waitForTimeout(2500);
const T0=Date.now(), C0=calls.length;
const tap=async(txt,exact=true,nth=0)=>{const l=p.getByText(txt,{exact}).locator('visible=true').nth(nth);
  await l.waitFor({timeout:10000}); const t=Date.now(); await l.click(); taps++; await p.waitForTimeout(800);
  log.push({tap:txt,ms:Date.now()-t, calls:calls.length}); };
await tap('Add');
await tap('☰ Log',false); await p.waitForTimeout(1200); await snap('log');
// tap the row containing 2026-08-11 / Spira 3028 (id 171)
const t1=Date.now();
await p.getByText('2026-08-11',{exact:true}).locator('visible=true').first().click(); taps++;
await p.waitForTimeout(1500); log.push({tap:'row 171', ms:Date.now()-t1});
await snap('row-tapped');
const onForm=await p.evaluate(()=>/Edit Booking/i.test(document.body.innerText));
console.log('opened edit form?', onForm);
// change a field
const lab=p.getByText('Stay unit',{exact:false}).locator('visible=true').first();
await lab.waitFor({timeout:8000});
await lab.locator('xpath=./following::input[1]').first().fill('UX-EDIT-1');
await snap('edited');
const C1=calls.length; const tS=Date.now();
await p.getByText('Submit for approval',{exact:false}).locator('visible=true').first().click(); taps++;
let confirmMs=null;
try{ await p.waitForFunction(()=>/request #|sent to an admin|Saved|updated/i.test(document.body.innerText),{timeout:15000});
     confirmMs=Date.now()-tS; }catch{confirmMs='timeout'}
await p.waitForTimeout(2500); await snap('saved');
const conf=(await p.evaluate(()=>document.body.innerText)).split('\n').filter(l=>/request|sent|saved/i.test(l)).slice(0,4);
const r={taps, totalSec:+((Date.now()-T0)/1000).toFixed(1), log, openedEditForm:onForm, confirmMs, confirmText:conf,
  saveCalls:calls.slice(C1).map(c=>({a:c.a,kb:c.kb})), allCalls:calls.slice(C0).map(c=>({a:c.a,kb:c.kb}))};
writeFileSync(`${out}/edit.json`,JSON.stringify(r,null,2));
console.log(JSON.stringify(r,null,1));
await b.close();
