/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP='http://127.0.0.1:8124/',API='http://127.0.0.1:8787/';
const OUT=process.argv[2]||'/tmp/ux-out/r3-qa-filter'; mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,timezoneId:'Asia/Kolkata'});
const p=await ctx.newPage();
const nonLocal=[];p.on('request',r=>{const u=r.url();if(/^https?:/.test(u)&&!u.startsWith(API)&&!u.startsWith(APP))nonLocal.push(u.slice(0,110));});
let n=0;const shot=l=>p.screenshot({path:`${OUT}/${String(++n).padStart(2,'0')}-${l}.png`});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
const txt=async()=>(await p.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ');
const R={};
await p.goto(APP,{waitUntil:'load'});
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');
await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3200);
await vis('Report').first().click();await p.waitForTimeout(2600);
R.chips=await p.evaluate(()=>[...document.querySelectorAll('div')].filter(e=>e.offsetParent&&/^(Property|Range)\b/.test((e.innerText||'').trim())&&(e.innerText||'').trim().length<40).map(e=>{const r=e.getBoundingClientRect();return{t:(e.innerText||'').trim().replace(/\s+/g,' '),x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),tabindex:e.getAttribute('tabindex')};}));
console.log('chips',JSON.stringify(R.chips));
const wait=async()=>((await txt()).match(/Waiting for approval.{0,240}/i)||[null])[0];
const kpi=async()=>((await txt()).match(/CURRENT MONTH.{0,110}/i)||[null])[0];
R.filter={All:{waiting:await wait(),kpi:await kpi()}};
console.log('All →',JSON.stringify(R.filter.All));
for(const pr of ['Spira 3028','Spira 2212']){
  try{
    const box=R.chips.find(c=>/^Property/.test(c.t));
    await p.mouse.click(box.x+box.w/2,box.y+box.h/2);
    await p.waitForTimeout(1800);
    const sheet=await p.evaluate(()=>[...document.querySelectorAll('div')].filter(e=>e.offsetParent&&/Spira/.test(e.innerText||'')&&(e.innerText||'').trim().length<30).map(e=>{const r=e.getBoundingClientRect();return{t:(e.innerText||'').trim(),x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),h:Math.round(r.height)};}));
    console.log('sheet options',JSON.stringify(sheet));
    const opt=sheet.filter(o=>o.t===pr).pop();
    if(!opt) throw new Error('option '+pr+' not visible');
    await p.mouse.click(opt.x,opt.y);
    await p.waitForTimeout(2800);
    R.filter[pr]={waiting:await wait(),kpi:await kpi()};
  }catch(e){R.filter[pr]={err:String(e).split('\n')[0].slice(0,100)};}
  console.log(pr,'→',JSON.stringify(R.filter[pr]));
  await shot('f-'+pr.replace(/\W/g,''));
}
R.nonLocal=[...new Set(nonLocal)];
writeFileSync(`${OUT}/filter.json`,JSON.stringify(R,null,2));
console.log('non-local:',R.nonLocal.length?R.nonLocal:'none','|',OUT);
await b.close();
