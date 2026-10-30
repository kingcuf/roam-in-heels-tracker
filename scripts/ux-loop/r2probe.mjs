/* Round-2 QA probe. Local rig only. */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
const APP='http://127.0.0.1:8124/', API='http://127.0.0.1:8787/';
const out=process.env.OUT||'/tmp/ux-out/r2-qa-probe'; mkdirSync(out,{recursive:true});
const b=await chromium.launch();
const R={}; let shot=0;
const mkctx=async(st)=>{const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3,
  storageState:st,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'});return c;};
const wire=(p,calls)=>{p.on('response',async r=>{if(!r.url().startsWith(API))return;let n=0;try{n=(await r.body()).length}catch{}
  calls.push({a:new URL(r.url()).searchParams.get('action'),kb:+(n/1024).toFixed(1),at:Date.now()})});};
const snap=async(p,n)=>{await p.screenshot({path:`${out}/${String(++shot).padStart(2,'0')}-${n}.png`});};
const usable=async(p,to=30000)=>{const t=Date.now();try{
  await p.getByPlaceholder('Username').waitFor({state:'visible',timeout:to});
  await p.waitForFunction(()=>{const el=[...document.querySelectorAll('input')].find(i=>i.placeholder==='Username');
    if(!el)return false;const r=el.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return top===el||el.contains(top);},{timeout:to});return Date.now()-t;}catch(e){return '>'+to+' NEVER USABLE';}};
const signin=async(p)=>{await p.getByPlaceholder('Username').fill('manager');await p.getByPlaceholder('PIN').fill(process.env.MANAGER_PIN);
  await p.getByText('Unlock').locator('visible=true').first().click();
  await p.getByText('need attention',{exact:false}).locator('visible=true').first().waitFor({timeout:15000});};
const tab=async(p,t)=>{await p.getByText(t,{exact:true}).locator('visible=true').last().click();await p.waitForTimeout(900);};
const txt=async(p)=>(await p.evaluate(()=>document.body.innerText)).split('\n').map(s=>s.trim()).filter(Boolean);

/* ============ 1. INTRO: launch 1 and launch 2 in the SAME storage ============ */
{
  const ctx=await mkctx(); const p=await ctx.newPage();
  const t0=Date.now(); await p.goto(APP,{waitUntil:'load'});
  const l1=await usable(p);
  await snap(p,'intro-launch1-usable');
  const st=await ctx.storageState();
  R.introLaunch1={loadMs:Date.now()-t0-l1, introToUsableMs:l1,
    ls:st.origins?.[0]?.localStorage?.map(x=>x.name)||[]};
  // launch 2 in the same context (reload) and in a fresh page with the same storage
  const t2=Date.now(); await p.goto(APP,{waitUntil:'load'}); const l2=await usable(p,20000);
  R.introLaunch2_reload={introToUsableMs:l2, bodyText:(await p.evaluate(()=>document.body.innerText)).slice(0,200), domLen:await p.evaluate(()=>document.getElementById('root')?.innerHTML.length||0)};
  await snap(p,'intro-launch2-usable');
  const ctx2=await mkctx(st); const p2=await ctx2.newPage();
  await p2.goto(APP,{waitUntil:'load'}); const l3=await usable(p2,20000);
  R.introLaunch2_freshContextSameStorage={introToUsableMs:l3, bodyText:(await p2.evaluate(()=>document.body.innerText)).slice(0,200)};
  // skip control still present on launch 1?
  R.introSkipChip=await p.evaluate(()=>{const e=[...document.querySelectorAll('*')].filter(x=>!x.children.length&&/^Skip/i.test((x.textContent||'').trim()));
    return e.map(x=>{const r=x.getBoundingClientRect();return{t:x.textContent.trim(),w:Math.round(r.width),h:Math.round(r.height)}});});
  await ctx2.close(); await ctx.close();
}

/* ============ 2. COLD SIGN-IN: is s.inv populated? (low-stock tile) ============ */
{
  const ctx=await mkctx(); const p=await ctx.newPage(); const calls=[]; wire(p,calls);
  const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200))});
  await p.goto(APP,{waitUntil:'load'});
  const sk=p.getByText('Skip',{exact:false}).locator('visible=true');
  if(await sk.count()) await sk.first().click();
  await p.getByPlaceholder('Username').waitFor({timeout:20000});
  const c0=calls.length; const t=Date.now(); await signin(p);
  const headlineFirst=await p.evaluate(()=>{const m=document.body.innerText.match(/(\d+)\s+things? need attention/);return m?m[0]:null;});
  await p.waitForTimeout(2500);
  const body=await txt(p);
  R.signIn={ msToLanding:Date.now()-t, headlineOnFirstSample:headlineFirst,
    calls:calls.slice(c0).map(c=>({a:c.a,kb:c.kb})),
    kb:+calls.slice(c0).reduce((a,c)=>a+c.kb,0).toFixed(1), consoleErrors:errs };
  await snap(p,'action-landing');
  R.actionTiles=body.slice(0,40);
  R.lowStockTile=body.filter(l=>/stock|inventory|low/i.test(l));
  R.waitingTile=body.filter(l=>/waiting for approval|all clear/i.test(l));
  // re-read inventory presence via the Add > Inventory segment
  await tab(p,'Add');
  const inv=await p.getByText('Inventory',{exact:true}).locator('visible=true').first();
  if(await inv.count()){const k=calls.length;await inv.click();await p.waitForTimeout(1500);
    R.inventorySegment={callsOnOpen:calls.slice(k).map(c=>c.a), body:(await txt(p)).slice(0,25)};
    await snap(p,'inventory-segment');}
  await ctx.close();
}

/* ============ 3. SAVE -> SentPanel trail, Action tile, Logs amber bar ============ */
{
  const ctx=await mkctx(); const p=await ctx.newPage(); const calls=[]; wire(p,calls);
  const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,200))});
  await p.goto(APP,{waitUntil:'load'});
  const sk=p.getByText('Skip',{exact:false}).locator('visible=true'); if(await sk.count()) await sk.first().click();
  await p.getByPlaceholder('Username').waitFor({timeout:20000}); await signin(p); await p.waitForTimeout(2000);
  await tab(p,'Add');
  const set=async(label,v)=>{const l=p.getByText(label,{exact:false}).locator('visible=true').first();
    await l.waitFor({timeout:8000}); await l.locator('xpath=./following::input[1]').first().fill(v);};
  await set('Net earned','4321');
  const k=calls.length; const tS=Date.now();
  await p.getByText('Submit for approval',{exact:false}).locator('visible=true').first().click();
  let confirmMs=null;
  try{await p.waitForFunction(()=>/request #\d+/i.test(document.body.innerText),{timeout:15000});confirmMs=Date.now()-tS;}catch{confirmMs='timeout';}
  await p.waitForTimeout(2500);
  const bodyAfter=await txt(p);
  R.save={confirmMs, calls:calls.slice(k).map(c=>({a:c.a,kb:c.kb})),
    kb:+calls.slice(k).reduce((a,c)=>a+c.kb,0).toFixed(1),
    sentPanel:bodyAfter.filter(l=>/request #|waiting for|not in the booking log|View request|Dismiss/i.test(l)).slice(0,10),
    netFieldAfter: await (async()=>{try{const l=p.getByText('Net earned',{exact:false}).locator('visible=true').first();
      return await l.locator('xpath=./following::input[1]').first().inputValue();}catch{return 'n/a'}})()};
  await snap(p,'after-save-sentpanel');
  // Action tile
  await tab(p,'Action');
  const ab=await txt(p);
  R.afterSaveAction={headline:ab.find(l=>/need attention|All clear/i.test(l)),
    waiting:ab.filter(l=>/waiting for approval/i.test(l)),
    around:ab.slice(0,30)};
  await snap(p,'after-save-action');
  // Logs amber bar
  await tab(p,'Add');
  const lg=p.getByText('Log',{exact:false}).locator('visible=true').first();
  if(await lg.count()){await lg.click();await p.waitForTimeout(1800);
    const lb=await txt(p);
    R.logsAmberBar=lb.filter(l=>/pending|waiting|not yet|request #/i.test(l)).slice(0,8);
    await snap(p,'logs-amber-bar');}
  R.saveConsoleErrors=errs;
  await ctx.close();
}

/* ============ 4. REPORT: figures correct after range change ============ */
{
  const ctx=await mkctx(); const p=await ctx.newPage(); const calls=[]; wire(p,calls);
  await p.goto(APP,{waitUntil:'load'});
  const sk=p.getByText('Skip',{exact:false}).locator('visible=true'); if(await sk.count()) await sk.first().click();
  await p.getByPlaceholder('Username').waitFor({timeout:20000}); await signin(p); await p.waitForTimeout(2000);
  await tab(p,'Report'); await p.waitForTimeout(1200);
  const figures=async()=>{const t=await txt(p);const i=t.findIndex(l=>/Total Revenue/i.test(l));
    return t.slice(Math.max(0,i-4),i+14);};
  R.reportBefore=await figures(); await snap(p,'report-alltime');
  const pick=async(lab)=>{const box=await p.evaluate((lb)=>{const e=[...document.querySelectorAll('*')]
      .filter(x=>!x.children.length&&(x.textContent||'').trim()===lb)
      .find(x=>{const r=x.getBoundingClientRect();return r.width&&r.height&&r.top>=0&&r.bottom<=innerHeight;});
    if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},lab);
    if(!box)return false;await p.mouse.click(box.x,box.y);await p.waitForTimeout(1500);return true;};
  const k=calls.length;
  R.rangeSheetOpened=await pick('All time');
  R.range30Picked=await pick('Last 30 days');
  R.report30Calls=calls.slice(k).map(c=>({a:c.a,kb:c.kb}));
  R.report30KB=+calls.slice(k).reduce((a,c)=>a+c.kb,0).toFixed(1);
  R.reportAfter30=await figures(); await snap(p,'report-30d');
  const k2=calls.length; await pick('Last 30 days'); await pick('Last 7 days');
  R.report7Calls=calls.slice(k2).map(c=>({a:c.a,kb:c.kb}));
  R.reportAfter7=await figures(); await snap(p,'report-7d');
  // property filter
  const k3=calls.length;
  const propOK=await pick('All properties');
  R.propertyFilter={opened:propOK, calls:calls.slice(k3).map(c=>({a:c.a,kb:c.kb}))};
  await snap(p,'report-property');
  await ctx.close();
}

/* ============ 5. TEAM landing + taps to approve ============ */
{
  const ctx=await mkctx(); const p=await ctx.newPage(); const calls=[]; wire(p,calls);
  await p.goto(APP,{waitUntil:'load'});
  const sk=p.getByText('Skip',{exact:false}).locator('visible=true'); if(await sk.count()) await sk.first().click();
  await p.getByPlaceholder('Username').waitFor({timeout:20000}); await signin(p); await p.waitForTimeout(2000);
  const k=calls.length; const t=Date.now();
  await tab(p,'Team'); await p.waitForTimeout(1200);
  R.team={msToVisible:Date.now()-t, callsOnEntry:calls.slice(k).map(c=>({a:c.a,kb:c.kb})),
    body:(await txt(p)).slice(0,35)};
  await snap(p,'team-landing');
  // second entry within window
  await tab(p,'Action'); const k2=calls.length; await tab(p,'Team'); await p.waitForTimeout(1000);
  R.teamSecondEntryCalls=calls.slice(k2).map(c=>({a:c.a,kb:c.kb}));
  // wait 16s then enter again
  await tab(p,'Action'); await p.waitForTimeout(16500); const k3=calls.length;
  await tab(p,'Team'); await p.waitForTimeout(1200);
  R.teamEntryAfter16s=calls.slice(k3).map(c=>({a:c.a,kb:c.kb}));
  await ctx.close();
}

writeFileSync(`${out}/r2probe.json`,JSON.stringify(R,null,2));
console.log(JSON.stringify(R,null,1));
await b.close();
