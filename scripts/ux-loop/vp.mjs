import { chromium } from 'playwright';
const b=await chromium.launch();
for (const mob of [true,false]) {
  const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:mob,hasTouch:mob,deviceScaleFactor:mob?3:1});
  const p=await ctx.newPage();
  await p.goto('http://127.0.0.1:8124/',{waitUntil:'load'});
  await p.waitForTimeout(1500);
  console.log('isMobile',mob, await p.evaluate(()=>({inner:innerWidth, clientW:document.documentElement.clientWidth, scrollW:document.documentElement.scrollWidth, vv:visualViewport&&{w:Math.round(visualViewport.width),scale:visualViewport.scale}, bodyW:Math.round(document.body.getBoundingClientRect().width), rootW:Math.round((document.getElementById('root')||document.body).getBoundingClientRect().width)})));
  // widest at the login screen
  console.log('  widest:', await p.evaluate(()=>{let m=0,t=null;document.querySelectorAll('*').forEach(e=>{const r=e.getBoundingClientRect(); if(r.right>m){m=r.right;t=e.tagName+'.'+(e.className||'').toString().slice(0,40)}});return {m:Math.round(m),t}}));
  await ctx.close();
}
await b.close();
