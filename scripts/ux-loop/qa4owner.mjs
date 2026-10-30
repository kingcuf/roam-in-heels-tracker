/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
const APP='http://127.0.0.1:8124/';
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true});
const p=await ctx.newPage();const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
await p.goto(APP,{waitUntil:'load'});
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1500);}catch{}
await p.getByPlaceholder('PIN').first().fill(process.env.PIN);
await p.waitForTimeout(400);
await vis('Unlock').first().click().catch(e=>console.log('clickerr',String(e).slice(0,60)));
await p.waitForTimeout(4000);
console.log((await p.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ').slice(0,400));
await p.screenshot({path:'/tmp/ux-out/dbg-owner.png'});
await b.close();
