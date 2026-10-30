/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* r4 #1: mark-paid under approval. Manager: calls, receipt, band, re-tick, batch. Admin: immediate + logs. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP=process.argv[2]||'http://127.0.0.1:8124/',API='http://127.0.0.1:8787/';
const OUT=process.argv[3]||'/tmp/ux-out/r4-qa-payout';const WHO=process.argv[4]||'manager';
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
const rows=()=>p.evaluate(()=>[...document.querySelectorAll('div[tabindex]')].filter(e=>e.offsetParent&&e.getBoundingClientRect().width>300&&/AWAITING/.test(e.innerText||'')).map((e,i)=>{
  const t=(e.innerText||'').replace(/\s+/g,' ');const r=e.getBoundingClientRect();
  return{i,name:(t.match(/^\S\s+([A-Za-z ]+?)\s+(Stay|Resold)/)||[null,'?'])[1],
    waiting:/WAITING FOR APPROVAL/.test(t),req:(t.match(/Request #(\d+)/)||[null,null])[1],
    tickHint:/Tap the card to tick/.test(t)?'tickable':(/Already asked for/.test(t)?'already asked':'other'),
    y:Math.round(r.top+window.scrollY),h:Math.round(r.height)};}));
const receipt=()=>p.evaluate(()=>{
  const out=[];
  for(const el of document.querySelectorAll('div')){
    if(!el.offsetParent)continue;
    const bg=getComputedStyle(el).backgroundColor;
    if(bg!=='rgb(248, 241, 228)')continue;
    const r=el.getBoundingClientRect();if(r.width<150||r.height<24)continue;
    out.push({y:Math.round(r.top),b:Math.round(r.bottom),h:Math.round(r.height),w:Math.round(r.width),text:(el.innerText||'').trim().replace(/\s+/g,' ').slice(0,180)});}
  return out.filter((a,i)=>!out.some((c,j)=>j!==i&&c.y<=a.y&&c.b>=a.b&&c.h>a.h));});
await p.goto(APP,{waitUntil:'load'});
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1500);}catch{}
const c=CREDS[WHO];
if(c.u) await p.getByPlaceholder('Username').first().fill(c.u);
await p.getByPlaceholder('PIN').first().fill(c.p);
await vis('Unlock').first().click();await p.waitForTimeout(3600);
await vis('Action').first().click();await p.waitForTimeout(2600);
await vis('Pending amount').first().click({force:true});await p.waitForTimeout(2800);
await shot('list');
R.rowsBefore=await rows();
console.log('rows before:',JSON.stringify(R.rowsBefore));
const target=R.rowsBefore.find(r=>!r.waiting);
R.target=target;
if(!target){console.log('no tickable row');}
else{
  const c0=calls.length;const t0=Date.now();
  await p.evaluate(y=>{const sc=[...document.querySelectorAll('div')].filter(e=>e.scrollHeight>e.clientHeight+40&&e.clientHeight>300)[0];if(sc)sc.scrollTop=Math.max(0,y-200);},target.y);
  await p.waitForTimeout(700);
  await p.evaluate(i=>{const rs=[...document.querySelectorAll('div[tabindex]')].filter(e=>e.offsetParent&&e.getBoundingClientRect().width>300&&/AWAITING/.test(e.innerText||''));rs[i]&&rs[i].setAttribute('data-row','1');},target.i);
  await p.locator('div[data-row]').first().click({force:true});
  await p.waitForTimeout(2600);
  R.single={apiCalls:calls.slice(c0).map(x=>x.a),msMs:Date.now()-t0,
    receiptAt2600:await receipt(),
    toastText:((await txt()).match(/(Request #\d+[^•]{0,110}|sent to an admin[^•]{0,80}|marked paid[^•]{0,80})/i)||[null])[0]};
  await shot('after-tick');
  console.log('SINGLE calls:',JSON.stringify(R.single.apiCalls),'receipt:',JSON.stringify(R.single.receiptAt2600));
  /* wait out the toast, re-measure the receipt */
  await p.waitForTimeout(7000);
  R.single.receiptAfterToast=await receipt();
  R.single.bodyAfterToast=((await txt()).match(/Request #\d+[^•]{0,110}/i)||[null])[0];
  await shot('after-toast-fade');
  console.log('receipt AFTER toast window:',JSON.stringify(R.single.receiptAfterToast));
  R.rowsAfter=await rows();
  console.log('rows after:',JSON.stringify(R.rowsAfter));
  /* try to tick the same row again */
  const c1=calls.length;
  await p.evaluate(()=>document.querySelectorAll('[data-row]').forEach(e=>e.removeAttribute('data-row')));
  await p.evaluate(i=>{const rs=[...document.querySelectorAll('div[tabindex]')].filter(e=>e.offsetParent&&e.getBoundingClientRect().width>300&&/AWAITING/.test(e.innerText||''));rs[i]&&rs[i].setAttribute('data-row','1');},target.i);
  await p.locator('div[data-row]').first().click({force:true});
  await p.waitForTimeout(2200);
  R.reTick={apiCalls:calls.slice(c1).map(x=>x.a),rowNow:(await rows())[target.i]};
  console.log('RE-TICK:',JSON.stringify(R.reTick));
  await shot('re-tick');
  /* BATCH: tick every remaining tickable row quickly */
  const c2=calls.length;
  const tickables=(await rows()).filter(r=>!r.waiting).slice(0,3);
  R.batchTargets=tickables.map(r=>r.name);
  for(const r of tickables){
    await p.evaluate(()=>document.querySelectorAll('[data-row]').forEach(e=>e.removeAttribute('data-row')));
    await p.evaluate(i=>{const rs=[...document.querySelectorAll('div[tabindex]')].filter(e=>e.offsetParent&&e.getBoundingClientRect().width>300&&/AWAITING/.test(e.innerText||''));rs[i]&&rs[i].setAttribute('data-row','1');},r.i);
    await p.locator('div[data-row]').first().click({force:true});
    await p.waitForTimeout(1500);
  }
  await p.waitForTimeout(2500);
  R.batch={apiCalls:calls.slice(c2).map(x=>x.a),receipts:await receipt()};
  console.log('BATCH calls:',JSON.stringify(R.batch.apiCalls));
  console.log('BATCH receipts:',JSON.stringify(R.batch.receipts));
  await shot('batch');
}
R.dialogs=dialogs;R.nonLocal=[...new Set(nonLocal)];
writeFileSync(`${OUT}/payout.json`,JSON.stringify(R,null,2));
console.log('native dialogs:',dialogs.length,'| non-local:',R.nonLocal.length?R.nonLocal:'none','|',OUT);
await b.close();
