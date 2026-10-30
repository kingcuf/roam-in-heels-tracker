import { chromium } from 'playwright';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage();
await p.goto('http://127.0.0.1:8124/',{waitUntil:'load'});
await p.getByText('Skip').locator('visible=true').first().waitFor({timeout:20000});
console.log(JSON.stringify(await p.evaluate(()=>{
  const e=[...document.querySelectorAll('*')].filter(x=>!x.children.length&&/Skip/.test(x.textContent||''))[0];
  const out={leaf:e.getBoundingClientRect()};
  let n=e.parentElement, hit=null;
  while(n){ const cs=getComputedStyle(n);
    if(n.getAttribute('tabindex')!==null||cs.cursor==='pointer'||n.getAttribute('role')==='button'){hit=n;break}
    n=n.parentElement; }
  const r=hit?hit.getBoundingClientRect():null;
  return {leafW:Math.round(out.leaf.width),leafH:Math.round(out.leaf.height),
    hit: r?{w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y)}:null,
    hitTag:hit&&hit.tagName, hitAria:hit&&hit.getAttribute('aria-label')};
})));
await b.close();
