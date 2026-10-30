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
const geo=()=>p.evaluate(()=>{const dec=[...document.querySelectorAll('input')].filter(e=>e.inputMode==='decimal');
 const bb=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{t:Math.round(r.top),on:r.top>=0&&r.bottom<=window.innerHeight};};
 const msg=[...document.querySelectorAll('div,span')].filter(e=>!e.childElementCount&&/Enter what you keep/.test(e.textContent||''))
   .map(e=>{const r=e.getBoundingClientRect();return{y:Math.round(r.top),on:r.top>=0&&r.bottom<=window.innerHeight};});
 return {net:bb(dec[1]),msg};});
await vis('Submit for approval').first().click({force:true});await p.waitForTimeout(2200);
const R={afterSubmit:await geo()};
await p.screenshot({path:`${OUT}/01-after-submit.png`});
const net=await p.evaluateHandle(()=>[...document.querySelectorAll('input')].filter(e=>e.inputMode==='decimal')[1]);
await p.evaluate(e=>e.focus(),net);await p.waitForTimeout(1500);
R.afterFocus=await geo();
await p.screenshot({path:`${OUT}/02-after-focus.png`});
R.moved=R.afterSubmit.net.t!==R.afterFocus.net.t;
writeFileSync(`${OUT}/f.json`,JSON.stringify(R,null,2));console.log(JSON.stringify(R));
await b.close();
