/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* r3: money field behaviour — commission case, paste vs type, submit-time refusal. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP='http://127.0.0.1:8124/', API='http://127.0.0.1:8787/';
const OUT=process.argv[2]||'/tmp/ux-out/r3-qa-money';
mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,timezoneId:'Asia/Kolkata'});
const p=await ctx.newPage();
const nonLocal=[]; const calls=[];
p.on('request',r=>{const u=r.url(); if(/^https?:/.test(u)&&!u.startsWith(API)&&!u.startsWith(APP)) nonLocal.push(u.slice(0,110)); if(u.startsWith(API)) calls.push(u);});
let n=0; const shot=l=>p.screenshot({path:`${OUT}/${String(++n).padStart(2,'0')}-${l}.png`});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
const R={};
await p.goto(APP,{waitUntil:'load'});
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
await p.getByPlaceholder('Username').first().waitFor({timeout:20000});
await p.getByPlaceholder('Username').first().fill('manager');
await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await p.keyboard.press('Enter'); await p.waitForTimeout(3000);
await vis('Add').first().click(); await p.waitForTimeout(1500);
await p.getByText('Booking',{exact:true}).locator('visible=true').first().click({force:true});
await p.waitForTimeout(1200);
const byPh = ph => p.getByPlaceholder(ph).locator('visible=true').first();
/* find money inputs by their label text */
const tagMoney = () => p.evaluate(()=>{
  const vz=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&e.offsetParent!==null;};
  const w=document.createTreeWalker(document.body,NodeFilter.SHOW_ELEMENT); let buf=[]; const found={};
  const want={'Guest paid':'paid','Net earned':'net','Commission':'comm','Pending':'pend','Amount':'amt'};
  while(w.nextNode()){const e=w.currentNode;
    if(e.tagName==='INPUT'&&vz(e)&&e.type!=='date'){
      for(const k in want){ if(buf.some(x=>x.startsWith(k))&&!found[want[k]]){ e.setAttribute('data-m',want[k]); found[want[k]]=1; break; } }
      continue;}
    const t=(e.textContent||'').trim();
    if(t&&!t.includes('\n')&&t.length<40&&!e.querySelector('input')&&vz(e)){buf.push(t); if(buf.length>3)buf.shift();}}
  return found;});
R.bookingTagged = await tagMoney();
const M = k => p.locator(`input[data-m="${k}"]`);
/* ── THE COMMISSION CASE ── */
R.commission = {};
for (const [name, paid, net] of [['commas','25,000','21,000'],['plain','25000','21000'],['rupee','₹25,000','₹21,000']]) {
  await M('paid').fill(''); await M('net').fill(''); await M('comm').fill('');
  await M('paid').type(paid,{delay:20}); await p.waitForTimeout(200);
  await M('net').type(net,{delay:20}); await p.waitForTimeout(600);
  R.commission[name]={typedPaid:paid,typedNet:net,
    storedPaid:await M('paid').inputValue(),storedNet:await M('net').inputValue(),
    commission:await M('comm').inputValue(),pending:R.bookingTagged.pend?await M('pend').inputValue():null};
  console.log(name,JSON.stringify(R.commission[name]));
}
await shot('commission');
/* ── paste (fill) rather than keystrokes ── */
R.bookingPaste={};
for(const v of ['12ab34','1.2.3','1e3','(500)','1250.505','-500','₹25,000','1 000','25,000','25000','1250.50']){
  await M('net').fill(''); await M('net').fill(v); await p.waitForTimeout(150);
  R.bookingPaste[v]=await M('net').inputValue();
}
console.log('booking net PASTE:',JSON.stringify(R.bookingPaste));
/* ± button on Net earned */
await M('net').fill('500'); await p.waitForTimeout(200);
try{ await p.getByText('±',{exact:true}).locator('visible=true').first().click({force:true}); await p.waitForTimeout(400);
  R.plusMinus={after:await M('net').inputValue()};}catch(e){R.plusMinus={err:String(e).slice(0,80)};}
console.log('± ->',JSON.stringify(R.plusMinus));
/* typed minus */
await M('net').fill(''); await M('net').type('-500',{delay:20}); await p.waitForTimeout(200);
R.netTypedMinus=await M('net').inputValue();
console.log('net typed -500 ->',R.netTypedMinus);
await shot('net-minus');
/* ── Expense Amount: paste + submit refusal ── */
await p.getByText('Expense',{exact:true}).locator('visible=true').first().click({force:true});
await p.waitForTimeout(1200);
R.expenseTagged=await tagMoney();
R.expensePaste={};
for(const v of ['12ab34','1.2.3','1e3','(500)','1250.505','-500','₹25,000','1 000','25,000','25000','1250.50']){
  await M('amt').fill(''); await M('amt').fill(v); await p.waitForTimeout(120);
  R.expensePaste[v]=await M('amt').inputValue();
}
console.log('expense amount PASTE:',JSON.stringify(R.expensePaste));
/* submit with a pasted malformed value -> what message, how many API calls */
await M('amt').fill('1250.505');
await p.getByPlaceholder('e.g. Monthly rent').first().fill('UX r3 submit probe');
try{await p.locator('text=Select…').locator('visible=true').first().click({force:true});await p.waitForTimeout(1200);
  await p.getByText('Caretaker',{exact:true}).locator('visible=true').first().click({force:true});await p.waitForTimeout(800);}catch{}
const before=calls.length;
await vis('Submit for approval').first().click({force:true}); await p.waitForTimeout(2500);
R.submitMalformed={typed:'1250.505',stored:await M('amt').inputValue(),
  apiCalls:calls.slice(before).map(u=>new URL(u).searchParams.get('action')),
  screenText:(await p.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ').match(/(Amount must be[^.]*\.?|must be a number[^.]*\.?|request #\d+)/i)};
console.log('submit malformed ->',JSON.stringify(R.submitMalformed));
await shot('submit-malformed');
R.nonLocal=[...new Set(nonLocal)];
writeFileSync(`${OUT}/money.json`,JSON.stringify(R,null,2));
console.log('non-local:',R.nonLocal.length?R.nonLocal:'none','|',OUT);
await b.close();
