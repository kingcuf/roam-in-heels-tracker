/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage();
const t0=Date.now();
await p.goto('http://127.0.0.1:8124/',{waitUntil:'load'});
const fcp=await p.evaluate(()=>new Promise(r=>{const e=performance.getEntriesByName('first-contentful-paint')[0];
  if(e) return r(Math.round(e.startTime));
  new PerformanceObserver((l,o)=>{const x=l.getEntries()[0]; if(x){o.disconnect(); r(Math.round(x.startTime))}}).observe({type:'paint',buffered:true});
  setTimeout(()=>r(null),5000);}));
await p.getByText('Skip').locator('visible=true').first().waitFor({timeout:20000});
const skipAt=Date.now()-t0;
const geom=await p.evaluate(()=>{const e=[...document.querySelectorAll('*')].filter(x=>!x.children.length&&/Skip/.test((x.textContent||'')))[0];
  const r=e.getBoundingClientRect(); const cs=getComputedStyle(e);
  // walk up for the actual hit area
  let h=e,hr=r; for(let i=0;i<4&&h.parentElement;i++){h=h.parentElement;const q=h.getBoundingClientRect(); if(q.width>hr.width)hr=q;}
  return {textBox:{w:+r.width.toFixed(0),h:+r.height.toFixed(0)}, hitBox:{w:+hr.width.toFixed(0),h:+hr.height.toFixed(0)},
    fontSize:cs.fontSize, color:cs.color, y:+r.y.toFixed(0)};});
console.log(JSON.stringify({loadMs:Date.now()-t0, fcp, skipVisibleAtMs:skipAt, skip:geom},null,1));
await p.screenshot({path:'/tmp/ux-out/r1-qa-deep/00-intro-skip.png'});
// landing settle: sign in and sample the headline every 100ms
await p.getByText('Skip').locator('visible=true').first().click(); await p.waitForTimeout(900);
await p.getByPlaceholder('Username').fill('manager'); await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
const tU=Date.now();
await p.getByText('Unlock').locator('visible=true').first().click();
const samples=[];
for(let i=0;i<40;i++){ await p.waitForTimeout(100);
  const t=await p.evaluate(()=>{const m=document.body.innerText.match(/(\d+) things? need attention/); return m?m[0]:null;});
  samples.push({t:Date.now()-tU, t_:t});
  if(samples.length>3 && t && samples[samples.length-2].t_===t && samples[samples.length-3].t_===t) break; }
console.log('landing settle:', JSON.stringify(samples.filter((s,i,a)=>i===0||s.t_!==a[i-1].t_)));
await b.close();
