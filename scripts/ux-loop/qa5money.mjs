/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* R5: money notes + caret survival, money-card reveal on focus, scroll-to-first-error. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP='http://127.0.0.1:8124/',API='http://127.0.0.1:8787/';
const OUT=process.argv[2]||'/tmp/ux-out/r5-qa-money';mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2,timezoneId:'Asia/Kolkata'});
const p=await ctx.newPage();
const nonLocal=[];p.on('request',r=>{const u=r.url();if(/^https?:/.test(u)&&!u.startsWith(API)&&!u.startsWith(APP))nonLocal.push(u.slice(0,110));});
const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
let n=0;const shot=l=>p.screenshot({path:`${OUT}/${String(++n).padStart(2,'0')}-${l}.png`});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
const R={notes:[],caret:[],reveal:{},errScroll:{},consoleErrors:errs};

await p.goto(APP,{waitUntil:'load'});
await p.waitForTimeout(1200);
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');
await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3500);
await vis('Add').first().click({force:true});await p.waitForTimeout(1800);

/* ---------- money field: Net earned = 2nd decimal-mode input on the booking form ---------- */
const netH=await p.evaluateHandle(()=>[...document.querySelectorAll('input')].filter(e=>e.inputMode==='decimal')[1]);

const NOTE_SEL=()=>p.evaluate(()=>{
  const t=[...document.querySelectorAll('div,span')].map(e=>(e.childElementCount===0?(e.textContent||''):'').trim())
    .filter(s=>/not part of an amount|two decimals|cannot be negative|One decimal point/i.test(s));
  return [...new Set(t)];
});

/* scroll so a money field is present; Net earned lives in card 4 */

/* ---------- 3. reveal on focus: top of money card before/after tapping Net earned ---------- */
const moneyCardTop=()=>p.evaluate(()=>{
  const dec=[...document.querySelectorAll('input')].filter(e=>e.inputMode==='decimal');
  const bb=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{top:Math.round(r.top),left:Math.round(r.left),onScreen:r.top>=0&&r.bottom<=window.innerHeight};};
  return {guestPaid:bb(dec[0]),net:bb(dec[1]),commission:bb(dec[2]),pending:bb(dec[3]),innerH:window.innerHeight};
});
R.reveal.before=await moneyCardTop();
await shot('before-focus');
await p.evaluate(e=>e&&e.focus(),netH);
await p.waitForTimeout(1400);
R.reveal.after=await moneyCardTop();
R.reveal.focusedIsNet=await p.evaluate(e=>document.activeElement===e,netH);
await shot('after-focus-net');

/* ---------- 1. notes + caret ---------- */
const cases=[['12ab34','1234'],['1.2.3','1.23'],['1250.505','1250.50'],['-500','500'],['25,000','25000']];
for(const [input,expect] of cases){
  await p.evaluate(e=>{e.focus();},netH);
  // clear
  await p.keyboard.press('Control+A').catch(()=>{});
  await p.evaluate(e=>{const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));},netH);
  await p.waitForTimeout(700);
  const perKey=[];
  for(const ch of input){
    await p.keyboard.type(ch,{delay:60});
    await p.waitForTimeout(140);
    const st=await p.evaluate(e=>({v:e.value,focused:document.activeElement===e,sel:e.selectionStart,same:document.activeElement&&document.activeElement.tagName}),netH);
    const notes=await NOTE_SEL();
    perKey.push({ch,...st,notes});
  }
  await p.waitForTimeout(300);
  const final=await p.evaluate(e=>({v:e.value,focused:document.activeElement===e,sel:e.selectionStart}),netH);
  R.notes.push({input,expect,got:final.v,pass:final.v===expect,notes:await NOTE_SEL(),
    focusKept:perKey.every(k=>k.focused),caret:perKey.map(k=>k.sel),perKey});
  await shot('note-'+input.replace(/[^a-z0-9]/gi,'_'));
  console.log(input,'->',final.v,'expect',expect,'focusKept',perKey.every(k=>k.focused),'notes',JSON.stringify(await NOTE_SEL()));
}
/* note timeout ~4s */
await p.waitForTimeout(4500);
R.noteAfter4500ms=await NOTE_SEL();

/* ---------- 4. scroll-to-first-error ---------- */
await p.evaluate(e=>{const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));},netH);
await p.waitForTimeout(500);
// scroll to top first so a naive implementation looks "fine"
await p.evaluate(()=>{const sc=[...document.querySelectorAll('div')].find(d=>d.scrollHeight>d.clientHeight+50&&getComputedStyle(d).overflowY!=='visible');if(sc)sc.scrollTop=0;window.scrollTo(0,0);});
await p.waitForTimeout(600);
R.errScroll.beforeSubmit=await moneyCardTop();
await shot('before-submit');
await vis('Submit for approval').first().click({force:true});
await p.waitForTimeout(2200);
R.errScroll.afterSubmit=await moneyCardTop();
R.errScroll.messages=await p.evaluate(()=>{
  const out=[];
  for(const e of document.querySelectorAll('div,span')){
    if(e.childElementCount)continue;const t=(e.textContent||'').trim();
    if(!t||t.length>90)continue;
    const cs=getComputedStyle(e);const col=cs.color;
    if(/required|must be|Pick|Choose|Enter/i.test(t)){const r=e.getBoundingClientRect();out.push({t,y:Math.round(r.top),color:col,onScreen:r.top>=0&&r.bottom<=window.innerHeight});}
  }
  return out;
});
await shot('after-submit');
R.errScroll.docScrollW=await p.evaluate(()=>document.documentElement.scrollWidth);
R.nonLocal=[...new Set(nonLocal)];
writeFileSync(`${OUT}/money.json`,JSON.stringify(R,null,2));
console.log('reveal',JSON.stringify(R.reveal));
console.log('errScroll',JSON.stringify(R.errScroll,null,1).slice(0,2000));
console.log('nonLocal',R.nonLocal,'consoleErrors',errs.slice(0,5));
await b.close();
