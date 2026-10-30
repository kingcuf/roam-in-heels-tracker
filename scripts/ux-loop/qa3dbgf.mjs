/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
const APP='http://127.0.0.1:8124/';
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const p=await ctx.newPage();const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
await p.goto(APP,{waitUntil:'load'});
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3200);
await vis('Report').first().click();await p.waitForTimeout(2600);
await p.locator('div').filter({hasText:/^Property All ▾$/}).first().click({force:true}).catch(e=>console.log('clickerr',String(e).slice(0,80)));
await p.waitForTimeout(2000);
await p.screenshot({path:'/tmp/ux-out/dbg-filter.png'});
console.log((await p.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ').slice(0,600));
await b.close();
