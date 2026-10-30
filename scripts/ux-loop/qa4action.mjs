/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* r4 #1: Action tab under approval — manager mark-paid, receipt, bands, batch; admin immediate. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP=process.argv[2]||'http://127.0.0.1:8124/',API='http://127.0.0.1:8787/';
const OUT=process.argv[3]||'/tmp/ux-out/r4-qa-action';
const WHO=process.argv[4]||'manager';
mkdirSync(OUT,{recursive:true});
const CREDS={manager:{u:'manager',p:process.env.MANAGER_PIN},owner:{u:'owner',p:process.env.PIN}};
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:3,timezoneId:'Asia/Kolkata'});
const p=await ctx.newPage();
const dialogs=[];p.on('dialog',async d=>{dialogs.push({type:d.type(),message:d.message()});await d.accept();});
const nonLocal=[],calls=[];
p.on('request',r=>{const u=r.url();if(/^https?:/.test(u)&&!u.startsWith(API)&&!u.startsWith(APP))nonLocal.push(u.slice(0,110));if(u.startsWith(API))calls.push({a:new URL(u).searchParams.get('action'),t:Date.now()});});
let n=0;const shot=l=>p.screenshot({path:`${OUT}/${String(++n).padStart(2,'0')}-${l}.png`});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
const txt=async()=>(await p.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ');
const R={app:APP,who:WHO};
await p.goto(APP,{waitUntil:'load'});
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1500);}catch{}
const c=CREDS[WHO];
if(c.u) await p.getByPlaceholder('Username').first().fill(c.u);
await p.getByPlaceholder('PIN').first().fill(c.p);
await vis('Unlock').first().click();await p.waitForTimeout(3600);
await vis('Action').first().click();await p.waitForTimeout(2800);
await shot('action');
R.actionText=(await txt()).slice(0,700);
/* find tickable payout rows: checkbox-ish controls near a "pending"/payout section */
R.controls=await p.evaluate(()=>{
  const out=[];
  for(const e of document.querySelectorAll('div[tabindex],button')){
    if(!e.offsetParent)continue;
    const r=e.getBoundingClientRect();
    const t=(e.innerText||'').trim().replace(/\s+/g,' ').slice(0,50);
    if(r.width<20||r.height<16)continue;
    out.push({t,aria:e.getAttribute('aria-label'),x:Math.round(r.left),y:Math.round(r.top+window.scrollY),w:Math.round(r.width),h:Math.round(r.height)});
  }
  return out.slice(0,60);});
console.log('controls sample:',JSON.stringify(R.controls.slice(0,25)));
/* open the Pending amount card */
await p.getByText('Pending amount',{exact:false}).locator('visible=true').first().click({force:true});
await p.waitForTimeout(2600);
await shot('pending-list');
R.pendingText=(await txt()).slice(0,1200);
console.log('PENDING LIST:',R.pendingText.slice(0,900));
R.pendingControls=await p.evaluate(()=>{
  const out=[];
  for(const e of document.querySelectorAll('div[tabindex],button,input')){
    if(!e.offsetParent)continue;const r=e.getBoundingClientRect();
    if(r.width<14||r.height<14)continue;
    out.push({tag:e.tagName,t:(e.innerText||'').trim().replace(/\s+/g,' ').slice(0,60),aria:e.getAttribute('aria-label'),
      x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)});}
  return out;});
console.log('PENDING CONTROLS:',JSON.stringify(R.pendingControls.slice(0,40),null,0));
writeFileSync(`${OUT}/action.json`,JSON.stringify(R,null,2));
console.log('| ',OUT);
await b.close();
