/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
const b=await chromium.launch();
for(const [tag,APP] of [['r3','http://127.0.0.1:8125/'],['r4','http://127.0.0.1:8124/']]){
  const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true});
  const p=await ctx.newPage();const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
  const calls=[];p.on('request',r=>{if(r.url().startsWith('http://127.0.0.1:8787/'))calls.push(new URL(r.url()).searchParams.get('action'));});
  await p.goto(APP,{waitUntil:'load'});
  try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1500);}catch{}
  await p.getByPlaceholder('PIN').first().fill(process.env.PIN);
  await p.waitForTimeout(400);
  const btn=await p.evaluate(()=>{const e=[...document.querySelectorAll('*')].filter(x=>x.offsetParent&&/^Unlock$/.test((x.innerText||'').trim()));const t=e[e.length-1];if(!t)return null;const h=t.closest('[tabindex]')||t;return{tabindex:h.getAttribute('tabindex'),disabled:h.hasAttribute('disabled')};});
  const c0=calls.length;
  await p.getByPlaceholder('PIN').first().press('Enter');
  await p.waitForTimeout(2500);
  const viaEnter=(await p.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ');
  const r={bundle:tag,unlockWithBlankUser:btn,
    enterOnPin_msg:(viaEnter.match(/Enter your username\.|need attention|Approvals/i)||[null])[0],
    enterOnPin_calls:calls.slice(c0)};
  console.log(JSON.stringify(r));
  await ctx.close();
}
await b.close();
