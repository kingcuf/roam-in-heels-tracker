import { chromium } from 'playwright';
const b=await chromium.launch();
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await c.newPage();
p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE_ERR',m.text().slice(0,300))});
p.on('pageerror',e=>console.log('PAGEERR',String(e).slice(0,300)));
await p.goto('http://127.0.0.1:8124/',{waitUntil:'load'});
await p.waitForTimeout(11000);
console.log('LS after launch1:', await p.evaluate(()=>JSON.stringify(localStorage)));
const t=Date.now();
await p.goto('http://127.0.0.1:8124/',{waitUntil:'load'});
for(const ms of [200,500,1000,2000,4000,8000]){
  await p.waitForTimeout(ms===200?200:ms - (ms/2));
  const st=await p.evaluate(()=>({txt:document.body.innerText.slice(0,120).replace(/\n/g,'|'),inputs:document.querySelectorAll('input').length}));
  console.log(Date.now()-t,'ms',JSON.stringify(st));
}
await p.screenshot({path:'/tmp/ux-out/dbg-launch2.png'});
await b.close();
