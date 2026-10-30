/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* Category picker geometry at 390x844: sheet box, search box, which options are on-screen. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP=process.argv[2]||'http://127.0.0.1:8124/', API='http://127.0.0.1:8787/';
const OUT=process.argv[3]||'/tmp/ux-out/r3-qa-picker'; mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:false,hasTouch:true,deviceScaleFactor:3,timezoneId:'Asia/Kolkata'});
const p=await ctx.newPage();
const nonLocal=[];p.on('request',r=>{const u=r.url();if(/^https?:/.test(u)&&!u.startsWith(API)&&!u.startsWith(APP))nonLocal.push(u.slice(0,110));});
let n=0;const shot=l=>p.screenshot({path:`${OUT}/${String(++n).padStart(2,'0')}-${l}.png`});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
const R={app:APP};
await p.goto(APP,{waitUntil:'load'});
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');
await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3200);
await vis('Add').first().click();await p.waitForTimeout(1500);
await p.getByText('Expense',{exact:true}).locator('visible=true').first().click({force:true});await p.waitForTimeout(1400);
const t0=Date.now();
await p.locator('text=Select…').locator('visible=true').first().click({force:true});
await p.waitForTimeout(1800);
R.openMs=Date.now()-t0;
await shot('sheet-open');
R.sheet=await p.evaluate(()=>{
  const CATS=['Caretaker','Cleaning','Utilities','Repairs','Rent','Maintenance','Internet','Electricity','Water','Gas','Laundry','Supplies','Staff','Other'];
  const vzRect=e=>{const r=e.getBoundingClientRect();return{y:Math.round(r.top),b:Math.round(r.bottom),x:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)};};
  const search=[...document.querySelectorAll('input')].filter(e=>/Search/i.test(e.placeholder||'')).map(e=>({ph:e.placeholder,...vzRect(e),inView:(()=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=window.innerHeight;})()}));
  const opts=[];
  for(const e of document.querySelectorAll('div')){
    const t=(e.innerText||'').trim();
    if(!CATS.includes(t)) continue;
    if(e.querySelector('div')) continue;
    const r=e.getBoundingClientRect();
    opts.push({t,y:Math.round(r.top),b:Math.round(r.bottom),h:Math.round(r.height),w:Math.round(r.width),
      inViewport:r.top>=0&&r.bottom<=window.innerHeight&&r.height>0});
  }
  const scrollers=[...document.querySelectorAll('div')].filter(e=>e.scrollHeight>e.clientHeight+10&&e.clientHeight>80).map(e=>({clientH:e.clientHeight,scrollH:e.scrollHeight,...vzRect(e)}));
  return {viewportH:window.innerHeight,search,options:opts,optionCount:opts.length,
    onScreen:opts.filter(o=>o.inViewport).map(o=>o.t),scrollers:scrollers.slice(-6)};
});
console.log(JSON.stringify(R.sheet,null,1));
/* can Utilities be reached by typing in the search box? */
try{
  const s=p.getByPlaceholder('Search',{exact:false}).locator('visible=true').first();
  await s.click({force:true}); await s.type('Util',{delay:20}); await p.waitForTimeout(900);
  R.afterSearch=await p.evaluate(()=>{
    const e=[...document.querySelectorAll('div')].filter(x=>(x.innerText||'').trim()==='Utilities'&&!x.querySelector('div'))[0];
    if(!e)return null;const r=e.getBoundingClientRect();
    return{y:Math.round(r.top),b:Math.round(r.bottom),inViewport:r.top>=0&&r.bottom<=window.innerHeight};});
  console.log('after typing "Util":',JSON.stringify(R.afterSearch));
  await shot('after-search');
  const t1=Date.now();
  try{await p.getByText('Utilities',{exact:true}).locator('visible=true').first().click({timeout:6000});R.tapAfterSearch={ok:true,ms:Date.now()-t1};}
  catch(e){R.tapAfterSearch={ok:false,ms:Date.now()-t1};}
}catch(e){R.afterSearch={err:String(e).split('\n')[0].slice(0,90)};}
console.log('tap after search:',JSON.stringify(R.tapAfterSearch));
await p.waitForTimeout(900); await shot('after-pick');
R.picked=(await p.evaluate(()=>document.body.innerText)).includes('Utilities');
R.nonLocal=[...new Set(nonLocal)];
writeFileSync(`${OUT}/picker.json`,JSON.stringify(R,null,2));
console.log('picked=',R.picked,'| non-local:',R.nonLocal.length?R.nonLocal:'none','|',OUT);
await b.close();
