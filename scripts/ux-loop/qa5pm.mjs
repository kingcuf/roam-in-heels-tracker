/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP='http://127.0.0.1:8124/';const OUT=process.argv[2];mkdirSync(OUT,{recursive:true});
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});const p=await ctx.newPage();
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
await p.goto(APP,{waitUntil:'load'});await p.waitForTimeout(1200);
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3500);
await vis('Add').first().click({force:true});await p.waitForTimeout(1800);
const net=await p.evaluateHandle(()=>[...document.querySelectorAll('input')].filter(e=>e.inputMode==='decimal')[1]);
await p.evaluate(e=>e.focus(),net);await p.waitForTimeout(1200);
const R={};
R.chain=await p.evaluate(e=>{const out=[];let c=e;for(let i=0;i<7&&c;i++){const r=c.getBoundingClientRect();const cs=getComputedStyle(c);
 out.push({i,tag:c.tagName,l:Math.round(r.left),r:Math.round(r.right),w:Math.round(r.width),disp:cs.display,fd:cs.flexDirection,flex:cs.flex,minW:cs.minWidth,ov:cs.overflow});c=c.parentElement;}return out;},net);
// type a value then tap plus-minus at its centre
await p.keyboard.type('500',{delay:60});await p.waitForTimeout(400);
R.before=await p.evaluate(e=>e.value,net);
const pm=await p.evaluate(e=>{const row=e.parentElement;const btn=[...row.children].find(c=>c!==e&&!c.contains(e));const r=btn.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,l:Math.round(r.left),r:Math.round(r.right),w:Math.round(r.width),h:Math.round(r.height),visibleW:Math.max(0,Math.min(r.right,390)-Math.max(r.left,0))};},net);
R.pm=pm;
try{await p.mouse.click(Math.min(pm.x,388),pm.y);}catch(e){R.tapErr=String(e).slice(0,80);}
await p.waitForTimeout(700);
R.afterTapCentre=await p.evaluate(e=>e.value,net);
// try tapping the visible sliver
try{await p.mouse.click(388,pm.y);}catch{}
await p.waitForTimeout(700);
R.afterTapSliver=await p.evaluate(e=>e.value,net);
await p.screenshot({path:`${OUT}/pm.png`});
writeFileSync(`${OUT}/pm.json`,JSON.stringify(R,null,2));
console.log(JSON.stringify(R,null,1));
await b.close();
