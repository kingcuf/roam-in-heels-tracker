/* R6: signed money field after minWidth:0 fix — box, flip, value survival, clipping, note. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP='http://127.0.0.1:8124/';const OUT=process.argv[2];mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});
const p=await ctx.newPage();
const errs=[];p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160));});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
await p.goto(APP,{waitUntil:'load'});await p.waitForTimeout(1200);
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3500);
await vis('Add').first().click({force:true});await p.waitForTimeout(1800);
const net=await p.evaluateHandle(()=>[...document.querySelectorAll('input')].filter(e=>e.inputMode==='decimal')[1]);
await p.evaluate(e=>e.focus(),net);await p.waitForTimeout(1000);
const R={consoleErrors:errs};
const boxes=()=>p.evaluate(e=>{
  const row=e.parentElement;const btn=[...row.children].find(c=>c!==e&&!c.contains(e));
  const bb=x=>{const r=x.getBoundingClientRect();return{l:Math.round(r.left),r:Math.round(r.right),t:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height),
    fullyOnScreen:r.left>=0&&r.right<=window.innerWidth};};
  return {input:{...bb(e),scrollW:e.scrollWidth,clientW:e.clientWidth,clipped:e.scrollWidth>e.clientWidth+1},
    pm:{...bb(btn),meets44:Math.round(btn.getBoundingClientRect().width)>=44&&Math.round(btn.getBoundingClientRect().height)>=44},
    vw:window.innerWidth,docScrollW:document.documentElement.scrollWidth};
},net);
const notes=()=>p.evaluate(()=>[...new Set([...document.querySelectorAll('div,span')]
  .filter(e=>!e.childElementCount).map(e=>(e.textContent||'').trim())
  .filter(s=>/not part of an amount|two decimals|cannot be negative|One decimal point|Negative for a loss/i.test(s)))]);

R.empty=await boxes();
/* type a long-ish amount */
await p.keyboard.type('1250.50',{delay:60});await p.waitForTimeout(500);
R.typed={value:await p.evaluate(e=>e.value,net),...await boxes(),notes:await notes()};
/* flip via real tap at button centre */
const c=await p.evaluate(e=>{const row=e.parentElement;const btn=[...row.children].find(x=>x!==e&&!x.contains(e));const r=btn.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};},net);
await p.mouse.click(c.x,c.y);await p.waitForTimeout(600);
R.afterFlip1={value:await p.evaluate(e=>e.value,net),...await boxes()};
await p.screenshot({path:`${OUT}/01-neg.png`});
await p.mouse.click(c.x,c.y);await p.waitForTimeout(600);
R.afterFlip2={value:await p.evaluate(e=>e.value,net),...await boxes()};
/* value survives: keep typing after flip */
await p.evaluate(e=>e.focus(),net);
await p.mouse.click(c.x,c.y);await p.waitForTimeout(500);
await p.keyboard.press('End');await p.keyboard.type('9',{delay:60});await p.waitForTimeout(400);
R.afterFlipTypeMore={value:await p.evaluate(e=>e.value,net),caret:await p.evaluate(e=>e.selectionStart,net)};
/* money-rewrite note still fires on the signed field */
await p.evaluate(e=>{const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;s.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));e.focus();},net);
await p.waitForTimeout(500);
const caret=[];
for(const ch of '12ab34'){await p.keyboard.type(ch,{delay:60});await p.waitForTimeout(140);
  caret.push(await p.evaluate(e=>({v:e.value,sel:e.selectionStart,focused:document.activeElement===e}),net));}
R.rewrite={final:await p.evaluate(e=>e.value,net),caret,notes:await notes()};
await p.screenshot({path:`${OUT}/02-note.png`});
/* horizontal overflow on Add + money card */
R.overflow=await p.evaluate(()=>({docScrollW:document.documentElement.scrollWidth,bodyScrollW:document.body.scrollWidth,innerW:window.innerWidth,
  panned:(()=>{window.scrollTo(9999,0);const x=window.scrollX;window.scrollTo(0,0);return x;})()}));
writeFileSync(`${OUT}/pm2.json`,JSON.stringify(R,null,2));
console.log(JSON.stringify(R,null,1));
await b.close();
