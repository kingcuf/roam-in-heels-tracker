/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP='http://127.0.0.1:8124/',API='http://127.0.0.1:8787/';
const OUT='/tmp/ux-out/r4b-qa-retick-coords';mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage();
const calls=[];p.on('request',r=>{if(r.url().startsWith(API))calls.push(new URL(r.url()).searchParams.get('action'));});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
const txt=async()=>(await p.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ');
const st=async()=>({header:((await txt()).match(/\d+ ticked · ₹[\d,]+/)||[null])[0],
  markBtn:await p.evaluate(()=>{const e=[...document.querySelectorAll('*')].filter(x=>x.offsetParent&&/^Mark \d+ paid/.test((x.innerText||'').trim()));return e.length?(e[e.length-1].innerText||'').trim():null;})});
await p.goto(APP,{waitUntil:'load'});
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1500);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3600);
await vis('Action').first().click();await p.waitForTimeout(2600);
await vis('Pending amount').first().click({force:true});await p.waitForTimeout(2800);
const R={before:await st()};
/* locate the first card that shows WAITING FOR APPROVAL and click its centre by coordinates */
const box=await p.evaluate(()=>{
  const cards=[...document.querySelectorAll('div')].filter(e=>e.offsetParent&&/WAITING FOR APPROVAL/.test(e.innerText||'')&&/AWAITING/.test(e.innerText||'')&&e.getBoundingClientRect().width>300);
  const e=cards[cards.length-1]; if(!e) return null; e.scrollIntoView({block:'center'});
  const r=e.getBoundingClientRect();
  return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),w:Math.round(r.width),h:Math.round(r.height),tabindex:e.getAttribute('tabindex'),req:((e.innerText||'').match(/Request #(\d+)/)||[])[1]};});
R.waitingCard=box;
if(box){const c0=calls.length;
  await p.mouse.click(box.x,box.y); await p.waitForTimeout(1600);
  R.afterTapWaiting={apiCalls:calls.slice(c0),...(await st())};
  await p.screenshot({path:OUT+'/01-after-tap-waiting.png'});
  /* tap again, twice, to be sure */
  await p.mouse.click(box.x,box.y); await p.waitForTimeout(1200);
  R.afterTapTwice=await st();
}
console.log(JSON.stringify(R,null,1));
writeFileSync(OUT+'/retick2.json',JSON.stringify(R,null,2));
await b.close();
