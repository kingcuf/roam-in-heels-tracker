/* Exploratory + ergonomics probe. Local only. */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const APP='http://127.0.0.1:8124/', API='http://127.0.0.1:8787/';
const device = process.argv[2]==='desktop'
  ? { viewport:{width:1280,height:860} }
  : { viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:3,
      userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
const user = process.argv[3] ?? 'manager', pin = process.argv[4] ?? process.env.MANAGER_PIN;
const out = process.argv[5] || '/tmp/ux-out/r1-qa-probe';
mkdirSync(out,{recursive:true});
const b = await chromium.launch(); const ctx = await b.newContext(device); const p = await ctx.newPage();
const calls=[]; p.on('response', async r=>{ if(!r.url().startsWith(API))return;
  const u=new URL(r.url()); let len=0; try{ len=(await r.body()).length }catch{}
  calls.push({action:u.searchParams.get('action'), bytes:len, at:Date.now()}); });
await p.goto(APP,{waitUntil:'load'});
await p.waitForTimeout(500);
const sk=p.getByText('Skip',{exact:false}).locator('visible=true');
if(await sk.count()){ await sk.first().click(); await p.waitForTimeout(800); }
await p.getByPlaceholder('Username').fill(user);
await p.getByPlaceholder('PIN').fill(pin);
await p.getByText('Unlock').locator('visible=true').first().click();
await p.waitForTimeout(2500);

const texts = async ()=> (await p.evaluate(()=>{
  const seen=[];
  document.querySelectorAll('*').forEach(el=>{
    if(el.children.length) return;
    const t=(el.textContent||'').trim(); if(!t||t.length>80) return;
    const r=el.getBoundingClientRect(); if(!r.width||!r.height) return;
    if(r.bottom<0||r.top>window.innerHeight) return;
    seen.push(t);
  });
  return [...new Set(seen)];
}));

/* contrast + tap targets + overflow */
const ergo = async (tabName)=> await p.evaluate(()=>{
  const lum=(c)=>{const [r,g,b]=c.map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*r+0.7152*g+0.0722*b};
  const parse=(s)=>{const m=s.match(/rgba?\(([^)]+)\)/); if(!m) return null; const a=m[1].split(',').map(x=>parseFloat(x)); return {rgb:a.slice(0,3), a:a.length>3?a[3]:1}};
  const bgOf=(el)=>{let e=el; while(e){const c=parse(getComputedStyle(e).backgroundColor); if(c&&c.a>0.6) return c.rgb; e=e.parentElement;} return [255,255,255]};
  const mix=(f,bg,a)=>f.map((v,i)=>v*a+bg[i]*(1-a));
  const low=[], small=[];
  document.querySelectorAll('*').forEach(el=>{
    const r=el.getBoundingClientRect();
    if(!r.width||!r.height||r.bottom<0||r.top>window.innerHeight) return;
    const cs=getComputedStyle(el);
    const t=(el.textContent||'').trim();
    if(!el.children.length && t){
      const fg=parse(cs.color); if(fg){
        const bg=bgOf(el.parentElement||el); const c=mix(fg.rgb,bg,fg.a);
        const L1=lum(c), L2=lum(bg); const ratio=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
        const fs=parseFloat(cs.fontSize), bold=parseInt(cs.fontWeight)>=700;
        const need=(fs>=24||(fs>=18.66&&bold))?3:4.5;
        if(ratio<need) low.push({text:t.slice(0,40), ratio:+ratio.toFixed(2), need, fontSize:fs});
      }
    }
    // tappable
    const clickable = el.getAttribute('tabindex')!==null || ['BUTTON','A','INPUT'].includes(el.tagName) ||
      cs.cursor==='pointer' || el.getAttribute('role')==='button';
    if(clickable && t && t.length<40){
      if(r.width<44||r.height<44) small.push({text:t.slice(0,32), w:+r.width.toFixed(0), h:+r.height.toFixed(0)});
    }
  });
  const de=document.documentElement;
  let widest=0, offender=null;
  document.querySelectorAll('*').forEach(el=>{const r=el.getBoundingClientRect(); if(r.right>widest){widest=r.right;offender=(el.textContent||el.tagName).trim().slice(0,40)}});
  return { overflow:{ scrollW:de.scrollWidth, clientW:de.clientWidth, widestRight:+widest.toFixed(0), offender },
           lowContrast:low, smallTargets:small };
});

const report={};
report.landing = { texts: await texts(), ergo: await ergo() };
await p.screenshot({path:`${out}/tab-landing.png`, fullPage:false});
for (const tab of ['Calendar','Report','Add','Team']) {
  const l=p.getByText(tab,{exact:true}).locator('visible=true');
  if(!await l.count()){ report[tab]={missing:true}; continue; }
  const t0=Date.now(); await l.last().click(); await p.waitForTimeout(1200);
  report[tab]={ ms:Date.now()-t0, texts: await texts(), ergo: await ergo() };
  await p.screenshot({path:`${out}/tab-${tab}.png`});
}
report.calls=calls;
writeFileSync(`${out}/probe.json`, JSON.stringify(report,null,2));
console.log(JSON.stringify({keys:Object.keys(report)},null,1));
await b.close();
