/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage();
const snap=async(tag)=>console.log(tag, await p.evaluate(()=>({inner:innerWidth,clientW:document.documentElement.clientWidth,scrollW:document.documentElement.scrollWidth,scale:visualViewport&&+visualViewport.scale.toFixed(3),vvw:visualViewport&&Math.round(visualViewport.width)})));
await p.goto('http://127.0.0.1:8124/',{waitUntil:'load'});
await p.waitForTimeout(600); await snap('loaded');
const sk=p.getByText('Skip').locator('visible=true'); if(await sk.count()){await sk.first().click();await p.waitForTimeout(900);}
await snap('after-skip');
await p.getByPlaceholder('Username').fill('manager');
await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await snap('typed');
await p.getByText('Unlock').locator('visible=true').first().click();
for (const ms of [300,800,1500,3000,5000]) { await p.waitForTimeout(ms===300?300:ms-0); await snap('after-unlock+'+ms); }
console.log(await p.evaluate(()=>{const o=[];document.querySelectorAll('*').forEach(e=>{const r=e.getBoundingClientRect();
  if(r.width>document.documentElement.clientWidth+1 && r.width<3000){const cs=getComputedStyle(e);
   let par=e.parentElement,inS=false;while(par){if(/(auto|scroll)/.test(getComputedStyle(par).overflowX)){inS=true;break}par=par.parentElement}
   if(!inS)o.push({tag:e.tagName,w:Math.round(r.width),left:Math.round(r.left),right:Math.round(r.right),pos:cs.position,txt:(e.textContent||'').trim().slice(0,30)})}});
  return o.slice(0,12)}));
await p.screenshot({path:'/tmp/ux-out/r1-qa-overflow/zoomcheck.png'});
await b.close();
