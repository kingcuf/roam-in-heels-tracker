/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage();
await p.goto('http://127.0.0.1:8124/',{waitUntil:'load'}); await p.waitForTimeout(600);
const sk=p.getByText('Skip').locator('visible=true'); if(await sk.count()){await sk.first().click();await p.waitForTimeout(900);}
await p.getByPlaceholder('Username').fill('manager'); await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await p.getByText('Unlock').locator('visible=true').first().click(); await p.waitForTimeout(3000);
const chk=async(n)=>console.log(n, JSON.stringify(await p.evaluate(()=>{
  const W=document.documentElement.clientWidth; const bad=[];
  document.querySelectorAll('*').forEach(e=>{ if(e.children.length) return;
    const t=(e.textContent||'').trim(); if(!t) return;
    const r=e.getBoundingClientRect(); if(!r.width||!r.height) return;
    if(r.top>innerHeight||r.bottom<0) return;
    if(r.right>W+1){ let par=e.parentElement,inS=false;
      while(par){const c=getComputedStyle(par); if(/(auto|scroll)/.test(c.overflowX)){inS=true;break} par=par.parentElement}
      bad.push({txt:t.slice(0,28), right:Math.round(r.right), clipped:Math.round(r.right-W), inScroller:inS}); }});
  return {W, cutOff:bad.filter(x=>!x.inScroller).slice(0,8), inScrollerCount:bad.filter(x=>x.inScroller).length};
})));
await chk('landing');
for(const t of ['Calendar','Report','Add','Team']){ await p.getByText(t,{exact:true}).locator('visible=true').last().click(); await p.waitForTimeout(1200); await chk(t); }
await b.close();
