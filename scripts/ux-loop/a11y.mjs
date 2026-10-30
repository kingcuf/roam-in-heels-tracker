/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage();
await p.goto('http://127.0.0.1:8124/',{waitUntil:'load'}); await p.waitForTimeout(500);
await p.getByText('Skip').locator('visible=true').first().click(); await p.waitForTimeout(900);
await p.getByPlaceholder('Username').fill('manager'); await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await p.getByText('Unlock').locator('visible=true').first().click();
await p.getByText('need attention').locator('visible=true').first().waitFor({timeout:15000});
await p.waitForTimeout(2500);
await p.getByText('Add',{exact:true}).locator('visible=true').last().click(); await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.evaluate(()=>{
  const ins=[...document.querySelectorAll('input,textarea')];
  const named=ins.filter(i=>i.getAttribute('aria-label')||i.getAttribute('aria-labelledby')||i.labels?.length||i.placeholder);
  const unnamed=ins.filter(i=>!(i.getAttribute('aria-label')||i.getAttribute('aria-labelledby')||i.labels?.length||i.placeholder));
  return {inputs:ins.length, named:named.length, unnamed:unnamed.length,
    unnamedTypes:unnamed.map(i=>i.type).slice(0,20),
    placeholderOnly: ins.filter(i=>i.placeholder&&!i.getAttribute('aria-label')&&!i.labels?.length).length,
    labelEls: document.querySelectorAll('label').length,
    h1:document.querySelectorAll('h1,h2,h3').length,
    landmarks:document.querySelectorAll('main,nav,header,[role="navigation"],[role="main"]').length};
}),null,1));
await b.close();
