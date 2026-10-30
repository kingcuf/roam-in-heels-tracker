/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* r4 #1 (correct flow): tick cards, then press "Mark N paid · ₹X". */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP=process.argv[2]||'http://127.0.0.1:8124/',API='http://127.0.0.1:8787/';
const OUT=process.argv[3]||'/tmp/ux-out/r4-qa-payout2';const WHO=process.argv[4]||'manager';const N=Number(process.argv[5]||1);
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
const R={app:APP,who:WHO,ticks:N};
const rows=()=>p.evaluate(()=>[...document.querySelectorAll('div[tabindex]')].filter(e=>e.offsetParent&&e.getBoundingClientRect().width>300&&/AWAITING/.test(e.innerText||'')).map((e,i)=>{
  const t=(e.innerText||'').replace(/\s+/g,' ');
  return{i,name:(t.match(/^\S\s+([A-Za-z ]+?)\s+(Stay|Resold)/)||[null,'?'])[1],
    waiting:/WAITING FOR APPROVAL/.test(t),req:(t.match(/Request #(\d+)/)||[null,null])[1],
    state:/Ticked — will be marked paid/.test(t)?'ticked':(/Already asked for/.test(t)?'already asked':'untouched')};}));
const amber=()=>p.evaluate(()=>{const out=[];
  for(const el of document.querySelectorAll('div')){if(!el.offsetParent)continue;
    if(getComputedStyle(el).backgroundColor!=='rgb(248, 241, 228)')continue;
    const r=el.getBoundingClientRect();if(r.width<150||r.height<24)continue;
    out.push({y:Math.round(r.top),b:Math.round(r.bottom),h:Math.round(r.height),w:Math.round(r.width),inView:r.top>=0&&r.bottom<=window.innerHeight,text:(el.innerText||'').trim().replace(/\s+/g,' ').slice(0,190)});}
  return out.filter((a,i)=>!out.some((c,j)=>j!==i&&c.y<=a.y&&c.b>=a.b&&c.h>a.h));});
await p.goto(APP,{waitUntil:'load'});
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1500);}catch{}
const c=CREDS[WHO];
if(c.u) await p.getByPlaceholder('Username').first().fill(c.u);
await p.getByPlaceholder('PIN').first().fill(c.p);
await vis('Unlock').first().click();await p.waitForTimeout(3600);
await vis('Action').first().click();await p.waitForTimeout(2600);
const cLogsBefore=calls.filter(x=>x.a==='logs').length;
await vis('Pending amount').first().click({force:true});await p.waitForTimeout(2800);
await shot('list');
R.rowsBefore=await rows();
const targets=R.rowsBefore.filter(r=>!r.waiting).slice(0,N);
R.targets=targets.map(t=>t.name);
console.log('targets:',JSON.stringify(R.targets));
for(const t of targets){
  await p.evaluate(()=>document.querySelectorAll('[data-row]').forEach(e=>e.removeAttribute('data-row')));
  await p.evaluate(i=>{const rs=[...document.querySelectorAll('div[tabindex]')].filter(e=>e.offsetParent&&e.getBoundingClientRect().width>300&&/AWAITING/.test(e.innerText||''));if(rs[i]){rs[i].setAttribute('data-row','1');rs[i].scrollIntoView({block:'center'});}},t.i);
  await p.waitForTimeout(500);
  await p.locator('div[data-row]').first().click({force:true});
  await p.waitForTimeout(900);
}
R.afterTicks={rows:await rows(),header:((await txt()).match(/\d+ ticked · ₹[\d,]+/)||[null])[0],
  apiCallsWhileTicking:calls.slice(calls.length-0).map(x=>x.a)};
await shot('ticked');
const markBtn=await p.evaluate(()=>{const e=[...document.querySelectorAll('*')].filter(x=>x.offsetParent&&/^Mark \d+ paid · ₹[\d,]+$/.test((x.innerText||'').trim()));const t=e[e.length-1];if(!t)return null;t.setAttribute('data-mark','1');const r=t.getBoundingClientRect();return{label:(t.innerText||'').trim(),x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};});
R.markButton=markBtn;
console.log('ticked header:',R.afterTicks.header,'| button:',JSON.stringify(markBtn));
const c0=calls.length,t0=Date.now();
await p.locator('[data-mark]').first().click({force:true});
await p.waitForTimeout(2600);
R.press={apiCalls:calls.slice(c0).map(x=>x.a),ms:Date.now()-t0,
  amberAt2600:await amber(),
  toast:((await txt()).match(/(Request #\d+[^•]{0,120}|requests? sent[^•]{0,90}|marked paid[^•]{0,90})/i)||[null])[0]};
await shot('after-press');
console.log('PRESS calls:',JSON.stringify(R.press.apiCalls));
console.log('amber @2.6s:',JSON.stringify(R.press.amberAt2600));
console.log('toast:',R.press.toast);
await p.waitForTimeout(8000);
R.after10s={amber:await amber(),rows:await rows(),
  hasViewRequest:/View request/i.test(await txt()),hasDismiss:/Dismiss/i.test(await txt())};
await shot('after-10s');
console.log('amber @10.6s:',JSON.stringify(R.after10s.amber));
console.log('rows after:',JSON.stringify(R.after10s.rows));
console.log('View request present:',R.after10s.hasViewRequest,'| Dismiss present:',R.after10s.hasDismiss);
/* re-tick a row that now has a request */
const done=(await rows()).find(r=>r.waiting);
if(done){
  const c1=calls.length;
  await p.evaluate(()=>document.querySelectorAll('[data-row]').forEach(e=>e.removeAttribute('data-row')));
  await p.evaluate(i=>{const rs=[...document.querySelectorAll('div[tabindex]')].filter(e=>e.offsetParent&&e.getBoundingClientRect().width>300&&/AWAITING/.test(e.innerText||''));if(rs[i]){rs[i].setAttribute('data-row','1');rs[i].scrollIntoView({block:'center'});}},done.i);
  await p.waitForTimeout(400);
  await p.locator('div[data-row]').first().click({force:true});
  await p.waitForTimeout(1600);
  R.reTickWaitingRow={row:done.name,req:done.req,apiCalls:calls.slice(c1).map(x=>x.a),
    stateNow:(await rows())[done.i],headerNow:((await txt()).match(/\d+ ticked · ₹[\d,]+/)||[null])[0],
    markButtonNow:await p.evaluate(()=>{const e=[...document.querySelectorAll('*')].filter(x=>x.offsetParent&&/^Mark \d+ paid/.test((x.innerText||'').trim()));return e.length?(e[e.length-1].innerText||'').trim():null;})};
  console.log('RE-TICK a waiting row:',JSON.stringify(R.reTickWaitingRow));
  await shot('retick-waiting');
  /* follow through: press Mark again and see whether a SECOND request is raised for the same booking */
  const c2=calls.length;
  const mk=await p.evaluate(()=>{const e=[...document.querySelectorAll('*')].filter(x=>x.offsetParent&&/^Mark \d+ paid · ₹[\d,]+$/.test((x.innerText||'').trim()));const t=e[e.length-1];if(!t)return null;t.setAttribute('data-mark2','1');return (t.innerText||'').trim();});
  if(mk){
    await p.locator('[data-mark2]').first().click({force:true});
    await p.waitForTimeout(3000);
    R.reTickPress={button:mk,apiCalls:calls.slice(c2).map(x=>x.a),
      amber:await amber(),
      msg:((await txt()).match(/(Change to payout[^•]{0,150}|Request #\d+[^•]{0,110})/i)||[null])[0]};
    console.log('RE-TICK PRESS:',JSON.stringify(R.reTickPress.apiCalls),'|',R.reTickPress.msg);
    await shot('retick-press');
  }
}
R.logsCallsTotal=calls.filter(x=>x.a==='logs').length;
R.allCalls=calls.map(x=>x.a);
R.dialogs=dialogs;R.nonLocal=[...new Set(nonLocal)];
writeFileSync(`${OUT}/payout.json`,JSON.stringify(R,null,2));
console.log('all calls:',JSON.stringify(R.allCalls));
console.log('native dialogs:',dialogs.length,'| non-local:',R.nonLocal.length?R.nonLocal:'none','|',OUT);
await b.close();
