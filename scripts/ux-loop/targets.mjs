/* Tap targets measured on the nearest PRESSABLE ancestor, not the text node. */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage();
await p.goto('http://127.0.0.1:8124/',{waitUntil:'load'}); await p.waitForTimeout(500);
await p.getByText('Skip').locator('visible=true').first().click(); await p.waitForTimeout(900);
await p.getByPlaceholder('Username').fill('manager'); await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await p.getByText('Unlock').locator('visible=true').first().click();
await p.getByText('need attention').locator('visible=true').first().waitFor({timeout:15000});
await p.waitForTimeout(2500);
const scan=async(name)=>{
  const r=await p.evaluate(()=>{
    const press=new Map();
    document.querySelectorAll('*').forEach(e=>{
      const cs=getComputedStyle(e);
      const isP = e.getAttribute('tabindex')!==null || e.getAttribute('role')==='button' ||
                  ['BUTTON','A'].includes(e.tagName) || cs.cursor==='pointer';
      if(!isP) return;
      // skip if an ancestor is also pressable (keep the innermost real control)
      let par=e.parentElement, nested=false;
      while(par){const c=getComputedStyle(par);
        if(par.getAttribute('tabindex')!==null||par.getAttribute('role')==='button'||['BUTTON','A'].includes(par.tagName)||c.cursor==='pointer'){nested=true;break}
        par=par.parentElement;}
      if(nested) return;
      const b=e.getBoundingClientRect();
      if(!b.width||!b.height||b.top>innerHeight||b.bottom<0) return;
      const t=(e.textContent||'').trim().slice(0,30)||e.getAttribute('aria-label')||e.tagName;
      press.set(t+'@'+Math.round(b.x)+','+Math.round(b.y), {t, w:+b.width.toFixed(0), h:+b.height.toFixed(0)});
    });
    const all=[...press.values()];
    return {total:all.length, small:all.filter(x=>x.w<44||x.h<44)};
  });
  console.log('###',name,'pressables',r.total,'under 44px:',r.small.length);
  const seen=new Set();
  r.small.forEach(x=>{const k=x.t+x.w+x.h; if(seen.has(k))return; seen.add(k); console.log('   ',JSON.stringify(x));});
  return r;
};
const all={};
all.Action=await scan('Action');
for(const t of ['Calendar','Report','Add','Team']){
  await p.getByText(t,{exact:true}).locator('visible=true').last().click(); await p.waitForTimeout(1200);
  all[t]=await scan(t);
}
writeFileSync('/tmp/ux-out/r1-qa-probe/targets.json',JSON.stringify(all,null,2));
await b.close();
