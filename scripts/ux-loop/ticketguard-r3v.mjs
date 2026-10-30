/* Regression guard: a resubmitted new-record request must carry ticket=N on the wire. */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const APP='http://127.0.0.1:8124/', API='http://127.0.0.1:8787/';
const out='/tmp/ux-out/r3v-qa-ticketguard'; mkdirSync(out,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage(); const R={}; let shot=0;
const reqs=[]; p.on('request',r=>{if(r.url().startsWith(API))reqs.push(r.url());});
const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200))});
const snap=n=>p.screenshot({path:`${out}/${String(++shot).padStart(2,'0')}-${n}.png`});
const txt=async()=>(await p.evaluate(()=>document.body.innerText)).split('\n').map(s=>s.trim()).filter(Boolean);
await p.goto(APP,{waitUntil:'load'});
const sk=p.getByText('Skip',{exact:false}).locator('visible=true'); if(await sk.count()) await sk.first().click();
await p.getByPlaceholder('Username').waitFor({timeout:20000});
await p.getByPlaceholder('Username').fill('manager'); await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await p.getByText('Unlock').locator('visible=true').first().click();
await p.getByText('need attention').locator('visible=true').first().waitFor({timeout:15000});
await p.waitForTimeout(2500);
/* 1) create a fresh request */
await p.getByText('Add',{exact:true}).locator('visible=true').last().click(); await p.waitForTimeout(900);
const set=async(l,v)=>{const x=p.getByText(l,{exact:false}).locator('visible=true').first();
  await x.waitFor({timeout:8000}); await x.locator('xpath=./following::input[1]').first().fill(v);};
await set('Net earned','5150');
await p.getByText('Submit for approval',{exact:false}).locator('visible=true').first().click();
await p.waitForFunction(()=>/request #\d+/i.test(document.body.innerText),{timeout:15000});
await p.waitForTimeout(2200);
const body1=await txt();
const m=body1.join(' ').match(/request #(\d+)/i); R.ticketCreated=m&&m[1];
const addUrls1=reqs.filter(u=>/action=addBooking/.test(u));
R.firstSubmit={url:addUrls1[addUrls1.length-1].replace(API,''),hasTicketParam:/[?&]ticket=/.test(addUrls1[addUrls1.length-1])};
await snap('sent-panel');
/* 2) resubmit it: use the SentPanel's "View request #N" then "Edit request" */
const view=p.getByText(/View request #/).locator('visible=true').first();
R.viewRequestVisible=await view.count()>0;
if(R.viewRequestVisible){ await view.click(); await p.waitForTimeout(1800); }
await snap('request-view');
const ed=p.getByText('Edit request',{exact:false}).locator('visible=true').first();
R.editRequestVisible=await ed.count()>0;
if(R.editRequestVisible){ await ed.click(); await p.waitForTimeout(2000); }
await snap('edit-request-form');
const bodyE=await txt();
R.resubmitFormTitle=bodyE.filter(l=>/edit request|update request #|request #/i.test(l)).slice(0,6);
await set('Net earned','5151');
const before=reqs.length;
const btn=p.getByText(/Update request #\d+|Submit for approval/).locator('visible=true').first();
R.resubmitButtonLabel=await btn.count()? await btn.innerText() : null;
const t=Date.now();
if(await btn.count()){ await btn.click();
  try{ await p.waitForFunction(()=>/updated|request #\d+/i.test(document.body.innerText),{timeout:15000}); }catch{}
}
await p.waitForTimeout(2500);
const newUrls=reqs.slice(before).filter(u=>/action=(addBooking|addExpense|addSaving|addProperty|invAddItem|invAddMovement)/.test(u));
R.resubmit={ms:Date.now()-t, urls:newUrls.map(u=>u.replace(API,'')),
  hasTicketParam:newUrls.map(u=>/[?&]ticket=\d+/.test(u)),
  ticketValues:newUrls.map(u=>(u.match(/[?&]ticket=(\d+)/)||[])[1]||null)};
const bodyR=await txt();
R.resubmitResult=bodyR.filter(l=>/updated|request #\d+|sent to an admin/i.test(l)).slice(0,6);
await snap('after-resubmit');
R.consoleErrors=errs;
writeFileSync(`${out}/ticketguard.json`,JSON.stringify(R,null,2));
console.log(JSON.stringify(R,null,1));
await b.close();
