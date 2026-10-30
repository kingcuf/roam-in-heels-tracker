/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* FormScroll regression watch: scroller geometry + tap-through-focus on every form tab. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP=process.argv[2]||'http://127.0.0.1:8124/', API='http://127.0.0.1:8787/';
const OUT=process.argv[3]||'/tmp/ux-out/r3-qa-scroll'; mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,timezoneId:'Asia/Kolkata'});
const p=await ctx.newPage();
const nonLocal=[];p.on('request',r=>{const u=r.url();if(/^https?:/.test(u)&&!u.startsWith(API)&&!u.startsWith(APP))nonLocal.push(u.slice(0,110));});
let n=0;const shot=l=>p.screenshot({path:`${OUT}/${String(++n).padStart(2,'0')}-${l}.png`});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
const R={app:APP,forms:{}};
await p.goto(APP,{waitUntil:'load'});
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');
await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3200);
await vis('Add').first().click();await p.waitForTimeout(1600);
const geom=()=>p.evaluate(()=>{
  const sc=[...document.querySelectorAll('div')].filter(e=>{const s=getComputedStyle(e);return /auto|scroll/.test(s.overflowY)&&e.clientHeight>200;});
  return sc.map(e=>{const s=getComputedStyle(e);const r=e.getBoundingClientRect();
    return{clientH:e.clientHeight,scrollH:e.scrollHeight,overflowY:s.overflowY,padTop:s.paddingTop,padBottom:s.paddingBottom,
      overscroll:s.overscrollBehavior,touchAction:s.touchAction,webkitOverflowScrolling:s.webkitOverflowScrolling||null,
      top:Math.round(r.top),h:Math.round(r.height)};});});
for(const seg of ['Booking','Expense','Saving','Inventory']){
  try{await p.getByText(seg,{exact:true}).locator('visible=true').first().click({force:true});}catch{}
  await p.waitForTimeout(1400);
  const g=await geom();
  /* scroll to bottom, measure reachable extent */
  const sres=await p.evaluate(()=>{const sc=[...document.querySelectorAll('div')].filter(e=>{const s=getComputedStyle(e);return /auto|scroll/.test(s.overflowY)&&e.clientHeight>200;});
    if(!sc.length)return null;const e=sc[0];e.scrollTop=e.scrollHeight;return{scrollTopAfter:Math.round(e.scrollTop),max:Math.round(e.scrollHeight-e.clientHeight)};});
  await p.waitForTimeout(500);
  /* tap-through-focus: focus a text input then tap a picker in one go */
  let persist=null;
  try{
    const inp=p.locator('input:not([type=date])').locator('visible=true').first();
    await inp.click(); await inp.type('x',{delay:10}); await p.waitForTimeout(250);
    const t0=Date.now();
    await p.locator('text=▾').locator('visible=true').first().click({force:true,timeout:6000});
    await p.waitForTimeout(1200);
    persist={opened:await p.evaluate(()=>/Search \d+ options|Close/.test(document.body.innerText)||!!document.querySelector('div[aria-label="Close"]')),ms:Date.now()-t0};
    try{await p.locator('div[aria-label="Close"]').last().click({force:true,timeout:2500});}catch{}
    await p.keyboard.press('Escape').catch(()=>{});await p.waitForTimeout(600);
  }catch(e){persist={err:String(e).split('\n')[0].slice(0,70)};}
  R.forms[seg]={scrollers:g,scrollToBottom:sres,tapThroughFocus:persist};
  console.log(seg,JSON.stringify(R.forms[seg]));
  await shot(seg);
}
R.nonLocal=[...new Set(nonLocal)];
writeFileSync(`${OUT}/scroll.json`,JSON.stringify(R,null,2));
console.log('non-local:',R.nonLocal.length?R.nonLocal:'none','|',OUT);
await b.close();
