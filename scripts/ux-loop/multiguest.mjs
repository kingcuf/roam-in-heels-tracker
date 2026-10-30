/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
const API='http://127.0.0.1:8787/';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage();
const calls=[]; p.on('response',r=>{if(r.url().startsWith(API)){const u=new URL(r.url());
  calls.push({a:u.searchParams.get('action'),row:u.searchParams.get('row')})}});
await p.goto('http://127.0.0.1:8124/',{waitUntil:'load'}); await p.waitForTimeout(500);
await p.getByText('Skip').locator('visible=true').first().click(); await p.waitForTimeout(900);
await p.getByPlaceholder('Username').fill('manager'); await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await p.getByText('Unlock').locator('visible=true').first().click();
await p.getByText('need attention').locator('visible=true').first().waitFor({timeout:15000});
await p.waitForTimeout(2500);
await p.getByText('Add',{exact:true}).locator('visible=true').last().click(); await p.waitForTimeout(900);
await p.getByText('☰ Log',{exact:false}).locator('visible=true').first().click(); await p.waitForTimeout(1500);
// search for Pardeep
await p.getByPlaceholder('Search all columns').fill('Pardeep'); await p.waitForTimeout(1200);
const n0=calls.length;
await p.getByText('2026-06-14',{exact:true}).locator('visible=true').first().click();
await p.waitForTimeout(2500);
console.log('calls after opening 3-guest booking:', JSON.stringify(calls.slice(n0)));
await p.screenshot({path:'/tmp/ux-out/r1-qa-editbooking/multiguest.png'});
await b.close();
