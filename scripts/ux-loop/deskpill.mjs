/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1280,height:860}});
const p=await ctx.newPage();
await p.goto('http://127.0.0.1:8124/',{waitUntil:'load'}); await p.waitForTimeout(500);
await p.getByText('Skip').locator('visible=true').first().click(); await p.waitForTimeout(900);
await p.getByPlaceholder('Username').fill('owner'); await p.getByPlaceholder('PIN').fill(process.env.PIN);
await p.getByText('Unlock').locator('visible=true').first().click(); await p.waitForTimeout(3500);
const meas=async(tab)=>{
  if(tab){ await p.getByText(tab,{exact:true}).locator('visible=true').last().click(); await p.waitForTimeout(1200);}
  return await p.evaluate((tab)=>{
    const labels=['Action','Calendar','Report','Add','Team'].map(n=>{
      const e=[...document.querySelectorAll('*')].filter(x=>!x.children.length&&(x.textContent||'').trim()===n)
        .sort((a,b)=>b.getBoundingClientRect().y-a.getBoundingClientRect().y)[0];
      const r=e.getBoundingClientRect(); return {n, cx:Math.round(r.x+r.width/2), y:Math.round(r.y)};});
    // the active pill: a rounded highlighted box in the tab bar
    let pill=null;
    document.querySelectorAll('*').forEach(e=>{const r=e.getBoundingClientRect(); const cs=getComputedStyle(e);
      if(r.y>window.innerHeight-140 && r.height>50 && r.height<90 && r.width>120 && r.width<400 &&
         parseFloat(cs.borderRadius)>20) { if(!pill||r.width<pill.w) pill={x:Math.round(r.x),w:Math.round(r.width),cx:Math.round(r.x+r.width/2),h:Math.round(r.height)}; }});
    return {tab, labels, pill};
  }, tab);
};
for(const t of [null,'Action','Calendar','Team']) console.log(JSON.stringify(await meas(t)));
await b.close();
