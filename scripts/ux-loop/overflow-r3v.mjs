/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const APP='http://127.0.0.1:8124/';
const out='/tmp/ux-out/r3v-qa-overflow'; mkdirSync(out,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage();
await p.goto(APP,{waitUntil:'load'}); await p.waitForTimeout(600);
const sk=p.getByText('Skip').locator('visible=true'); if(await sk.count()){await sk.first().click();await p.waitForTimeout(900);}
await p.getByPlaceholder('Username').fill('manager');
await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await p.getByText('Unlock').locator('visible=true').first().click();
await p.waitForTimeout(3000);
const check=async(name)=>{
  const r=await p.evaluate(()=>{
    const de=document.documentElement, bd=document.body;
    const offenders=[];
    document.querySelectorAll('*').forEach(el=>{
      const b=el.getBoundingClientRect();
      if(b.width===0||b.height===0) return;
      if(b.right>innerWidth+1){
        const cs=getComputedStyle(el);
        // is it inside a horizontal scroller (intentional)?
        let e=el.parentElement, inScroller=false;
        while(e){const c=getComputedStyle(e); if(/(auto|scroll)/.test(c.overflowX)){inScroller=true;break;} e=e.parentElement;}
        offenders.push({tag:el.tagName, right:+b.right.toFixed(0), w:+b.width.toFixed(0),
          txt:(el.textContent||'').trim().slice(0,32), inScroller, ox:cs.overflowX});
      }
    });
    const before=window.scrollX; window.scrollTo(400,0); const after=window.scrollX; window.scrollTo(before,0);
    return {docScrollW:de.scrollWidth, docClientW:de.clientWidth, bodyScrollW:bd.scrollWidth,
      innerW:innerWidth, pageScrolledTo:after,
      offendersOutsideScrollers:offenders.filter(o=>!o.inScroller).slice(0,8),
      offendersTotal:offenders.length};
  });
  console.log(name, JSON.stringify(r,null,1));
  await p.screenshot({path:`${out}/${name}.png`});
};
await check('landing');
for(const t of ['Calendar','Report','Add','Team']){
  await p.getByText(t,{exact:true}).locator('visible=true').last().click();
  await p.waitForTimeout(1200); await check(t);
}
/* keyboard focus order on the Add form */
await p.getByText('Add',{exact:true}).locator('visible=true').last().click();
await p.waitForTimeout(1000);
const focus=[];
for(let i=0;i<20;i++){
  await p.keyboard.press('Tab');
  focus.push(await p.evaluate(()=>{const e=document.activeElement; if(!e)return null;
    const r=e.getBoundingClientRect();
    return {tag:e.tagName, label:e.getAttribute('aria-label')||e.placeholder||(e.textContent||'').trim().slice(0,28),
      y:+r.y.toFixed(0), x:+r.x.toFixed(0), w:+r.width.toFixed(0), h:+r.height.toFixed(0)};}));
}
console.log('FOCUS ORDER', JSON.stringify(focus,null,1));
await b.close();
