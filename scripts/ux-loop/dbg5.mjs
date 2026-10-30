/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
const APP='http://127.0.0.1:8124/';
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true});const p=await ctx.newPage();
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
await p.goto(APP,{waitUntil:'load'});await p.waitForTimeout(1200);
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3500);
await vis('Add').first().click({force:true});await p.waitForTimeout(1800);
console.log(await p.evaluate(()=>{
 const inps=[...document.querySelectorAll('input,textarea')].map((e,i)=>({i,ph:e.placeholder,im:e.inputMode,type:e.type,y:Math.round(e.getBoundingClientRect().top)}));
 const lab=(inp)=>{let c=inp;for(let i=0;i<8&&c;i++){c=c.parentElement;if(!c)break;const t=(c.innerText||'').trim().split('\n')[0];if(t&&t.length<30)return t;}return '?';};
 const labs=[...document.querySelectorAll('input')].filter(e=>e.inputMode==='decimal').map(e=>({lab:lab(e),y:Math.round(e.getBoundingClientRect().top),idx:[...document.querySelectorAll('input,textarea')].indexOf(e)}));
 return JSON.stringify({inps:inps.length,labs},null,1);
}));
await b.close();
