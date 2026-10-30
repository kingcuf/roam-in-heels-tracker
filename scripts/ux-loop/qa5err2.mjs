/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP='http://127.0.0.1:8124/';const OUT=process.argv[2];mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});const p=await ctx.newPage();
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
await p.goto(APP,{waitUntil:'load'});await p.waitForTimeout(1200);
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3500);
await vis('Add').first().click({force:true});await p.waitForTimeout(1800);
const R={};
const geo=()=>p.evaluate(()=>{const dec=[...document.querySelectorAll('input')].filter(e=>e.inputMode==='decimal');
 const dates=[...document.querySelectorAll('input[type=date]')];
 const bb=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{t:Math.round(r.top),on:r.top>=0&&r.bottom<=window.innerHeight};};
 const msg=[...document.querySelectorAll('div,span')].filter(e=>!e.childElementCount&&/Pick the booking date|Enter what you keep|Pick the property/.test(e.textContent||''))
   .map(e=>{const r=e.getBoundingClientRect();return{t:e.textContent.trim(),y:Math.round(r.top),on:r.top>=0&&r.bottom<=window.innerHeight};});
 return {bookingDate:bb(dates[0]),net:bb(dec[1]),msg};});
// fill Net earned so it is valid, clear the booking date
const net=await p.evaluateHandle(()=>[...document.querySelectorAll('input')].filter(e=>e.inputMode==='decimal')[1]);
await p.evaluate(e=>e.focus(),net);await p.keyboard.type('21000',{delay:50});await p.waitForTimeout(500);
const dateEl=p.locator('input[type=date]').first();
await dateEl.fill('');await p.waitForTimeout(600);
// scroll to the foot so card 1 is far away
await p.evaluate(()=>{const sc=[...document.querySelectorAll('div')].find(d=>d.scrollHeight>d.clientHeight+50&&getComputedStyle(d).overflowY!=='visible');if(sc)sc.scrollTop=sc.scrollHeight;});
await p.waitForTimeout(800);
R.before=await geo(); await p.screenshot({path:`${OUT}/01-foot.png`});
await vis('Submit for approval').first().click({force:true});await p.waitForTimeout(2200);
R.after=await geo(); await p.screenshot({path:`${OUT}/02-after.png`});
writeFileSync(`${OUT}/e.json`,JSON.stringify(R,null,2));console.log(JSON.stringify(R,null,1));
await b.close();
