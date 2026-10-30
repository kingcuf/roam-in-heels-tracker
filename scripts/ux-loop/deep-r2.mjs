/* Round-1 deep probe: state loss (real input VALUES), save→confirmation
   latency, report-control refetch, and intro gate. Local only. */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const APP='http://127.0.0.1:8124/', API='http://127.0.0.1:8787/';
const out='/tmp/ux-out/r2-qa-deep'; mkdirSync(out,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,
  userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'});
const p=await ctx.newPage();
const calls=[]; let bytes=0;
p.on('response', async r=>{ if(!r.url().startsWith(API))return; const u=new URL(r.url());
  let n=0; try{n=(await r.body()).length}catch{}; bytes+=n;
  calls.push({action:u.searchParams.get('action'),bytes:n,at:Date.now()}); });
const R={};
const mark=()=>calls.length;
const since=(i)=>calls.slice(i);

/* ---- intro gate: how long before the app is usable if you do NOT skip ---- */
const tGo=Date.now();
await p.goto(APP,{waitUntil:'load'});
const loadMs=Date.now()-tGo;
const perf=await p.evaluate(()=>{const e=performance.getEntriesByType('navigation')[0]||{};
  const fcp=performance.getEntriesByName('first-contentful-paint')[0];
  const res=performance.getEntriesByType('resource');
  const js=res.filter(r=>/\.js(\?|$)/.test(r.name));
  return {fcp:Math.round(fcp?fcp.startTime:0), dcl:Math.round(e.domContentLoaded||0), load:Math.round(e.loadEventEnd||0),
    jsFiles:js.length, jsDecodedKB:Math.round(js.reduce((a,r)=>a+(r.decodedBodySize||0),0)/1024),
    jsTransferKB:Math.round(js.reduce((a,r)=>a+(r.transferSize||0),0)/1024),
    totalDecodedKB:Math.round(res.reduce((a,r)=>a+(r.decodedBodySize||0),0)/1024)};});
const tIntro=Date.now();
// wait for the sign-in field to become usable without pressing Skip
let introToUsable=null;
try{ await p.getByPlaceholder('Username').waitFor({state:'visible',timeout:30000});
     await p.waitForFunction(()=>{const el=[...document.querySelectorAll('input')].find(i=>i.placeholder==='Username');
       if(!el) return false; const r=el.getBoundingClientRect();
       const top=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2);
       return top===el||el.contains(top);},{timeout:30000});
     introToUsable=Date.now()-tIntro; }catch(e){ introToUsable='>30000 ('+e.message.slice(0,40)+')'; }
R.cold={loadMs, perf, introToUsableMs:introToUsable};
await p.screenshot({path:`${out}/01-intro-gate-cleared.png`});

/* skip-control presence/size */
R.skip=await p.evaluate(()=>{const els=[...document.querySelectorAll('*')].filter(e=>!e.children.length&&(e.textContent||'').trim()==='Skip');
  return els.map(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);
    return {w:+r.width.toFixed(0),h:+r.height.toFixed(0),fontSize:cs.fontSize,color:cs.color};});});

/* ---- sign in ---- */
let i=mark(); const tSign=Date.now();
await p.getByPlaceholder('Username').fill('manager');
await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await p.getByText('Unlock').locator('visible=true').first().click();
await p.getByText('need attention',{exact:false}).locator('visible=true').first().waitFor({timeout:15000});
R.signIn={toFirstUsefulScreenMs:Date.now()-tSign, calls:since(i).map(c=>({a:c.action,kb:+(c.bytes/1024).toFixed(1)}))};
await p.waitForTimeout(1500);

/* ---- state loss: read real input VALUES ---- */
const setField=async(label,val)=>{
  const lab=p.getByText(label,{exact:false}).locator('visible=true').first();
  await lab.waitFor({timeout:8000});
  const inp=lab.locator('xpath=./following::input[1]|./following::textarea[1]').first();
  await inp.fill(val);
};
const readField=async(label)=>{
  const lab=p.getByText(label,{exact:false}).locator('visible=true').first();
  const inp=lab.locator('xpath=./following::input[1]|./following::textarea[1]').first();
  return await inp.inputValue();
};
const tapTab=async(t)=>{ await p.getByText(t,{exact:true}).locator('visible=true').last().click(); await p.waitForTimeout(700); };
const tapSeg=async(t)=>{ await p.getByText(t,{exact:true}).locator('visible=true').first().click(); await p.waitForTimeout(700); };

await tapTab('Add');
await setField('Stay unit','UXUNIT9');
await setField('Net earned','7777');
const before={stayUnit:await readField('Stay unit'), net:await readField('Net earned')};
await tapTab('Report'); await tapTab('Add');
const afterTab={stayUnit:await readField('Stay unit'), net:await readField('Net earned')};
await tapSeg('Expense');
await setField('Item / Description','ux draft expense');
const expBefore=await readField('Item / Description');
await tapSeg('Booking');
const afterSeg={stayUnit:await readField('Stay unit'), net:await readField('Net earned')};
await tapSeg('Expense');
const expAfter=await readField('Item / Description');
R.stateLoss={before,afterTab,expBefore,expAfter,afterSeg,
  tabSwitchKept: before.stayUnit===afterTab.stayUnit && before.net===afterTab.net,
  segSwitchKept: expBefore===expAfter && before.stayUnit===afterSeg.stayUnit};
await p.screenshot({path:`${out}/02-after-tab-roundtrip.png`});

/* reload survival */
await p.reload({waitUntil:'load'});
await p.waitForTimeout(2500);
const sk=p.getByText('Skip',{exact:false}).locator('visible=true');
if(await sk.count()) { await sk.first().click(); await p.waitForTimeout(1500); }
await p.waitForTimeout(2500);
let reloadState='unknown';
try{ await p.getByText('need attention',{exact:false}).locator('visible=true').first().waitFor({timeout:8000}); reloadState='still signed in'; }
catch{ reloadState='signed out'; }
let draftAfterReload=null;
if(reloadState==='still signed in'){ await tapTab('Add'); try{draftAfterReload=await readField('Stay unit')}catch{draftAfterReload='n/a'} }
R.reload={reloadState,draftAfterReload};

/* ---- save -> confirmation latency ---- */
await tapTab('Add');
await setField('Net earned','1234');
let j=mark(); const tSave=Date.now();
await p.getByText('Submit for approval',{exact:false}).locator('visible=true').first().click();
let confirmMs=null, confirmText=null;
try{
  await p.waitForFunction(()=>{const t=document.body.innerText;
    return /request|submitted|approval sent|Saved|sent for approval/i.test(t.split('Submit for approval').join(''));},{timeout:15000});
  confirmMs=Date.now()-tSave;
  confirmText=(await p.evaluate(()=>document.body.innerText)).split('\n').filter(l=>/request|submit|saved|approval/i.test(l)).slice(0,6);
}catch(e){ confirmMs='timeout'; }
await p.waitForTimeout(2500);
R.saveBooking={confirmMs, confirmText, calls:since(j).map(c=>({a:c.action,kb:+(c.bytes/1024).toFixed(1),dt:c.at-tSave}))};
await p.screenshot({path:`${out}/03-after-save.png`});

/* ---- report controls: refetch per control change ---- */
await tapTab('Report');
await p.waitForTimeout(800);
const tapText=async(label)=>{ const box=await p.evaluate((lb)=>{
    const e=[...document.querySelectorAll('*')].filter(x=>!x.children.length&&(x.textContent||'').trim()===lb)
      .find(x=>{const r=x.getBoundingClientRect();return r.width&&r.height&&r.top>=0&&r.bottom<=innerHeight;});
    if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};},label);
  if(!box) return false; await p.mouse.click(box.x,box.y); return true; };
const rngProbe=async(label)=>{ const k=mark(); const t=Date.now();
  if(!(await tapText(label))) return {label,missing:true};
  await p.waitForTimeout(1500);
  return {label, ms:Date.now()-t, calls:since(k).map(c=>({a:c.action,kb:+(c.bytes/1024).toFixed(1)}))}; };
R.report=[];
R.report.push(await rngProbe('All time'));          // opens the Range sheet
R.report.push(await rngProbe('Last 30 days'));      // picks an option
await p.waitForTimeout(800);
R.report.push(await rngProbe('Last 30 days'));      // reopen sheet
R.report.push(await rngProbe('Last 7 days'));
await p.screenshot({path:`${out}/04-report.png`});

/* ---- tab switch refetch matrix (already warm) ---- */
R.tabSwitch=[];
for(const t of ['Action','Calendar','Report','Add','Team','Action','Calendar']){
  const k=mark(); const t0=Date.now();
  await p.getByText(t,{exact:true}).locator('visible=true').last().click();
  await p.waitForTimeout(1200);
  R.tabSwitch.push({to:t, ms:Date.now()-t0, calls:since(k).map(c=>({a:c.action,kb:+(c.bytes/1024).toFixed(1)}))});
}

/* ---- depth to pending payouts + requests ---- */
await tapTab('Action');
const k1=mark(); const tp=Date.now();
await p.getByText('Pending amount',{exact:false}).locator('visible=true').first().click();
await p.waitForTimeout(1200);
R.payouts={ms:Date.now()-tp, calls:since(k1).map(c=>c.action),
  screen:(await p.evaluate(()=>document.body.innerText)).split('\n').map(s=>s.trim()).filter(Boolean).slice(0,25)};
await p.screenshot({path:`${out}/05-payouts.png`});
// is there a way back?
R.payoutsBack=await p.evaluate(()=>{const t=[...document.querySelectorAll('*')].filter(e=>!e.children.length).map(e=>(e.textContent||'').trim());
  return t.filter(x=>x==='‹'||/back/i.test(x)).slice(0,5);});

R.total={apiCalls:calls.length, apiKB:+(bytes/1024).toFixed(1)};
writeFileSync(`${out}/deep.json`, JSON.stringify(R,null,2));
console.log(JSON.stringify(R,null,2));
await b.close();
