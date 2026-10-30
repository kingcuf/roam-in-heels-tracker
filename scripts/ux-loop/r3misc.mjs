/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* r3: delete message (with/without live ticket), waiting-panel bbox at first paint,
   Add-Expense taps + category picker filter, FormScroll props on web. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP='http://127.0.0.1:8124/', API='http://127.0.0.1:8787/';
const OUT=process.argv[2]||'/tmp/ux-out/r3-qa-misc'; mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,timezoneId:'Asia/Kolkata'});
const p=await ctx.newPage();
const nonLocal=[]; p.on('request',r=>{const u=r.url();if(/^https?:/.test(u)&&!u.startsWith(API)&&!u.startsWith(APP))nonLocal.push(u.slice(0,110));});
let n=0; const shot=l=>p.screenshot({path:`${OUT}/${String(++n).padStart(2,'0')}-${l}.png`});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
const txt=async()=>(await p.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ');
const R={};
await p.goto(APP,{waitUntil:'load'});
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');
await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click(); await p.waitForTimeout(3200);

/* ── 1. WAITING PANEL bounding box at FIRST PAINT of Report ── */
await vis('Report').first().click();
await p.waitForTimeout(2500);
R.waitingPanel = await p.evaluate(()=>{
  const out=[];
  for(const el of document.querySelectorAll('div')){
    if(el.offsetParent===null) continue;
    if(getComputedStyle(el).backgroundColor!=='rgb(248, 241, 228)') continue;
    const r=el.getBoundingClientRect(); if(r.width<150||r.height<24) continue;
    out.push({top:Math.round(r.top),bottom:Math.round(r.bottom),h:Math.round(r.height),w:Math.round(r.width),
      text:(el.innerText||'').trim().replace(/\s+/g,' ').slice(0,180)});
  }
  const dedup=out.filter((a,i)=>!out.some((c,j)=>j!==i&&c.top<=a.top&&c.bottom>=a.bottom&&c.h>a.h));
  const sc=[...document.querySelectorAll('div')].filter(e=>e.scrollHeight>e.clientHeight+20&&e.clientHeight>300);
  return {panels:dedup, viewportH:window.innerHeight, scrollers:sc.map(e=>({clientH:e.clientHeight,scrollH:e.scrollHeight,scrollTop:e.scrollTop}))};
});
console.log('waiting panel:',JSON.stringify(R.waitingPanel,null,1));
await shot('report-firstpaint');
/* KPI leak guard */
R.reportKpis = (await txt()).match(/CURRENT MONTH.{0,220}/i);
R.cashLine = (await txt()).match(/Bank.{0,120}/i);
console.log('KPIs:',R.reportKpis&&R.reportKpis[0]);

/* property filter guard */
R.filter={};
try{
  const props=['Spira 3028','Spira 2212'];
  for(const pr of props){
    const sel=p.getByText(pr,{exact:false}).locator('visible=true').first();
    await sel.click({force:true}); await p.waitForTimeout(2200);
    const t=await txt();
    R.filter[pr]={waiting:(t.match(/Waiting for approval.{0,200}/i)||[null])[0], kpi:(t.match(/CURRENT MONTH.{0,160}/i)||[null])[0]};
    console.log(pr,'→',JSON.stringify(R.filter[pr]));
  }
}catch(e){R.filter.err=String(e).slice(0,120);}
await shot('report-filtered');

/* ── 2. FormScroll props on web ── */
await vis('Add').first().click(); await p.waitForTimeout(1500);
R.formScroll = await p.evaluate(()=>{
  const sc=[...document.querySelectorAll('div')].filter(e=>{const s=getComputedStyle(e);return /auto|scroll/.test(s.overflowY)&&e.clientHeight>200;});
  return sc.map(e=>{const s=getComputedStyle(e);const r=e.getBoundingClientRect();
    return {clientH:e.clientHeight,scrollH:e.scrollHeight,overflowY:s.overflowY,
      padTop:s.paddingTop,padBottom:s.paddingBottom,
      overscroll:s.overscrollBehavior,touchAction:s.touchAction,
      y:Math.round(r.top),h:Math.round(r.height),
      attrs:[...e.attributes].map(a=>a.name).join(',')};});
});
console.log('form scrollers:',JSON.stringify(R.formScroll,null,1));
/* tap-through-while-keyboard-open proxy: does a tap on a picker work without a prior blur? */
await p.getByText('Expense',{exact:true}).locator('visible=true').first().click({force:true});
await p.waitForTimeout(1200);
await p.getByPlaceholder('e.g. Monthly rent').first().click();
await p.getByPlaceholder('e.g. Monthly rent').first().type('persist taps test',{delay:10});
const t0=Date.now();
await p.locator('text=Select…').locator('visible=true').first().click({force:true});
await p.waitForTimeout(1500);
R.persistTaps={sheetOpenedWithFieldFocused:await p.evaluate(()=>/Search|Caretaker|Utilities/.test(document.body.innerText)),ms:Date.now()-t0};
console.log('persistTaps',JSON.stringify(R.persistTaps));
await shot('category-sheet');

/* ── 3. category picker: filter box + Utilities reachable ── */
R.picker = await p.evaluate(()=>{
  const ins=[...document.querySelectorAll('input')].filter(e=>e.offsetParent!==null);
  const ph=ins.map(e=>e.placeholder||e.type);
  const body=document.body.innerText;
  return {inputsInSheet:ph, hasUtilitiesInDom:/Utilities/.test(body), optionCount:(body.match(/\n/g)||[]).length};
});
console.log('picker:',JSON.stringify(R.picker));
const tapU=async()=>{const s=Date.now();try{await p.getByText('Utilities',{exact:true}).locator('visible=true').first().click({force:true,timeout:8000});return{ok:true,ms:Date.now()-s};}catch(e){return{ok:false,ms:Date.now()-s,err:String(e).slice(0,60)};}};
R.tapUtilitiesDirect=await tapU();
console.log('tap Utilities (no filter):',JSON.stringify(R.tapUtilitiesDirect));
await shot('after-utilities');
R.afterPick=(await txt()).match(/Utilities/)?'Utilities selected':'not selected';

R.nonLocal=[...new Set(nonLocal)];
writeFileSync(`${OUT}/misc.json`,JSON.stringify(R,null,2));
console.log('non-local:',R.nonLocal.length?R.nonLocal:'none','|',OUT);
await b.close();
