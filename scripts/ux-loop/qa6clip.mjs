/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
const APP='http://127.0.0.1:8124/';
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});const p=await ctx.newPage();
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
await p.goto(APP,{waitUntil:'load'});await p.waitForTimeout(1200);
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3500);
await vis('Add').first().click({force:true});await p.waitForTimeout(1800);
const net=await p.evaluateHandle(()=>[...document.querySelectorAll('input')].filter(e=>e.inputMode==='decimal')[1]);
const gp=await p.evaluateHandle(()=>[...document.querySelectorAll('input')].filter(e=>e.inputMode==='decimal')[0]);
const out={};
for(const [label,h,val] of [['net-1250.50',net,'1250.50'],['net-125000.50',net,'125000.50'],['net-1250000.50',net,'1250000.50']]){
  await p.evaluate(e=>{const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));e.focus();},h);
  await p.keyboard.type(val,{delay:30});await p.waitForTimeout(300);
  const c=await p.evaluate(e=>{const row=e.parentElement;const btn=[...row.children].find(x=>x!==e&&!x.contains(e));const r=btn.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};},h);
  await p.mouse.click(c.x,c.y);await p.waitForTimeout(400);
  out[label]=await p.evaluate(e=>({v:e.value,scrollW:e.scrollWidth,clientW:e.clientWidth,clipped:e.scrollWidth>e.clientWidth+1}),h);
}
out.guestPaidBox=await p.evaluate(e=>{const r=e.getBoundingClientRect();return{l:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)};},gp);
out.placeholderNet=await p.evaluate(e=>e.placeholder,net);
console.log(JSON.stringify(out,null,1));
await p.screenshot({path:'/tmp/ux-out/r6-qa-pm2/03-bignum.png'});
await b.close();
