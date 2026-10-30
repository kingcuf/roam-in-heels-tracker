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
const scrollers=async(name)=>{const r=await p.evaluate(()=>{const o=[];
  document.querySelectorAll('*').forEach(e=>{const c=getComputedStyle(e);
    if(/(auto|scroll)/.test(c.overflowY)&&e.scrollHeight>e.clientHeight+20&&e.clientHeight>200)
      o.push({h:e.clientHeight, sh:e.scrollHeight, screens:+(e.scrollHeight/innerHeight).toFixed(1)});});
  return o.sort((a,b)=>b.sh-a.sh).slice(0,3);});
  console.log(name, JSON.stringify(r)); };
await scrollers('Action');
for(const t of ['Report','Add']){ await p.getByText(t,{exact:true}).locator('visible=true').last().click(); await p.waitForTimeout(1200); await scrollers(t); }
// count fields in Add Booking
console.log('fields:', await p.evaluate(()=>({inputs:document.querySelectorAll('input,textarea,select').length,
  selects:[...document.querySelectorAll('*')].filter(e=>!e.children.length&&(e.textContent||'').trim()==='▾').length})));
await b.close();
