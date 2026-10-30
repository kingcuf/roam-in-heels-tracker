/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP='http://127.0.0.1:8124/',API='http://127.0.0.1:8787/';
const OUT='/tmp/ux-out/r3-qa-edge2';mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage();const calls=[];p.on('request',r=>{if(r.url().startsWith(API))calls.push(new URL(r.url()).searchParams.get('action'));});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
await p.goto(APP,{waitUntil:'load'});
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3200);
await vis('Add').first().click();await p.waitForTimeout(1500);
await p.getByText('Expense',{exact:true}).locator('visible=true').first().click({force:true});await p.waitForTimeout(1300);
await p.locator('text=Select…').locator('visible=true').first().click({force:true});await p.waitForTimeout(1600);
await p.getByText('Caretaker',{exact:true}).locator('visible=true').first().click({force:true});await p.waitForTimeout(900);
await p.evaluate(()=>{const i=[...document.querySelectorAll('input')].filter(e=>e.offsetParent&&e.inputMode==='decimal')[0];i&&i.setAttribute('data-a','1');});
const R={};
for(const v of ['-','abc','']){
  await p.getByPlaceholder('e.g. Monthly rent').first().fill('UX r3 edge '+(v||'blank'));
  await p.locator('input[data-a]').first().fill('');
  await p.locator('input[data-a]').first().fill(v);
  const stored=await p.locator('input[data-a]').first().inputValue();
  const c0=calls.length;
  await vis('Submit for approval').first().click({force:true});
  await p.waitForTimeout(2200);
  const t=(await p.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ');
  R[v||'(blank)']={stored,apiCalls:calls.slice(c0),msg:(t.match(/.{0,60}Amount.{0,90}/i)||[null])[0]};
  console.log(JSON.stringify(v),'→',JSON.stringify(R[v||'(blank)']));
  await p.waitForTimeout(600);
}
writeFileSync(`${OUT}/edge.json`,JSON.stringify(R,null,2));
await b.close();
