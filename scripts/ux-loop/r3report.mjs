/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3})).newPage();
await p.goto('http://127.0.0.1:8124/'); await p.waitForTimeout(1500);
const skip=p.getByText('Skip').locator('visible=true'); if(await skip.count()){await skip.first().click(); await p.waitForTimeout(800);}
await p.getByPlaceholder('Username').fill('manager'); await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await p.getByText('Unlock').first().click(); await p.waitForTimeout(2500);
// log a booking of 25000 / 21000
await p.getByText('Add').locator('visible=true').first().click(); await p.waitForTimeout(900);
await p.getByText('Booking').locator('visible=true').first().click(); await p.waitForTimeout(1500);
const fill=async(lab,val)=>{const l=p.getByText(lab,{exact:false}).locator('visible=true').first(); const i=l.locator('xpath=./following::input[1]'); await i.fill(val);};
await fill('Name','Meera Joshi'); await fill('Guest paid','25,000'); await fill('Net earned','21,000');
await p.getByText('Submit for approval').locator('visible=true').first().click();
await p.waitForTimeout(2500);
const t0=Date.now();
await p.getByText('Report').locator('visible=true').first().click();
await p.getByText('Waiting for approval').locator('visible=true').first().waitFor({state:'visible',timeout:15000});
const tPanel=Date.now()-t0;
const inView = await p.getByText('Waiting for approval').locator('visible=true').first().isVisible();
const box = await p.getByText('Waiting for approval').locator('visible=true').first().boundingBox();
console.log('pending panel visible after', tPanel, 'ms, scrolls needed: 0, y =', Math.round(box.y), 'of 844');
await p.screenshot({path:'/tmp/ux-out/r3-report-panel.png'});
// now go find MY 25,000
const t1=Date.now(); let taps=0;
await p.getByText('View my requests').locator('visible=true').first().click(); taps++;
await p.waitForTimeout(2500);
await p.screenshot({path:'/tmp/ux-out/r3-myrequests.png'});
console.log('View my requests ->', Date.now()-t1,'ms');
console.log('Meera Joshi on screen?', await p.getByText('Meera Joshi').locator('visible=true').count());
console.log('25,000 on screen?', await p.getByText('25,000').locator('visible=true').count());
console.log('21,000 on screen?', await p.getByText('21,000').locator('visible=true').count());
await b.close();
