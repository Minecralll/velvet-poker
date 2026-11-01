import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';
const assets=path.resolve('../android/app/src/main/assets');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await wait(100)}throw Error('Condition timed out')}
function client(base,storage=new Map()){
 const elements=new Map(),intervals=[];let http=0;
 const el=key=>{if(!elements.has(key))elements.set(key,{innerHTML:'',textContent:'',style:{},open:false,value:'',classList:{add(){},remove(){}},addEventListener(){},showModal(){this.open=true},close(){this.open=false}});return elements.get(key)};
 const ctx=vm.createContext({console,fetch:(...args)=>{http++;return fetch(...args)},WebSocket,URL,AbortController,FormData,crypto,TextEncoder,TextDecoder,btoa,atob,location:new URL(base),navigator:{},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},document:{hidden:false,querySelector:el,addEventListener(){}},setInterval:(f,t)=>{const id=setInterval(f,t);intervals.push(id);return id},setTimeout,clearTimeout});
 ctx.window={addEventListener(){}};
 for(const file of ['catalog.js','club.js','table.js','engine.js','phone.js','transport.js','app.js'])vm.runInContext(fs.readFileSync(path.join(assets,file),'utf8'),ctx);
 return{ctx,storage,run:s=>vm.runInContext(s,ctx),http:()=>http,dispose(){intervals.forEach(clearInterval);vm.runInContext('transport.close()',ctx)}};
}
test('real Cloudflare runtime: four encrypted clients, retries, isolation, restart and full hand', {timeout:100000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'velvet-cf-'));
 const options={modules:true,scriptPath:'build/worker.js',compatibilityDate:'2026-07-01',durableObjects:{CLUB:{className:'VelvetClub',useSQLite:true}},durableObjectsPersist:dir,port:0};
 let mf=new Miniflare(options),cs=[],base;
 try{
  base=String(await mf.ready).replace(/\/$/,'');
  const origin='https://appassets.androidplatform.net';
  const cors=await fetch(base+'/health',{headers:{Origin:origin}});assert.equal(cors.headers.get('access-control-allow-origin'),origin);assert.equal((await cors.json()).protocol,3);
  assert.equal((await fetch(base+'/health',{headers:{Origin:'https://evil.example'}})).status,400);
  cs=Array.from({length:4},()=>client(base));
  for(let i=0;i<4;i++)await cs[i].run(`(async()=>{const r=await api('/api/register',{name:'Игрок ${i}'});token=r.token;saveSession();await refreshMe();online=true;renderLobby()})()`);
  const host=cs[0];
  const {PROMOS}=await import('../src/promos.js');const forged=Object.entries(PROMOS).find(([,p])=>p.single)[0];
  await assert.rejects(host.run(`post('/api/cosmetics',{action:'promo',promo:'wrong-code',promo_digest:'${forged}'})`),/не найден/);
  const granted=await host.run("post('/api/cosmetics',{action:'promo',promo:' velvet100 '})");assert.equal(granted.added,100);
  const friend=cs[1].run('me.user.code'),own=host.run('me.user.code');
  await host.run(`post('/api/friend',{action:'request',code:'${friend}'})`);await cs[1].run(`post('/api/friend',{action:'accept',code:'${own}'})`);
  const r=await host.run("post('/api/create',{name:'Cloudflare стол',turn_seconds:180})");await host.run(`openRoom('${r.code}')`);
  for(const c of cs.slice(1))await c.run(`(async()=>{await post('/api/join',{code:'${r.code}'});await openRoom('${r.code}')})()`);
  await until(()=>host.run('room.players.length')===4);await host.run("command('deal')");
  await until(()=>cs.every(c=>c.run('room?.phase')==='preflop'));
  for(const c of cs){assert.equal(c.run('room.deck'),undefined);assert.equal(c.run('room.players.filter(p=>p.cards[0]!==null).length'),1)}
  const actor=cs[host.run('room.actor')],key=crypto.randomUUID(),rev=host.run('room.revision');
  const action={code:r.code,key,revision:rev,action:'call'};
  await actor.run(`VelvetPhone.command(${JSON.stringify(action)})`);await actor.run(`VelvetPhone.command(${JSON.stringify(action)})`);
  assert.equal(host.run('VelvetPhone.debug().host.record.room.revision'),rev+1);
  await until(async()=>{await actor.run('refresh(true)');return actor.run('me.cosmetics?.earned')===1});
  assert.equal(actor.run('me.cosmetics.earned'),1);
  // Idle play uses one socket/client, not repeated HTTP health/me/poll requests.
  const counts=cs.map(c=>c.http());await wait(3000);assert.deepEqual(cs.map(c=>c.http()),counts);
  assert.ok(counts.every(n=>n===2),'one health + one registration HTTP request per client');
  // Guest cannot impersonate host or access another player's encrypted mailbox.
  await assert.rejects(cs[1].run(`wireApi('/api/phone/sync',{code:'${r.code}',device:'${'x'.repeat(24)}',session:'${'y'.repeat(24)}'})`),/устройство/);
  const savedDeck=host.run('JSON.stringify(VelvetPhone.debug().host.record.room.deck)');
  // Abrupt infrastructure restart while all clients and the hand are still live.
  await mf.dispose();await wait(1500);options.port=Number(new URL(base).port);mf=new Miniflare(options);await mf.ready;
  await until(()=>cs.every(c=>c.run('room?.host_online&&room?.paused')),25000);
  assert.equal(host.run('JSON.stringify(VelvetPhone.debug().host.record.room.deck)'),savedDeck);

  await host.run("VelvetPhone.suspend('Тест остановки',true)");
  for(const c of cs)c.dispose();
  const storages=cs.map(c=>c.storage);await mf.dispose();
  options.port=Number(new URL(base).port);mf=new Miniflare(options);await mf.ready;
  cs=storages.map(s=>client(base,s));
  await until(()=>cs.every(c=>c.run('room?.host_online')));
  assert.equal(cs[0].run('JSON.stringify(VelvetPhone.debug().host.record.room.deck)'),savedDeck);assert.equal(cs[0].run('room.paused'),true);
  await until(()=>cs[3].run('me.cosmetics?.earned')===1);assert.equal(cs[3].run('me.cosmetics.earned'),1);
  await cs[0].run('refreshMe()');assert.equal(cs[0].run('me.friends.length'),1);
  await cs[0].run("command('pause')");
  let moves=0;
  while(true){
   await cs[0].run('refresh(true)');const state=cs[0].run('room');if(state.phase==='finished')break;
   const c=cs[state.actor];await until(async()=>{await c.run('refresh(true)');return c.run('room.revision')===state.revision});
   await c.run("command(room.legal.check?'check':'call')");assert.ok(++moves<30);
  }
  const state=cs[0].run('room');assert.equal(state.players.reduce((n,p)=>n+p.stack,0),state.buyin*4);
 }finally{for(const c of cs)c.dispose();await mf.dispose();fs.rmSync(dir,{recursive:true,force:true})}
});
