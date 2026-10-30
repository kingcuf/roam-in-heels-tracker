/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const p=await ctx.newPage();
const calls=[]; let rec=false;
p.on('response',async r=>{ const u=r.url(); if(!u.includes('127.0.0.1:8787')) return;
  const a=new URL(u).searchParams.get('action'); let kb=0;
  try{kb=+( (await r.body()).length/1024).toFixed(1);}catch{}
  if(rec) calls.push({a,kb}); });
await p.goto('http://127.0.0.1:8124/',{waitUntil:'load'});
const sk=p.getByText('Skip',{exact:false}).locator('visible=true'); if(await sk.count()) await sk.first().click();
await p.getByPlaceholder('Username').waitFor({timeout:20000});
await p.getByPlaceholder('Username').fill('manager'); await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await p.getByText('Unlock').locator('visible=true').first().click();
await p.getByText('need attention').locator('visible=true').first().waitFor({timeout:15000});
await p.waitForTimeout(3000);
await p.getByText('Report',{exact:true}).locator('visible=true').last().click();
await p.waitForTimeout(2500);
rec=true;
await p.getByText('All time',{exact:false}).locator('visible=true').first().click();
await p.waitForTimeout(900);
await p.getByText('Last 30 days',{exact:true}).locator('visible=true').last().click({force:true});
await p.waitForTimeout(3500);
console.log(JSON.stringify({rangeChange:calls,total:+calls.reduce((t,c)=>t+c.kb,0).toFixed(1)},null,1));
const txt=await p.evaluate(()=>document.body.innerText.slice(0,300));
console.log("SCREEN:",txt.replace(/\n/g,' | ').slice(0,260));
await b.close();
