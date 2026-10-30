/* Round-3 focus: landing-headline zero-flash, and save->toast vs save->SentPanel. */
import { chromium } from 'playwright';
import {writeFileSync,mkdirSync} from 'node:fs';
const APP='http://127.0.0.1:8124/',API='http://127.0.0.1:8787/';
const out=process.env.OUT||'/tmp/ux-out/r3-qa-focus'; mkdirSync(out,{recursive:true});
const b=await chromium.launch(); const R={runs:[]};
for(let run=0;run<6;run++){
  const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
  const p=await c.newPage(); const calls=[];
  p.on('request',r=>{if(r.url().startsWith(API))r._t0=Date.now();});
  p.on('response',async r=>{if(!r.url().startsWith(API))return;let n=0;try{n=(await r.body()).length}catch{}
    calls.push({a:new URL(r.url()).searchParams.get('action'),kb:+(n/1024).toFixed(1),ms:Date.now()-(r.request()._t0||Date.now()),at:Date.now()});});
  const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200))});
  await p.goto(APP,{waitUntil:'load'});
  const sk=p.getByText('Skip',{exact:false}).locator('visible=true'); if(await sk.count()) await sk.first().click();
  await p.getByPlaceholder('Username').waitFor({timeout:20000});
  await p.getByPlaceholder('Username').fill('manager'); await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
  /* poll the headline every 40 ms from the unlock tap */
  const t0=Date.now();
  await p.getByText('Unlock').locator('visible=true').first().click();
  const samples=[];
  for(let i=0;i<120;i++){
    const s=await p.evaluate(()=>{const t=document.body.innerText;
      const m=t.match(/(\d[\d,]*)\s+thing[s]?\s+need[s]?\s+attention/i);
      const clear=/All clear/i.test(t);
      return {h:m?m[0]:null, n:m?m[1]:null, clear, hasTabs:/Calendar/.test(t)};});
    if(s.h||s.clear) samples.push({ms:Date.now()-t0,...s});
    if(samples.length>=6) break;
    await p.waitForTimeout(40);
  }
  R.runs.push({run, headlineSamples:samples});
  await p.waitForTimeout(2500);
  await p.screenshot({path:`${out}/${run}-landing.png`});
  /* save timings */
  await p.getByText('Add',{exact:true}).locator('visible=true').last().click(); await p.waitForTimeout(900);
  const lab=p.getByText('Net earned',{exact:false}).locator('visible=true').first();
  await lab.waitFor({timeout:8000}); await lab.locator('xpath=./following::input[1]').first().fill('6060');
  const k=calls.length; const tS=Date.now();
  await p.getByText('Submit for approval',{exact:false}).locator('visible=true').first().click();
  let toastMs=null,panelMs=null;
  try{await p.waitForFunction(()=>/sent to an admin for approval \(request #\d+\)/i.test(document.body.innerText),{timeout:15000});toastMs=Date.now()-tS;}catch{toastMs='timeout';}
  try{await p.waitForFunction(()=>/It is not in the booking log yet/i.test(document.body.innerText),{timeout:15000});panelMs=Date.now()-tS;}catch{panelMs='timeout';}
  await p.waitForTimeout(2000);
  R.runs[run].save={toastMs,panelMs,calls:calls.slice(k).map(x=>({a:x.a,kb:x.kb,ms:x.ms,dt:x.at-tS}))};
  R.runs[run].consoleErrors=errs;
  await p.screenshot({path:`${out}/${run}-save.png`});
  await c.close();
}
writeFileSync(`${out}/focus.json`,JSON.stringify(R,null,2)); console.log(JSON.stringify(R,null,1));
await b.close();
