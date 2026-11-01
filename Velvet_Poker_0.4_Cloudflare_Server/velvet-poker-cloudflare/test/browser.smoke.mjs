// Optional real-browser smoke test. Requires Playwright and a Chromium binary.
import {createRequire} from 'node:module';
import {Miniflare} from 'miniflare';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const assert=require('node:assert/strict');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'velvet-browser-'));
 const mf=new Miniflare({modules:true,scriptPath:'build/worker.js',compatibilityDate:'2026-07-01',durableObjects:{CLUB:{className:'VelvetClub',useSQLite:true}},port:0});
 const base=String(await mf.ready).replace(/\/$/,'');
 const assets=path.resolve('../android/app/src/main/assets');
 let browser;
 try{

  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,// Localhost test fixture only: do not apply this browser flag to real clients.
   args:['--no-sandbox','--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets']});
  const pages=[],errors=[];
  for(const name of ['Дарк','Анна','Артур','Марк']){
   const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});
   await context.route(base+'/**',async route=>{
    const file=new URL(route.request().url()).pathname.slice(1)||'index.html';
    if(['index.html','catalog.js','club.js','table.js','engine.js','phone.js','transport.js','app.js','style.css','game.css','crest.svg'].includes(file))
     return route.fulfill({status:200,contentType:({'html':'text/html','js':'text/javascript','css':'text/css','svg':'image/svg+xml'})[file.split('.').pop()],body:fs.readFileSync(path.join(assets,file))});
    return route.continue();
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base,{waitUntil:'domcontentloaded'});
   await page.locator('input[name=name]').fill(name);await page.locator('#connect-form button[type=submit]').click();
   try{await page.locator('[data-do=create]').waitFor({timeout:12000})}catch(e){console.log('INIT',await page.locator('#toast').innerText(),errors,await page.evaluate(()=>({endpoint,token:!!token})));throw e}pages.push(page);
  }
  const host=pages[0];
  await host.locator('[data-do=shop]').click();await host.locator('[data-do=promo]').click();
  await host.locator('#promo-form input').fill('velvet100');await host.locator('#promo-form button').click();
  await host.waitForFunction(()=>me.cosmetics?.points===100);
  await host.locator('[data-item=color-ruby]').click();await host.locator('[data-do=cosmetic-buy]').click();
  await host.waitForFunction(()=>me.cosmetics?.equipped.color==='color-ruby');await host.locator('[data-do=close]').click();
  await host.locator('[data-do=shop-tab][data-tab=outfit]').click();await host.locator('[data-item=outfit-emerald]').click();await host.locator('[data-do=cosmetic-buy]').click();
  await host.waitForFunction(()=>me.cosmetics?.equipped.outfit==='outfit-emerald');await host.locator('[data-do=close]').click();
  await host.locator('[data-do=shop-tab][data-tab=pattern]').click();await host.locator('[data-item=pattern-diamonds]').click();await host.locator('[data-do=cosmetic-buy]').click();
  await host.waitForFunction(()=>me.cosmetics?.equipped.pattern==='pattern-diamonds');await host.locator('[data-do=close]').click();
  assert.equal(await host.evaluate(()=>me.cosmetics.points),15);
  await host.locator('[data-do=shop-tab][data-tab=emote]').click();assert.equal(await host.locator('.catalog-item').count(),30);
  if(process.env.QA_DIR)await host.screenshot({path:path.join(process.env.QA_DIR,'emotes.png'),fullPage:true});
  await host.locator('[data-do=page][data-page=rooms]').click();await host.locator('[data-do=create]').click();
  await host.locator('#create-form input[name=name]').fill('Ночной клуб');
  await host.locator('#create-form select').selectOption('180');
  await host.locator('#create-form button').click();await host.locator('.room-header').waitFor();
  const code=await host.evaluate(()=>room.code);
  assert.equal(await host.evaluate(()=>room.mode),'phone');
  assert.equal(await host.evaluate(()=>room.host_local),true);
  for(const page of pages.slice(1)){
   await page.locator('[data-do=join]').click();await page.locator('#join-form input').fill(code);await page.locator('#join-form button').click();await page.locator('.room-header').waitFor();
  }
  await host.waitForFunction(()=>room.players.length===4);
  await host.locator('[data-action=deal]').click();await host.waitForFunction(()=>room.phase==='preflop');
  for(const p of pages)await p.waitForFunction(()=>room.phase==='preflop');
  const actor=await host.evaluate(()=>room.actor),acting=pages[actor];
  await acting.waitForFunction(()=>room.legal?.can_raise);
  const revision=await acting.evaluate(()=>room.revision);
  await acting.locator('[data-do=pick-chip][data-value="25"]').click();assert.equal(await acting.evaluate(()=>tableDraft),25);assert.equal(await acting.evaluate(()=>room.revision),revision);
  await acting.locator('[data-do=chip-undo]').click();assert.equal(await acting.evaluate(()=>tableDraft),0);
  const coin=await acting.locator('[data-do=pick-chip][data-value="25"]').boundingBox(),felt=await acting.locator('#chip-drop-zone').boundingBox();
  await acting.mouse.move(coin.x+coin.width/2,coin.y+coin.height/2);await acting.mouse.down();await acting.mouse.move(felt.x+felt.width/2,felt.y+felt.height/2,{steps:12});await acting.mouse.up();
  await acting.waitForFunction(()=>tableDraft===25);assert.equal(await acting.evaluate(()=>room.revision),revision);
  await host.locator('[data-do=emotes]').click();await host.locator('[data-do=send-emote][data-item=emote-wave]').click();
  await acting.locator('.reaction-bubble').waitFor();assert.equal(await acting.evaluate(()=>tableDraft),25);
  for(const p of pages.slice(1))await p.waitForFunction(()=>Object.values(room.club.looks).some(e=>e.color==='color-ruby'&&e.outfit==='outfit-emerald'));
  await acting.locator('[data-do=throw-chips]').click();await host.waitForFunction(()=>room.current===25);
  await acting.waitForFunction(()=>me.cosmetics?.earned===1);
  assert.equal(await acting.evaluate(()=>tableDraft),0);
  await host.waitForFunction(()=>room.actor===0);await host.locator('[data-action=call]').click();
  await pages[1].waitForFunction(()=>room.actor===1);await pages[1].locator('[data-action=call]').click();
  await pages[2].waitForFunction(()=>room.actor===2);await pages[2].locator('[data-action=call]').click();
  await host.waitForFunction(()=>room.phase==='flop');
  assert.equal(await host.locator('.board .card:not(.placeholder)').count(),3);
  assert.equal(await host.locator('.table-seat .card.back').count(),6);
  for(const i of [1,2,3]){await pages[i].waitForFunction(()=>room.legal?.check);await pages[i].locator('[data-action=check]').click()}
  await host.waitForFunction(()=>room.legal?.check);await host.waitForTimeout(2300);
  await host.screenshot({path:process.env.QA_DIR?path.join(process.env.QA_DIR,'table-mobile.png'):path.join(temp,'table.png'),fullPage:true});
  for(const [width,height] of [[740,360],[844,390],[960,432],[1280,720]]){
   await host.setViewportSize({width,height});await host.waitForTimeout(100);
   const size=await host.evaluate(()=>({width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,scrollY:document.documentElement.scrollHeight}));
   assert.ok(size.scroll<=size.width+1,'No horizontal overflow at '+width);assert.ok(size.scrollY<=size.height+1,'No vertical overflow at '+width);
   const overlap=await host.evaluate(()=>{const b=document.querySelector('.board').getBoundingClientRect(),s=document.querySelector('.seat.self .seat-cards').getBoundingClientRect();return b.bottom>s.top});
   assert.equal(overlap,false,'Own cards do not overlap board at '+width);
   if(process.env.QA_DIR)await host.screenshot({path:path.join(process.env.QA_DIR,'table-'+width+'.png')});
  }
  await host.setViewportSize({width:844,height:390});
  await host.locator('[data-do=guide]').click();await host.locator('#modal').waitFor();
  assert.match(await host.locator('#modal').innerText(),/он не оценивает вашу руку/);
  await host.locator('[data-do=close]').click();
  // Force an actual transport failure in a browser, then recover the same hand.
  await host.context().setOffline(true);
  await host.waitForFunction(()=>!online,{timeout:15000});
  await pages[1].waitForFunction(()=>room?.link_paused===true,{timeout:15000});
  assert.equal(await pages[1].evaluate(()=>room.legal),null);
  await host.context().setOffline(false);await host.waitForFunction(()=>online,{timeout:15000});
  assert.equal(await host.evaluate(()=>room.paused),true);
  const before=await host.evaluate(()=>JSON.stringify(room.players[0].cards));await host.reload();await host.waitForFunction(()=>room&&room.phase==='flop');
  assert.equal(await host.evaluate(()=>JSON.stringify(room.players[0].cards)),before);
  assert.equal(await host.evaluate(()=>room.paused),true);
  await host.waitForFunction(()=>online&&room.host_online,{timeout:15000});
  await host.getByRole('button',{name:'Настройки комнаты'}).click();
  await host.locator('#modal [data-action=pause]').click();
  await host.waitForFunction(()=>!room.paused);
  await pages[1].waitForFunction(()=>!room.paused&&room.host_online);
  const clockBefore=await pages[1].evaluate(()=>room.deadline-room.server_time);
  await host.waitForTimeout(2200);
  const clockAfter=await pages[1].evaluate(()=>room.deadline-room.server_time);
  assert.ok(clockAfter<clockBefore-1,'Guest clock advances even when encrypted snapshot is reused');
  // Finish a real hand through controls; observe coin flights and the payout UI.
  await host.evaluate(()=>{window.payoutFlights=0;window.payoutObserver=new MutationObserver(list=>{for(const m of list)for(const n of m.addedNodes)if(n.classList?.contains('flying-coin'))window.payoutFlights++});window.payoutObserver.observe(document.body,{childList:true,subtree:true})});
  let moves=0;
  while(await host.evaluate(()=>room.phase!=='finished')){
   const turn=await host.evaluate(()=>({actor:room.actor,revision:room.revision})),p=pages[turn.actor];
   await p.waitForFunction(rev=>room.revision===rev&&room.legal,turn.revision);
   await p.locator('[data-do=command][data-action="'+await p.evaluate(()=>room.legal.check?'check':'call')+'"]').click();
   await host.waitForFunction(rev=>room.revision>rev,turn.revision);assert.ok(++moves<20);
  }
  await host.waitForFunction(()=>window.payoutFlights>0);assert.equal(await host.evaluate(()=>room.players.reduce((n,p)=>n+p.stack,0)),4*6310);
  await host.locator('.table-result').waitFor();await host.evaluate(()=>window.payoutObserver.disconnect());
  await host.getByRole('button',{name:'В лобби',exact:true}).click();await host.locator('.hero').waitFor();
  await pages[1].waitForFunction(()=>room.paused);
  await host.waitForTimeout(500);
  await host.screenshot({path:process.env.QA_DIR?path.join(process.env.QA_DIR,'lobby-mobile.png'):path.join(temp,'lobby.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS CLOUDFLARE WEBSOCKET + SHOP + DRAG/CONFIRM/UNDO + EMOTES: 4 browser clients, create/join, call/check/flop, encrypted privacy, guide, host offline/guest freeze, resume, persistent deck, guest timer; landscape 740x360/844x390/960x432/1280x720.');
 }finally{if(browser)await browser.close();await mf.dispose();fs.rmSync(temp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
