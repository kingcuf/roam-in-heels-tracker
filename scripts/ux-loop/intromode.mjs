/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const APP='http://127.0.0.1:8124/';
const out=process.env.OUT||'/tmp/ux-out/r2-qa-intro-every'; mkdirSync(out,{recursive:true});
const b=await chromium.launch();
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await c.newPage(); const R={};
const usable=async(to=25000)=>{const t=Date.now();try{
  await p.getByPlaceholder('Username').waitFor({state:'visible',timeout:to});
  await p.waitForFunction(()=>{const el=[...document.querySelectorAll('input')].find(i=>i.placeholder==='Username');
    if(!el)return false;const r=el.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return top===el||el.contains(top);},{timeout:to});return Date.now()-t;}catch(e){return '>'+to+' NEVER USABLE';}};
await p.goto(APP,{waitUntil:'load'}); R.launch1=await usable();
await p.screenshot({path:`${out}/01-launch1.png`});
R.ls1=await p.evaluate(()=>JSON.stringify(localStorage));
await p.goto(APP,{waitUntil:'load'}); R.launch2=await usable();
await p.screenshot({path:`${out}/02-launch2.png`});
await p.goto(APP,{waitUntil:'load'}); R.launch3=await usable();
R.ls3=await p.evaluate(()=>JSON.stringify(localStorage));
// sign in still works
R.bodyTextLaunch3=(await p.evaluate(()=>document.body.innerText)).slice(0,120);
R.domLenLaunch3=await p.evaluate(()=>document.getElementById('root')?.innerHTML.length||0);
if(typeof R.launch3!=='number'){ writeFileSync(`${out}/intro.json`,JSON.stringify(R,null,2)); console.log(JSON.stringify(R)); await b.close(); process.exit(0);}
await p.getByPlaceholder('Username').fill('manager'); await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await p.getByText('Unlock').locator('visible=true').first().click();
const t=Date.now();
try{await p.getByText('need attention').locator('visible=true').first().waitFor({timeout:15000});R.signInMs=Date.now()-t;}catch{R.signInMs='timeout';}
await p.screenshot({path:`${out}/03-landing.png`});
writeFileSync(`${out}/intro.json`,JSON.stringify(R,null,2)); console.log(JSON.stringify(R));
await b.close();
