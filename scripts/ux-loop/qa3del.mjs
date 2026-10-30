/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* QA r3: property-filter guard on waiting panel + delete message with/without a live ticket. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP='http://127.0.0.1:8124/', API='http://127.0.0.1:8787/';
const OUT=process.argv[2]||'/tmp/ux-out/r3-qa-delete'; mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,timezoneId:'Asia/Kolkata'});
const p=await ctx.newPage();
const dialogs=[];
p.on('dialog',async d=>{dialogs.push({type:d.type(),message:d.message()});await d.accept();});
const nonLocal=[],calls=[];
const responses=[];
p.on('response',async r=>{const u=r.url();if(u.startsWith(API)){try{responses.push({action:new URL(u).searchParams.get('action'),body:(await r.text()).slice(0,300)});}catch{}}});
p.on('request',r=>{const u=r.url();if(/^https?:/.test(u)&&!u.startsWith(API)&&!u.startsWith(APP))nonLocal.push(u.slice(0,110));if(u.startsWith(API))calls.push(u);});
let n=0; const shot=l=>p.screenshot({path:`${OUT}/${String(++n).padStart(2,'0')}-${l}.png`});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
const txt=async()=>(await p.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ');
const closeSheet=async()=>{try{await p.locator('div[aria-label="Close"]').last().click({force:true,timeout:2500});}catch{} await p.keyboard.press('Escape').catch(()=>{}); await p.waitForTimeout(700);};
const R={};
await p.goto(APP,{waitUntil:'load'});
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');
await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click(); await p.waitForTimeout(3200);
/* ── property-filter guard ── */
await vis('Report').first().click(); await p.waitForTimeout(2600);
const wait=async()=>((await txt()).match(/Waiting for approval.{0,230}/i)||[null])[0];
const kpi =async()=>((await txt()).match(/CURRENT MONTH.{0,110}/i)||[null])[0];
R.filter={All:{waiting:await wait(),kpi:await kpi()}};
for(const pr of ['Spira 3028','Spira 2212']){
  try{
    const ok=await p.evaluate(()=>{const c=[...document.querySelectorAll('div[tabindex],div')].filter(e=>e.offsetParent&&/^Property\b/.test((e.innerText||'').trim())&&(e.innerText||'').length<40&&e.getBoundingClientRect().height<60);const e=c[c.length-1];if(!e)return false;e.setAttribute('data-chip','1');return true;});
    if(!ok) throw new Error('property chip not found');
    await p.locator('div[data-chip]').first().click({force:true,timeout:6000});
    await p.evaluate(()=>document.querySelectorAll('[data-chip]').forEach(e=>e.removeAttribute('data-chip')));
    await p.waitForTimeout(1300);
    await p.getByText(pr,{exact:true}).locator('visible=true').first().click({force:true,timeout:6000});
    await p.waitForTimeout(2600);
    R.filter[pr]={waiting:await wait(),kpi:await kpi()};
  }catch(e){R.filter[pr]={err:String(e).split('\n')[0].slice(0,90)};}
  console.log(pr,'→',JSON.stringify(R.filter[pr]));
  await shot('filter-'+pr.replace(/\W/g,''));
  await closeSheet();
}
/* ── delete message ── */
await vis('Add').first().click(); await p.waitForTimeout(1600);
R.deletes=[];
for(let i=0;i<5 && R.deletes.length<2;i++){
  await vis('☰ Log').first().click({force:true}); await p.waitForTimeout(2600);
  const opened=await p.evaluate(idx=>{
    const rows=[...document.querySelectorAll('div[tabindex]')].filter(e=>{
      if(e.offsetParent===null)return false;
      const t=(e.innerText||'').trim();const r=e.getBoundingClientRect();
      return r.width>250&&/\d{4}-\d{2}-\d{2}/.test(t)&&/Spira/.test(t);});
    const e=rows[idx];if(!e)return null;e.setAttribute('data-pick','1');
    return (e.innerText||'').trim().replace(/\s+/g,' ').slice(0,60);},i);
  if(!opened)break;
  await p.locator('div[data-pick]').first().click({force:true}); await p.waitForTimeout(2600);
  await p.evaluate(()=>document.querySelectorAll('[data-pick]').forEach(e=>e.removeAttribute('data-pick')));
  const pre=await txt();
  const liveTicket=(pre.match(/Request #(\d+) is waiting/i)||[])[1]||null;
  await p.evaluate(()=>{[...document.querySelectorAll('div')].filter(e=>e.scrollHeight>e.clientHeight+50&&e.clientHeight>300).forEach(e=>e.scrollTop=e.scrollHeight);});
  await p.waitForTimeout(700);
  const d0=dialogs.length, c0=calls.length, t0=Date.now();
  let err=null;
  try{ await p.getByText('Request delete',{exact:false}).locator('visible=true').first().click({force:true,timeout:6000}); }
  catch(e){ err=String(e).split('\n')[0].slice(0,80); }
  const toasts=[];
  for(let k=0;k<12;k++){await p.waitForTimeout(350);const t=await txt();const m=t.match(/(Delete booking[^•]{0,170})/i);if(m)toasts.push(m[0]);}
  const after=await txt();
  R.deletes.push({row:opened,liveTicketBefore:liveTicket,err,
    dialog:dialogs.slice(d0),
    apiCalls:calls.slice(c0).map(u=>new URL(u).searchParams.get('action')),
    ms:Date.now()-t0,
    toasts:[...new Set(toasts)],
    apiResponses:responses.slice(-6).map(r=>r.action+': '+r.body.slice(0,160)),
    resultMsg:(after.match(/(Delete booking [^•]{0,150}|Booking deleted[^•]{0,80}|request #\d+[^•]{0,110})/i)||[null])[0]});
  console.log('DELETE',JSON.stringify(R.deletes.at(-1),null,1));
  await shot('after-delete'+i);
  try{await vis('Cancel edit').first().click({force:true,timeout:4000});}catch{}
  await p.waitForTimeout(1200);
}
R.nonLocal=[...new Set(nonLocal)];
writeFileSync(`${OUT}/delete.json`,JSON.stringify(R,null,2));
console.log('non-local:',R.nonLocal.length?R.nonLocal:'none','|',OUT);
await b.close();
