/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* R5b: (a) -500 on an UNSIGNED money field, (b) ± button box on the signed field,
   (c) expense category sheet left edge. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP='http://127.0.0.1:8124/',API='http://127.0.0.1:8787/';
const OUT=process.argv[2]||'/tmp/ux-out/r5-qa-b';mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2,timezoneId:'Asia/Kolkata'});
const p=await ctx.newPage();
const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
let n=0;const shot=l=>p.screenshot({path:`${OUT}/${String(++n).padStart(2,'0')}-${l}.png`});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
const R={consoleErrors:errs};
const NOTES=()=>p.evaluate(()=>[...new Set([...document.querySelectorAll('div,span')]
  .filter(e=>!e.childElementCount).map(e=>(e.textContent||'').trim())
  .filter(s=>/not part of an amount|decimals|negative|decimal point/i.test(s)))]);

await p.goto(APP,{waitUntil:'load'});await p.waitForTimeout(1200);
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');
await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3500);
await vis('Add').first().click({force:true});await p.waitForTimeout(1800);

/* (b) ± button + signed row geometry */
const gp=await p.evaluateHandle(()=>[...document.querySelectorAll('input')].filter(e=>e.inputMode==='decimal')[0]);
const net=await p.evaluateHandle(()=>[...document.querySelectorAll('input')].filter(e=>e.inputMode==='decimal')[1]);
await p.evaluate(e=>e.focus(),net);await p.waitForTimeout(1200);
R.signedRow=await p.evaluate((netEl)=>{
  const bb=e=>{const r=e.getBoundingClientRect();return{l:Math.round(r.left),r:Math.round(r.right),w:Math.round(r.width),h:Math.round(r.height),t:Math.round(r.top)};};
  const row=netEl.parentElement;
  const btn=[...row.children].find(c=>c!==netEl&&!c.contains(netEl));
  return {input:bb(netEl),row:bb(row),plusMinus:btn?bb(btn):null,vw:window.innerWidth,
    pmText:btn?(btn.innerText||'').trim():null};
},net);
await shot('signed-row');

/* (a) -500 into Guest paid (unsigned) */
await p.evaluate(e=>{e.focus();const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));},gp);
await p.waitForTimeout(600);
const perKey=[];
for(const ch of '-500'){
  await p.keyboard.type(ch,{delay:70});await p.waitForTimeout(160);
  perKey.push({ch,...(await p.evaluate(e=>({v:e.value,focused:document.activeElement===e,sel:e.selectionStart}),gp)),notes:await NOTES()});
}
R.unsignedNeg={input:'-500',got:await p.evaluate(e=>e.value,gp),notes:await NOTES(),
  focusKept:perKey.every(k=>k.focused),caret:perKey.map(k=>k.sel),perKey};
await shot('unsigned-neg');
console.log('-500 on Guest paid ->',JSON.stringify(R.unsignedNeg.got),R.unsignedNeg.notes,'focusKept',R.unsignedNeg.focusKept);

/* (c) expense category sheet */
try{
  await p.getByText('Expense',{exact:true}).locator('visible=true').first().click({force:true});
  await p.waitForTimeout(1800);
  R.expenseW=await p.evaluate(()=>document.documentElement.scrollWidth);
  await shot('expense-form');
  const sel=p.locator('text=Select…').locator('visible=true').first();
  await sel.click({force:true});
  await p.waitForTimeout(1800);
  await shot('category-sheet');
  R.sheet=await p.evaluate(()=>{
    const docW=document.documentElement.scrollWidth;
    const heads=[...document.querySelectorAll('div,span')].filter(e=>!e.childElementCount&&/^CATEGORY|^Category$/i.test((e.textContent||'').trim()));
    const opts=[...document.querySelectorAll('div,span')].filter(e=>!e.childElementCount&&(e.textContent||'').trim().length&&(e.textContent||'').trim().length<28)
      .map(e=>{const r=e.getBoundingClientRect();return{t:e.textContent.trim(),l:Math.round(r.left),r:Math.round(r.right),y:Math.round(r.top)};})
      .filter(o=>o.y>200&&o.r>0&&o.l<400);
    return {docW,vw:window.innerWidth,
      heads:heads.map(e=>{const r=e.getBoundingClientRect();return{t:e.textContent.trim(),l:Math.round(r.left),r:Math.round(r.right)};}),
      minLeft:Math.min(...opts.map(o=>o.l)), opts:opts.slice(0,18)};
  });
  console.log('sheet',JSON.stringify(R.sheet).slice(0,1200));
}catch(e){R.sheetErr=String(e).split('\n')[0].slice(0,120);console.log('sheetErr',R.sheetErr);}
writeFileSync(`${OUT}/b.json`,JSON.stringify(R,null,2));
console.log('signedRow',JSON.stringify(R.signedRow),'errs',errs.slice(0,4));
await b.close();
