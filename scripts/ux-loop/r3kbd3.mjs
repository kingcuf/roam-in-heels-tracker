/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3})).newPage();
await p.goto('http://127.0.0.1:8124/'); await p.waitForTimeout(2000);
let n=0; const shot=async(l)=>{await p.screenshot({path:`/tmp/ux-out/r3-kbd/B${String(++n).padStart(2,'0')}-${l}.png`});};
const where = () => p.evaluate(() => { const a=document.activeElement; return (a.tagName+'|'+(a.getAttribute('placeholder')||a.innerText||'')).slice(0,45); });
const t0=Date.now(); let keys=0;
await p.keyboard.press('Tab'); keys++; await p.keyboard.press('Tab'); keys++;
console.log('after 2 Tabs:', await where()); await shot('skip-focused');
await p.keyboard.press('Enter'); keys++; await p.waitForTimeout(1200);
console.log('after Enter:', await where()); await shot('signin');
// now tab to Username
for (let i=0;i<10;i++){ await p.keyboard.press('Tab'); keys++; const w=await where(); console.log('  Tab',keys,'->',w); if(/Username/.test(w)) break; }
await shot('username-focused');
await p.keyboard.type('manager'); keys+=7;
await p.keyboard.press('Tab'); keys++;
console.log('next field:', await where());
await p.keyboard.type(process.env.MANAGER_PIN); keys+=4;
await shot('filled');
await p.keyboard.press('Enter'); keys++; await p.waitForTimeout(3000);
const inApp = await p.getByText('Action').locator('visible=true').count();
console.log('Enter submitted? in app:', inApp>0, '| total ms', Date.now()-t0, '| keystrokes', keys);
await shot('after-enter');
if(!inApp){ for(let i=0;i<6;i++){ await p.keyboard.press('Tab'); keys++; const w=await where(); console.log('  Tab',keys,'->',w); if(/Unlock/.test(w)){ await p.keyboard.press('Enter'); keys++; break; } } await p.waitForTimeout(3000); console.log('after tabbing to Unlock, in app:', (await p.getByText('Action').locator('visible=true').count())>0, 'ms',Date.now()-t0,'keys',keys); await shot('after-unlock'); }
await b.close();
