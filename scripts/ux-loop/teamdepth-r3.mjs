/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
import {writeFileSync,mkdirSync} from 'node:fs';
const out='/tmp/ux-out/r3-qa-teamdepth'; mkdirSync(out,{recursive:true});
const b=await chromium.launch();
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await c.newPage(); const R={}; const calls=[];
p.on('response',async r=>{if(r.url().startsWith('http://127.0.0.1:8787/'))calls.push(new URL(r.url()).searchParams.get('action'))});
await p.goto('http://127.0.0.1:8124/',{waitUntil:'load'});
const sk=p.getByText('Skip',{exact:false}).locator('visible=true'); if(await sk.count()) await sk.first().click();
await p.getByPlaceholder('Username').waitFor({timeout:20000});
await p.getByPlaceholder('Username').fill('manager'); await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await p.getByText('Unlock').locator('visible=true').first().click();
await p.getByText('need attention').locator('visible=true').first().waitFor({timeout:15000}); await p.waitForTimeout(2500);
let taps=0; const t0=Date.now();
await p.getByText('Team',{exact:true}).locator('visible=true').last().click(); taps++; await p.waitForTimeout(1200);
R.landingSegment=(await p.evaluate(()=>document.body.innerText)).split('\n').map(s=>s.trim()).filter(Boolean).slice(0,6);
await p.screenshot({path:out+'/01-team.png'});
const k=calls.length;
const ap=p.getByText('Approve',{exact:true}).locator('visible=true').first();
R.approveSegmentExists=await ap.count()>0;
if(R.approveSegmentExists){ await ap.click(); taps++; await p.waitForTimeout(1500); }
R.tapsFromLandingToApproveQueue=taps; R.secs=+((Date.now()-t0)/1000).toFixed(1);
R.callsOnApproveTap=calls.slice(k);
R.approveBody=(await p.evaluate(()=>document.body.innerText)).split('\n').map(s=>s.trim()).filter(Boolean).slice(0,18);
await p.screenshot({path:out+'/02-approve.png'});
writeFileSync(out+'/teamdepth.json',JSON.stringify(R,null,2)); console.log(JSON.stringify(R,null,1));
await b.close();
