/* Isolate: click() actionability wait vs app time from tap to request dispatch. */
import { chromium } from 'playwright';
import {writeFileSync,mkdirSync} from 'node:fs';
const APP='http://127.0.0.1:8124/',API='http://127.0.0.1:8787/';
const out=process.env.OUT||'/tmp/ux-out/r3-qa-save'; mkdirSync(out,{recursive:true});
const b=await chromium.launch(); const R=[];
for(let run=0;run<4;run++){
  const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
  const p=await c.newPage(); const calls=[];
  p.on('request',r=>{if(r.url().startsWith(API))calls.push({a:new URL(r.url()).searchParams.get('action'),at:Date.now()})});
  await p.goto(APP,{waitUntil:'load'});
  const sk=p.getByText('Skip',{exact:false}).locator('visible=true'); if(await sk.count()) await sk.first().click();
  await p.getByPlaceholder('Username').waitFor({timeout:20000});
  await p.getByPlaceholder('Username').fill('manager'); await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
  await p.getByText('Unlock').locator('visible=true').first().click();
  await p.getByText('need attention').locator('visible=true').first().waitFor({timeout:15000});
  await p.waitForTimeout(3000);
  await p.getByText('Add',{exact:true}).locator('visible=true').last().click(); await p.waitForTimeout(1200);
  const lab=p.getByText('Net earned',{exact:false}).locator('visible=true').first();
  await lab.waitFor({timeout:8000}); await lab.locator('xpath=./following::input[1]').first().fill('7070');
  await p.waitForTimeout(1200);
  const loc=p.getByText('Submit for approval',{exact:false}).locator('visible=true').first();
  await loc.scrollIntoViewIfNeeded(); await p.waitForTimeout(600);
  const box=await loc.boundingBox();
  /* two boxes, 500 ms apart, to see whether the element is still moving */
  const box2=await (async()=>{await p.waitForTimeout(500);return await loc.boundingBox();})();
  const k=calls.length;
  const tTap=Date.now();
  await p.mouse.click(box2.x+box2.width/2, box2.y+box2.height/2);   // raw: no actionability wait
  const clickReturnedMs=Date.now()-tTap;
  let dispatchMs=null;
  for(let i=0;i<200;i++){ const n=calls.slice(k).find(x=>/^(addBooking)$/.test(x.a));
    if(n){dispatchMs=n.at-tTap;break;} await p.waitForTimeout(20); }
  let toastMs=null;
  try{await p.waitForFunction(()=>/sent to an admin for approval \(request #\d+\)/i.test(document.body.innerText),{timeout:15000});toastMs=Date.now()-tTap;}catch{toastMs='timeout';}
  R.push({run, boxMoved: JSON.stringify(box)!==JSON.stringify(box2), box:box2, clickReturnedMs, dispatchMs, toastMs});
  await p.waitForTimeout(1500); await c.close();
}
writeFileSync(`${out}/save.json`,JSON.stringify(R,null,2)); console.log(JSON.stringify(R));
await b.close();
