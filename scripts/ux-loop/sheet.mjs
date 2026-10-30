/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const APP='http://127.0.0.1:8124/', API='http://127.0.0.1:8787/';
const out='/tmp/ux-out/r1-qa-sheet'; mkdirSync(out,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage();
const calls=[]; p.on('response',r=>{if(r.url().startsWith(API))calls.push(new URL(r.url()).searchParams.get('action'))});
await p.goto(APP,{waitUntil:'load'}); await p.waitForTimeout(600);
const sk=p.getByText('Skip').locator('visible=true'); if(await sk.count()){await sk.first().click();await p.waitForTimeout(900);}
await p.getByPlaceholder('Username').fill('manager');
await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await p.getByText('Unlock').locator('visible=true').first().click();
await p.waitForTimeout(3000);
await p.getByText('Report',{exact:true}).locator('visible=true').last().click();
await p.waitForTimeout(1200);
await p.screenshot({path:`${out}/a-report.png`});
// open the Range select
await p.getByText('All time',{exact:true}).locator('visible=true').first().click();
await p.waitForTimeout(1200);
await p.screenshot({path:`${out}/b-range-sheet-open.png`});
const info = await p.evaluate(()=>{
  const opt=[...document.querySelectorAll('*')].filter(e=>!e.children.length&&(e.textContent||'').trim()==='Last 30 days')[0];
  if(!opt) return {noOption:true};
  const r=opt.getBoundingClientRect();
  const cx=r.x+r.width/2, cy=r.y+r.height/2;
  const stack=document.elementsFromPoint(cx,cy).slice(0,6).map(e=>({tag:e.tagName, aria:e.getAttribute('aria-label'), cls:(e.className||'').toString().slice(0,60), txt:(e.textContent||'').trim().slice(0,30), z:getComputedStyle(e).zIndex, pe:getComputedStyle(e).pointerEvents}));
  return {rect:{x:+r.x.toFixed(0),y:+r.y.toFixed(0),w:+r.width.toFixed(0),h:+r.height.toFixed(0)}, topIsOption: stack[0]&&stack[0].txt==='Last 30 days', stack};
});
console.log(JSON.stringify(info,null,2));
// try a real touch tap at those coords
const before=calls.length;
if(info.rect){ await p.mouse.click(info.rect.x+info.rect.w/2, info.rect.y+info.rect.h/2); }
await p.waitForTimeout(1800);
await p.screenshot({path:`${out}/c-after-tap-option.png`});
const txt=await p.evaluate(()=>document.body.innerText);
console.log('range now:', txt.split('\n').filter(l=>/Last 30|All time|Overall|Custom/.test(l)).slice(0,5));
console.log('calls fired by option tap:', calls.slice(before));
await b.close();
