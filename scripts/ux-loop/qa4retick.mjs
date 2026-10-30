/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* r4b: tap a payout row that ALREADY has a request; then a control row without one. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP=process.argv[2]||'http://127.0.0.1:8124/',API='http://127.0.0.1:8787/';
const OUT=process.argv[3]||'/tmp/ux-out/r4b-qa-retick';const WHO=process.argv[4]||'manager';
mkdirSync(OUT,{recursive:true});
const CREDS={manager:{u:'manager',p:process.env.MANAGER_PIN},owner:{u:'owner',p:process.env.PIN}};
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:3,timezoneId:'Asia/Kolkata'});
const p=await ctx.newPage();
const dialogs=[];p.on('dialog',async d=>{dialogs.push({type:d.type(),message:d.message()});await d.accept();});
const nonLocal=[],calls=[];
p.on('request',r=>{const u=r.url();if(/^https?:/.test(u)&&!u.startsWith(API)&&!u.startsWith(APP))nonLocal.push(u.slice(0,110));if(u.startsWith(API))calls.push(new URL(u).searchParams.get('action'));});
let n=0;const shot=l=>p.screenshot({path:`${OUT}/${String(++n).padStart(2,'0')}-${l}.png`});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
const txt=async()=>(await p.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ');
const R={app:APP};
const rows=()=>p.evaluate(()=>[...document.querySelectorAll('div[tabindex]')].filter(e=>e.offsetParent&&e.getBoundingClientRect().width>300&&/AWAITING/.test(e.innerText||'')).map((e,i)=>{
  const t=(e.innerText||'').replace(/\s+/g,' ');
  return{i,name:(t.match(/^\S\s+([A-Za-z ]+?)\s+(Stay|Resold)/)||[null,'?'])[1],waiting:/WAITING FOR APPROVAL/.test(t),req:(t.match(/Request #(\d+)/)||[null,null])[1]};}));
const state=async()=>({header:((await txt()).match(/\d+ ticked · ₹[\d,]+/)||[null])[0],
  markBtn:await p.evaluate(()=>{const e=[...document.querySelectorAll('*')].filter(x=>x.offsetParent&&/^Mark \d+ paid/.test((x.innerText||'').trim()));return e.length?(e[e.length-1].innerText||'').trim():null;})});
const tap=async(i)=>{await p.evaluate(()=>document.querySelectorAll('[data-row]').forEach(e=>e.removeAttribute('data-row')));
  await p.evaluate(k=>{const rs=[...document.querySelectorAll('div[tabindex]')].filter(e=>e.offsetParent&&e.getBoundingClientRect().width>300&&/AWAITING/.test(e.innerText||''));if(rs[k]){rs[k].setAttribute('data-row','1');rs[k].scrollIntoView({block:'center'});}},i);
  await p.waitForTimeout(500);await p.locator('div[data-row]').first().click({force:true});await p.waitForTimeout(1500);};
await p.goto(APP,{waitUntil:'load'});
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1500);}catch{}
const c=CREDS[WHO];
if(c.u) await p.getByPlaceholder('Username').first().fill(c.u);
await p.getByPlaceholder('PIN').first().fill(c.p);
await vis('Unlock').first().click();await p.waitForTimeout(3600);
await vis('Action').first().click();await p.waitForTimeout(2600);
await vis('Pending amount').first().click({force:true});await p.waitForTimeout(2800);
await shot('list');
R.rows=await rows();
console.log('rows:',JSON.stringify(R.rows.map(r=>r.name+':'+(r.req||'-'))));
R.baseline=await state();
const waiting=R.rows.find(r=>r.waiting);
if(waiting){const c0=calls.length;await tap(waiting.i);
  R.tapWaiting={row:waiting.name,req:waiting.req,apiCalls:calls.slice(c0),...(await state())};
  console.log('TAP a WAITING row:',JSON.stringify(R.tapWaiting));await shot('tap-waiting');}
const clean=R.rows.find(r=>!r.waiting);
if(clean){const c1=calls.length;await tap(clean.i);
  R.tapClean={row:clean.name,apiCalls:calls.slice(c1),...(await state())};
  console.log('TAP a CLEAN row (control):',JSON.stringify(R.tapClean));await shot('tap-clean');}
R.checkboxes=await p.evaluate(()=>{const rs=[...document.querySelectorAll('div[tabindex]')].filter(e=>e.offsetParent&&e.getBoundingClientRect().width>300&&/AWAITING/.test(e.innerText||''));
  return rs.map(e=>({waiting:/WAITING FOR APPROVAL/.test(e.innerText||''),boxes:e.querySelectorAll('div[tabindex]').length}));});
R.dialogs=dialogs;R.nonLocal=[...new Set(nonLocal)];
writeFileSync(`${OUT}/retick.json`,JSON.stringify(R,null,2));
console.log('baseline:',JSON.stringify(R.baseline),'| dialogs:',dialogs.length,'| non-local:',R.nonLocal.length?R.nonLocal:'none','|',OUT);
await b.close();
