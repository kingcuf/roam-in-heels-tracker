/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP=process.argv[2]||'http://127.0.0.1:8124/', API='http://127.0.0.1:8787/';
const OUT=process.argv[3]||'/tmp/ux-out/r3-qa-focus'; mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:3,timezoneId:'Asia/Kolkata'});
const p=await ctx.newPage();
const calls=[];p.on('request',r=>{if(r.url().startsWith(API))calls.push(new URL(r.url()).searchParams.get('action'));});
let n=0;const shot=l=>p.screenshot({path:`${OUT}/${String(++n).padStart(2,'0')}-${l}.png`});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
const act=()=>p.evaluate(()=>{const a=document.activeElement;return a?{tag:a.tagName,ph:a.getAttribute&&a.getAttribute('placeholder'),txt:(a.innerText||'').trim().slice(0,24),aria:a.getAttribute&&a.getAttribute('aria-label')}:null;});
const R={app:APP};
await p.goto(APP,{waitUntil:'load'});
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();}catch{}
/* autofocus: sample over 4 s */
R.autofocusSamples=[];
for(let i=0;i<8;i++){await p.waitForTimeout(500);R.autofocusSamples.push(await act());}
console.log('autofocus samples:',JSON.stringify(R.autofocusSamples));
await shot('signin');
/* tab ring from Username */
await p.getByPlaceholder('Username').first().focus();
R.tabRing=[];
for(let i=0;i<8;i++){R.tabRing.push(await act());await p.keyboard.press('Tab');await p.waitForTimeout(80);}
console.log('tab ring:',JSON.stringify(R.tabRing.map(t=>t&&(t.ph||t.aria||t.txt||t.tag))));
R.unlockInTabRing=R.tabRing.some(t=>t&&/Unlock/i.test((t.txt||'')+(t.aria||'')));
/* sign in, then Enter-submits test on a fully valid expense */
await p.getByPlaceholder('Username').first().fill('manager');
await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3200);
await vis('Add').first().click();await p.waitForTimeout(1500);
await p.getByText('Expense',{exact:true}).locator('visible=true').first().click({force:true});await p.waitForTimeout(1300);
R.formAutofocus=await act();
await p.locator('text=Select…').locator('visible=true').first().click({force:true});await p.waitForTimeout(1600);
await p.getByText('Caretaker',{exact:true}).locator('visible=true').first().click({force:true});await p.waitForTimeout(900);
await p.getByPlaceholder('e.g. Monthly rent').first().fill('UX r3 enter submit');
const amt=await p.evaluate(()=>{const ins=[...document.querySelectorAll('input')].filter(e=>e.offsetParent&&e.inputMode==='decimal');if(!ins[0])return false;ins[0].setAttribute('data-a','1');return true;});
if(amt) await p.locator('input[data-a]').first().fill('250');
const c0=calls.length;
await p.getByPlaceholder('e.g. Monthly rent').first().press('Enter');
await p.waitForTimeout(3000);
const body=(await p.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ');
R.enterSubmitsForm={apiCalls:calls.slice(c0),msg:(body.match(/request #\d+[^•]{0,80}|sent to an admin[^•]{0,60}/i)||[null])[0]};
console.log('Enter on single-line field →',JSON.stringify(R.enterSubmitsForm));
await shot('after-enter');
writeFileSync(`${OUT}/focus.json`,JSON.stringify(R,null,2));
console.log('unlockInTabRing:',R.unlockInTabRing,'| formAutofocus:',JSON.stringify(R.formAutofocus),'|',OUT);
await b.close();
