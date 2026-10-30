/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* G: document horizontal extent at a true 390px viewport, every screen + an open picker. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP=process.argv[2]||'http://127.0.0.1:8124/',API='http://127.0.0.1:8787/';
const OUT=process.argv[3]||'/tmp/ux-out/r4-qa-width';mkdirSync(OUT,{recursive:true});
const MOBILE=process.argv[4]==='mobile';
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:MOBILE,hasTouch:true,deviceScaleFactor:3,timezoneId:'Asia/Kolkata'});
const p=await ctx.newPage();
const nonLocal=[];p.on('request',r=>{const u=r.url();if(/^https?:/.test(u)&&!u.startsWith(API)&&!u.startsWith(APP))nonLocal.push(u.slice(0,110));});
let n=0;const shot=l=>p.screenshot({path:`${OUT}/${String(++n).padStart(2,'0')}-${l}.png`});
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
const W=()=>p.evaluate(()=>({docScrollW:document.documentElement.scrollWidth,bodyScrollW:document.body.scrollWidth,innerW:window.innerWidth,innerH:window.innerHeight,
  panned:(()=>{window.scrollTo(9999,0);const x=window.scrollX;window.scrollTo(0,0);return x;})()}));
const R={app:APP,isMobile:MOBILE,screens:{}};
await p.goto(APP,{waitUntil:'load'});
await p.waitForTimeout(1500);
R.screens['intro/login-early']=await W();
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1400);}catch{}
R.screens['login']=await W(); await shot('login');
await p.getByPlaceholder('Username').first().fill('manager');
await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3400);
for(const tab of ['Action','Calendar','Report','Add','Team']){
  try{await vis(tab).first().click({force:true});}catch{}
  await p.waitForTimeout(2200);
  R.screens[tab]=await W();
  await shot(tab);
  console.log(tab,JSON.stringify(R.screens[tab]));
}
/* picker open on Add > Expense */
try{
  await vis('Add').first().click({force:true});await p.waitForTimeout(1600);
  await p.getByText('Expense',{exact:true}).locator('visible=true').first().click({force:true});await p.waitForTimeout(1400);
  R.screens['Add>Expense']=await W();
  await p.locator('text=Select…').locator('visible=true').first().click({force:true});await p.waitForTimeout(1800);
  R.screens['category picker open']=await W();
  await shot('picker');
  /* leftmost visible option box */
  R.optionBox=await p.evaluate(()=>{const e=[...document.querySelectorAll('div')].filter(x=>(x.innerText||'').trim()==='Caretaker'&&!x.querySelector('div'))[0];if(!e)return null;const r=e.getBoundingClientRect();return{x:Math.round(r.left),w:Math.round(r.width),y:Math.round(r.top)};});
}catch(e){R.pickerErr=String(e).split('\n')[0].slice(0,90);}
console.log('Add>Expense',JSON.stringify(R.screens['Add>Expense']),'picker',JSON.stringify(R.screens['category picker open']),'optionBox',JSON.stringify(R.optionBox));
R.nonLocal=[...new Set(nonLocal)];
writeFileSync(`${OUT}/width.json`,JSON.stringify(R,null,2));
console.log('non-local:',R.nonLocal.length?R.nonLocal:'none','|',OUT);
await b.close();
