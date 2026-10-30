/* 390px layout probe: edit-form action row button boxes + page overflow on 5 tabs. */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const APP='http://127.0.0.1:8124/';
const out=process.env.OUT||'/tmp/ux-out/r2-qa-layout'; mkdirSync(out,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage(); const R={}; let shot=0;
const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200))});
const snap=async n=>p.screenshot({path:`${out}/${String(++shot).padStart(2,'0')}-${n}.png`});
await p.goto(APP,{waitUntil:'load'});
const sk=p.getByText('Skip',{exact:false}).locator('visible=true'); if(await sk.count()) await sk.first().click();
await p.getByPlaceholder('Username').waitFor({timeout:20000});
await p.getByPlaceholder('Username').fill('manager'); await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await p.getByText('Unlock').locator('visible=true').first().click();
await p.getByText('need attention').locator('visible=true').first().waitFor({timeout:15000});
await p.waitForTimeout(2500);

/* overflow on the five tabs */
R.overflow=[];
for(const t of ['Action','Calendar','Report','Add','Team']){
  await p.getByText(t,{exact:true}).locator('visible=true').last().click(); await p.waitForTimeout(1200);
  const o=await p.evaluate(()=>{ window.scrollTo(400,0); const sx=window.scrollX; window.scrollTo(0,0);
    const de=document.documentElement;
    let worst=null;
    for(const e of document.querySelectorAll('*')){ const r=e.getBoundingClientRect();
      if(r.width&&r.height&&r.right>390.5&&(e.textContent||'').trim())
        if(!worst||r.right>worst.right) worst={right:+r.right.toFixed(1),txt:(e.textContent||'').trim().slice(0,40)}; }
    return {clientWidth:de.clientWidth, scrollWidth:de.scrollWidth, scrollXAfter400:sx, worstRight:worst}; });
  R.overflow.push({tab:t,...o}); await snap('tab-'+t);
}

/* open a booking for edit and measure the action-row buttons */
await p.getByText('Add',{exact:true}).locator('visible=true').last().click(); await p.waitForTimeout(900);
await p.getByText('Log',{exact:false}).locator('visible=true').first().click(); await p.waitForTimeout(1600);
await p.getByText('2026-08-11',{exact:true}).locator('visible=true').first().click(); await p.waitForTimeout(1800);
R.onEditForm=await p.evaluate(()=>/Edit Booking/i.test(document.body.innerText));
await snap('edit-form');
R.actionRow=await p.evaluate(()=>{
  const words=['Submit for approval','Save changes','Cancel edit','Request delete','Delete','☰ Log','Log'];
  const seen=[];
  for(const e of document.querySelectorAll('*')){
    const t=(e.textContent||'').trim();
    if(!words.includes(t)) continue;
    if(e.children.length) continue;                       // leaf text node only
    const r=e.getBoundingClientRect();
    if(!r.width||!r.height) continue;
    // nearest pressable ancestor
    let a=e, hops=0;
    while(a.parentElement&&hops<6){ const s=getComputedStyle(a);
      if(a.getAttribute('role')==='button'||a.tabIndex>=0||s.cursor==='pointer') break; a=a.parentElement; hops++; }
    const ar=a.getBoundingClientRect();
    seen.push({label:t, fullText:e.textContent, textBox:{x:+r.x.toFixed(1),w:+r.width.toFixed(1),right:+r.right.toFixed(1)},
      btnBox:{x:+ar.x.toFixed(1),y:+ar.y.toFixed(1),w:+ar.width.toFixed(1),h:+ar.height.toFixed(1),right:+ar.right.toFixed(1)},
      insideViewport: ar.x>=-0.5 && ar.right<=390.5,
      clipped: r.width < e.scrollWidth-1 || /…$/.test(t),
      scrollW:e.scrollWidth});
  }
  return seen;});
R.submitVisibleLabel=await (async()=>{ const l=p.getByText('Submit for approval',{exact:false}).locator('visible=true').first();
  return (await l.count())? (await l.innerText()) : null; })();
// crop of the action row
const box=R.actionRow.find(x=>/Submit/.test(x.label))?.btnBox;
if(box) await p.screenshot({path:`${out}/${String(++shot).padStart(2,'0')}-submit-row.png`,
   clip:{x:0,y:Math.max(0,box.y-30),width:390,height:Math.min(140,844-Math.max(0,box.y-30))}});
R.consoleErrors=errs;
writeFileSync(`${out}/layout.json`,JSON.stringify(R,null,2));
console.log(JSON.stringify(R,null,1));
await b.close();
