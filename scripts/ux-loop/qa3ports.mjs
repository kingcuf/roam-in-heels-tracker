/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
const b=await chromium.launch();
for(const APP of ['http://127.0.0.1:8125/','http://127.0.0.1:8124/']){
  const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const p=await ctx.newPage();const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
  await p.goto(APP,{waitUntil:'load'});
  try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
  await p.getByPlaceholder('Username').first().fill('manager');await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
  await vis('Unlock').first().click();await p.waitForTimeout(3200);
  await vis('Add').first().click();await p.waitForTimeout(1500);
  await p.getByText('Expense',{exact:true}).locator('visible=true').first().click({force:true});await p.waitForTimeout(1300);
  const im=await p.evaluate(()=>{const ins=[...document.querySelectorAll('input')].filter(e=>e.offsetParent&&e.inputMode);return ins.map(e=>e.inputMode);});
  const bundle=await p.evaluate(()=>[...document.querySelectorAll('script')].map(s=>s.src).find(s=>/index-/.test(s)));
  console.log(APP,'inputmodes=',JSON.stringify(im),'bundle=',(bundle||'').split('/').pop());
  await ctx.close();
}
await b.close();
