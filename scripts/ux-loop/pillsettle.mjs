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
const pillx=()=>p.evaluate(()=>{let best=null;
  document.querySelectorAll('*').forEach(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);
    if(r.y>innerHeight-140&&r.height>50&&r.height<90&&r.width>40&&r.width<200&&parseFloat(cs.borderRadius)>20)
      { if(!best||r.width<best.w) best={x:+(r.x).toFixed(1),w:+(r.width).toFixed(1)}; }});
  return best;});
for(const t of ['Report','Add','Action']){
  const t0=Date.now();
  await p.getByText(t,{exact:true}).locator('visible=true').last().click();
  let last=null,stableSince=null,settle=null;
  while(Date.now()-t0<4000){
    const cur=await pillx();
    const k=cur?`${cur.x}|${cur.w}`:'null';
    if(k===last){ if(!stableSince)stableSince=Date.now(); else if(Date.now()-stableSince>150){settle=stableSince-t0;break;} }
    else { stableSince=null; last=k; }
  }
  console.log('tab',t,'pill settled at',settle,'ms');
}
await b.close();
