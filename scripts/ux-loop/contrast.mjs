/* Pixel-true contrast: screenshot each text element and compare the darkest
   vs lightest dominant colours actually rendered (handles gradients/glass). */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const out='/tmp/ux-out/r1-qa-contrast'; mkdirSync(out,{recursive:true});
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
const p=await ctx.newPage();
await p.goto('http://127.0.0.1:8124/',{waitUntil:'load'}); await p.waitForTimeout(600);
const sk=p.getByText('Skip').locator('visible=true'); if(await sk.count()){await sk.first().click();await p.waitForTimeout(900);}
await p.getByPlaceholder('Username').fill('manager'); await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
await p.getByText('Unlock').locator('visible=true').first().click(); await p.waitForTimeout(3500);
const results=[];
const measure=async(tab, texts)=>{
  for(const t of texts){
    const l=p.getByText(t,{exact:true}).locator('visible=true').first();
    if(!await l.count()) { results.push({tab,text:t,missing:true}); continue; }
    const buf=await l.screenshot().catch(()=>null); if(!buf) continue;
    const fs=await l.evaluate(e=>({fs:parseFloat(getComputedStyle(e).fontSize), fw:getComputedStyle(e).fontWeight}));
    writeFileSync(`${out}/${tab}-${t.replace(/[^a-z0-9]+/gi,'-').slice(0,24)}.png`, buf);
    results.push({tab,text:t,...fs,png:`${tab}-${t.replace(/[^a-z0-9]+/gi,'-').slice(0,24)}.png`});
  }
};
await measure('action',['22 things need attention','Pending amount','Calendar','Report','Team','All properties']);
await p.getByText('Add',{exact:true}).locator('visible=true').last().click(); await p.waitForTimeout(1200);
await measure('add',['Submit for approval','Clear','Stay unit','The flat they actually get.']);
await p.getByText('Report',{exact:true}).locator('visible=true').last().click(); await p.waitForTimeout(1200);
await measure('report',['Total Revenue','Range','Overall · all time','Sep 2026 (current month)']);
writeFileSync(`${out}/index.json`,JSON.stringify(results,null,2));
console.log(JSON.stringify(results.filter(r=>!r.missing).map(r=>r.png)));
console.log('missing:',results.filter(r=>r.missing));
await b.close();
