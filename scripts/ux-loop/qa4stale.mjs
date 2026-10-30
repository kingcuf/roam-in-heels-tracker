/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* r4 #2 stale success panel after a FAILED submit; #4 delete confirm sheet, zero native dialogs. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP=process.argv[2]||'http://127.0.0.1:8124/',API='http://127.0.0.1:8787/';
const OUT=process.argv[3]||'/tmp/ux-out/r4-qa-stale';mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:3,timezoneId:'Asia/Kolkata'});
const p=await ctx.newPage();
const dialogs=[];p.on('dialog',async d=>{dialogs.push({type:d.type(),message:d.message()});await d.accept();});
const nonLocal=[],calls=[];
p.on('request',r=>{const u=r.url();if(/^https?:/.test(u)&&!u.startsWith(API)&&!u.startsWith(APP))nonLocal.push(u.slice(0,110));if(u.startsWith(API))calls.push(new URL(u).searchParams.get('action'));});
let n=0;const shot=l=>p.screenshot({path:`${OUT}/${String(++n).padStart(2,'0')}-${l}.png`});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
const txt=async()=>(await p.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ');
const R={app:APP};
await p.goto(APP,{waitUntil:'load'});
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1500);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');
await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3400);
await vis('Add').first().click();await p.waitForTimeout(1600);
await p.getByText('Expense',{exact:true}).locator('visible=true').first().click({force:true});await p.waitForTimeout(1400);
const amtTag=async()=>p.evaluate(()=>{const i=[...document.querySelectorAll('input')].filter(e=>e.offsetParent&&e.inputMode==='decimal')[0];if(!i)return false;i.setAttribute('data-a','1');return true;});
/* 1) a SUCCESSFUL submit */
await p.locator('text=Select…').locator('visible=true').first().click({force:true});await p.waitForTimeout(1700);
await p.getByText('Caretaker',{exact:true}).locator('visible=true').first().click({force:true});await p.waitForTimeout(900);
await p.getByPlaceholder('e.g. Monthly rent').first().fill('UX r4 success');
await amtTag(); await p.locator('input[data-a]').first().fill('250');
let c0=calls.length;
await vis('Submit for approval').first().click({force:true});await p.waitForTimeout(3000);
const okText=await txt();
R.afterSuccess={panel:(okText.match(/Request #\d+ sent[^•]{0,70}/i)||[null])[0],apiCalls:calls.slice(c0)};
console.log('after SUCCESS:',JSON.stringify(R.afterSuccess));
await shot('after-success');
/* 2) a FAILED submit on the same form: valid item, amount left blank */
await p.getByPlaceholder('e.g. Monthly rent').first().fill('UX r4 failure');
await amtTag(); await p.locator('input[data-a]').first().fill('');
c0=calls.length;
await vis('Submit for approval').first().click({force:true});
await p.waitForTimeout(2500);
const failText=await txt();
R.afterFail={
  stalePanel:(failText.match(/Request #\d+ sent[^•]{0,70}/i)||[null])[0],
  anyRequestNSent:/Request #\d+ sent/i.test(failText),
  complaint:(failText.match(/Enter the amount|Amount must be[^•]{0,70}|Pick a category/i)||[null])[0],
  apiCalls:calls.slice(c0)};
console.log('after FAILURE:',JSON.stringify(R.afterFail));
await shot('after-fail');
/* 2b) same test on Add Booking */
await p.getByText('Booking',{exact:true}).locator('visible=true').first().click({force:true});await p.waitForTimeout(1500);
await p.evaluate(()=>{const i=[...document.querySelectorAll('input')].filter(e=>e.offsetParent&&e.inputMode==='decimal');i[1]&&i[1].setAttribute('data-n','1');});
await p.locator('input[data-n]').first().fill('5150').catch(()=>{});
c0=calls.length;
await vis('Submit for approval').first().click({force:true});await p.waitForTimeout(3000);
let bt=await txt();
R.bookingSuccess=(bt.match(/Request #\d+ sent[^•]{0,70}/i)||[null])[0];
await p.locator('input[data-n]').first().fill('').catch(()=>{});
c0=calls.length;
await vis('Submit for approval').first().click({force:true});await p.waitForTimeout(2500);
bt=await txt();
R.bookingAfterFail={stalePanel:(bt.match(/Request #\d+ sent[^•]{0,70}/i)||[null])[0],anyRequestNSent:/Request #\d+ sent/i.test(bt),apiCalls:calls.slice(c0)};
console.log('booking success panel:',R.bookingSuccess,'| booking after fail:',JSON.stringify(R.bookingAfterFail));
await shot('booking-after-fail');
/* 4) delete confirm: native dialogs vs in-app sheet */
const d0=dialogs.length;
await vis('☰ Log').first().click({force:true});await p.waitForTimeout(2600);
const opened=await p.evaluate(()=>{const rows=[...document.querySelectorAll('div[tabindex]')].filter(e=>{if(!e.offsetParent)return false;const t=(e.innerText||'').trim();const r=e.getBoundingClientRect();return r.width>250&&/\d{4}-\d{2}-\d{2}/.test(t)&&/Spira/.test(t);});const e=rows[0];if(!e)return null;e.setAttribute('data-pick','1');return (e.innerText||'').trim().replace(/\s+/g,' ').slice(0,60);});
R.deleteRow=opened;
if(opened){
  await p.locator('div[data-pick]').first().click({force:true});await p.waitForTimeout(2600);
  R.formBeforeDelete={primaryButtons:await p.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.offsetParent&&/^(Submit for approval|Submit a change instead|Update request #\d+)$/.test((e.innerText||'').trim())).map(e=>(e.innerText||'').trim()))};
  await p.evaluate(()=>{[...document.querySelectorAll('div')].filter(e=>e.scrollHeight>e.clientHeight+50&&e.clientHeight>300).forEach(e=>e.scrollTop=e.scrollHeight);});
  await p.waitForTimeout(800);
  c0=calls.length;
  await vis('Request delete').first().click({force:true,timeout:8000});
  await p.waitForTimeout(1600);
  const sheetText=await txt();
  R.confirmSheet={
    nativeDialogs:dialogs.slice(d0),
    hasBackdrop:await p.evaluate(()=>!!document.querySelector('div[aria-label="Close"]')),
    question:(sheetText.match(/(Send a request to delete[^•]{0,90}|Delete this booking[^•]{0,90}|delete[^•]{0,80}\?)/i)||[null])[0],
    buttons:await p.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.offsetParent&&/^(Cancel|Send request|Delete|Yes|Confirm)$/.test((e.innerText||'').trim())).map(e=>{const r=e.getBoundingClientRect();return{t:(e.innerText||'').trim(),x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};})),
    apiCallsSoFar:calls.slice(c0)};
  console.log('CONFIRM SHEET:',JSON.stringify(R.confirmSheet,null,1));
  await shot('confirm-sheet');
  /* press the danger button */
  try{await p.getByText('Send request',{exact:true}).locator('visible=true').last().click({force:true,timeout:5000});}catch(e){R.sendErr=String(e).split('\n')[0].slice(0,70);}
  await p.waitForTimeout(3000);
  const after=await txt();
  R.afterDelete={msg:(after.match(/Delete booking[^•]{0,140}/i)||[null])[0],apiCalls:calls.slice(c0),nativeDialogs:dialogs.slice(d0),
    primaryButtons:await p.evaluate(()=>[...document.querySelectorAll('*')].filter(e=>e.offsetParent&&/^(Submit for approval|Submit a change instead)$/.test((e.innerText||'').trim())).map(e=>(e.innerText||'').trim())),
    sub:(after.match(/B\d+ · delete requested/i)||[null])[0]};
  console.log('AFTER DELETE:',JSON.stringify(R.afterDelete,null,1));
  await shot('after-delete');
}
R.totalNativeDialogs=dialogs;
R.nonLocal=[...new Set(nonLocal)];
writeFileSync(`${OUT}/stale.json`,JSON.stringify(R,null,2));
console.log('native dialogs total:',dialogs.length,'| non-local:',R.nonLocal.length?R.nonLocal:'none','|',OUT);
await b.close();
