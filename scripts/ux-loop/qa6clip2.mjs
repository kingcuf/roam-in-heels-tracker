/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
import { chromium } from 'playwright';
const APP='http://127.0.0.1:8124/';
const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:390,height:844},hasTouch:true,deviceScaleFactor:2});const p=await ctx.newPage();
const vis=t=>p.getByText(t,{exact:false}).locator('visible=true');
await p.goto(APP,{waitUntil:'load'});await p.waitForTimeout(1200);
try{await vis('Skip').first().waitFor({state:'visible',timeout:12000});await vis('Skip').first().click();await p.waitForTimeout(1200);}catch{}
await p.getByPlaceholder('Username').first().fill('manager');await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click();await p.waitForTimeout(3500);
await vis('Add').first().click({force:true});await p.waitForTimeout(1800);
const r=await p.evaluate(()=>{
  const dec=[...document.querySelectorAll('input')].filter(e=>e.inputMode==='decimal');
  const net=dec[1],gp=dec[0];
  const cs=getComputedStyle(net);
  const cv=document.createElement('canvas').getContext('2d');
  cv.font=`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const inner=net.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
  const w=s=>Math.round(cv.measureText(s).width*10)/10;
  const csg=getComputedStyle(gp);
  const cvg=document.createElement('canvas').getContext('2d');
  cvg.font=`${csg.fontStyle} ${csg.fontWeight} ${csg.fontSize} ${csg.fontFamily}`;
  const innerG=gp.clientWidth-parseFloat(csg.paddingLeft)-parseFloat(csg.paddingRight);
  return {font:cv.font,padL:cs.paddingLeft,padR:cs.paddingRight,clientW:net.clientWidth,innerTextW:inner,
    samples:['5000','1250.50','-1250.50','-125000.50','-1250000.50'].map(s=>({s,w:w(s),fits:w(s)<=inner})),
    guestPaidInner:innerG, guestPaidSample:{s:'-1250000.50',w:Math.round(cvg.measureText('1250000.50').width)}};
});
console.log(JSON.stringify(r,null,1));
await b.close();
