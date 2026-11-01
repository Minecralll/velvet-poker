import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Service,hash,random} from '../src/service.js';
function fixture(){
 const db=new DatabaseSync(':memory:');
 const sql={exec(q,...a){if(!a.length&&q.includes('CREATE TABLE')){db.exec(q);return []}const s=db.prepare(q);return s.columns().length?s.all(...a):(s.run(...a),[])}};
 return {db,sql,service:new Service(sql)};
}
const publicKey={kty:'EC',crv:'P-256',x:'a'.repeat(43),y:'b'.repeat(43)};
const packet={iv:'a'.repeat(16),body:'b'.repeat(24)};
async function users(s,n=5){return Promise.all(Array.from({length:n},async(_,i)=>s.register('Игрок '+i,random(),await hash(random())).user))}
const call=(s,u,op,d)=>s.call('/api/phone/'+op,d,u);
function create(s,u){return call(s,u,'create',{key:'create-0001',name:'Стол',device:'device'.repeat(6),public_key:publicKey})}
function sync(s,u,code,session='session'.repeat(5)){const d={code,device:'device'.repeat(6),session};return {...d,...call(s,u,'sync',d)}}

test('room code, four members, fifth rejected, ciphertext privacy and send deduplication',async()=>{
 const {service:s,db}=fixture(),u=await users(s),r=create(s,u[0]);assert.match(r.code,/^[A-Z2-9]{8}$/);assert.equal(create(s,u[0]).code,r.code);
 const h=sync(s,u[0],r.code);
 for(const p of u.slice(1,4))call(s,p,'join',{code:r.code,public_key:publicKey});
 assert.throws(()=>call(s,u[4],'join',{code:r.code,public_key:publicKey}),/четыре/);
 call(s,u[0],'publish',{...h,sequence:1,packets:{[u[1].id]:packet},ack:[],summary:{phase:'waiting',hand:0,paused:false}});
 assert.deepEqual(call(s,u[1],'poll',{code:r.code}).packet,packet);assert.equal(call(s,u[2],'poll',{code:r.code}).packet,null);
 assert.throws(()=>call(s,u[4],'poll',{code:r.code}),/участник/);
 const d={code:r.code,key:'action-0001',packet};call(s,u[1],'send',d);call(s,u[1],'send',d);
 assert.equal(sync(s,u[0],r.code).inbox.length,1);
 assert.throws(()=>call(s,u[1],'send',{...d,packet:{action:'raise',to:10}}),/зашифрованный/);
 const row=JSON.parse(db.prepare('SELECT data FROM rooms').get().data);
 assert.deepEqual(Object.keys(row.summary).sort(),['hand','paused','phase']);assert.equal(row.deck,undefined);assert.equal(row.snapshots,undefined);db.close();
});
test('host session fencing, monotonic publishes, disconnect, durable metadata and volatile lease restart',async()=>{
 const {service:s,db,sql}=fixture(),u=await users(s,2),r=create(s,u[0]),h=sync(s,u[0],r.code);
 call(s,u[1],'join',{code:r.code,public_key:publicKey});
 assert.throws(()=>sync(s,u[0],r.code,'other'.repeat(5)),/другом окне/);
 assert.throws(()=>call(s,u[1],'sync',h),/устройство/);
 const publish={...h,sequence:2,packets:{[u[1].id]:packet},ack:[],summary:{phase:'flop',hand:1,paused:false}};
 call(s,u[0],'publish',publish);call(s,u[0],'publish',{...publish,sequence:1,summary:{phase:'waiting',hand:0,paused:false}});
 assert.equal(s.me(u[0]).rooms[0].phase,'flop');
 s.disconnected('different');assert.equal(s.online(r.code),true);s.disconnected('http');assert.equal(s.online(r.code),false);
 const restarted=new Service(sql);assert.equal(restarted.me(u[0]).rooms[0].phase,'flop');assert.equal(restarted.online(r.code),false);
 assert.throws(()=>call(restarted,u[0],'publish',publish),/Сессия/);
 assert.notEqual(sync(restarted,u[0],r.code).lease,h.lease);db.close();
});
test('friends and invitations persist, profile authentication and key rotation',async()=>{
 const {service:s,db,sql}=fixture(),u=await users(s,3),r=create(s,u[0]);sync(s,u[0],r.code);
 s.call('/api/friend',{action:'request',code:u[1].code,key:'friend-0001'},u[0]);
 s.call('/api/friend',{action:'accept',code:u[0].code,key:'friend-0002'},u[1]);
 s.call('/api/invite',{target:u[1].id,code:r.code,key:'invite-0001'},u[0]);
 assert.equal(new Service(sql).me(u[1]).invites.length,1);
 assert.throws(()=>s.call('/api/invite',{target:u[2].id,code:r.code,key:'invite-0002'},u[0]),/друга/);
 assert.throws(()=>s.userByHash('wrong'),/Войдите/);
 call(s,u[1],'join',{code:r.code,public_key:publicKey});const h=sync(s,u[0],r.code);
 call(s,u[0],'publish',{...h,sequence:1,packets:{[u[1].id]:packet},ack:[],summary:{phase:'waiting',hand:0,paused:false}});
 call(s,u[1],'send',{code:r.code,key:'action-0001',packet});
 call(s,u[1],'join',{code:r.code,public_key:{...publicKey,x:'c'.repeat(43)}});
 assert.equal(call(s,u[1],'poll',{code:r.code}).packet,null);assert.equal(sync(s,u[0],r.code).inbox.length,0);db.close();
});
test('cosmetic catalog, promos, ownership and durable monotonic action rewards',async()=>{
 const {service:s,sql,db}=fixture(),u=await users(s,3),r=create(s,u[0]),h=sync(s,u[0],r.code);
 call(s,u[1],'join',{code:r.code,public_key:publicKey});const shop=(who,d)=>s.call('/api/cosmetics',{key:random(),...d},who);
 assert.equal(globalThis.VelvetCosmetics.emotes.length,30);assert.equal(globalThis.VelvetCosmetics.colors.length,16);assert.equal(globalThis.VelvetCosmetics.patterns.length,16);assert.equal(globalThis.VelvetCosmetics.avatars.length,8);
 assert.throws(()=>shop(u[1],{action:'equip',item:'avatar-robot'}),/Сначала/);
 assert.throws(()=>shop(u[1],{action:'buy',item:'color-ruby'}),/баллов/);
 const digest=await hash('VELVET100');assert.equal(shop(u[1],{action:'promo',promo_digest:digest}).wallet.points,100);assert.throws(()=>shop(u[1],{action:'promo',promo_digest:digest}),/использован/);
 let w=shop(u[1],{action:'buy',item:'color-ruby'}).wallet;assert.equal(w.points,75);assert.equal(w.equipped.color,'color-ruby');assert.equal(shop(u[1],{action:'buy',item:'color-ruby'}).wallet.points,75);
 const pub={...h,sequence:1,packets:{},ack:[],summary:{phase:'waiting',hand:0,paused:false},reward_totals:{[u[1].id]:4}};
 call(s,u[0],'publish',pub);call(s,u[0],'publish',{...pub,sequence:2});assert.equal(s.me(u[1]).cosmetics.points,79);assert.equal(s.me(u[1]).cosmetics.earned,4);
 call(s,u[0],'publish',{...pub,sequence:3,reward_totals:{[u[1].id]:1}});assert.equal(s.me(u[1]).cosmetics.points,79);
 assert.throws(()=>call(s,u[0],'publish',{...pub,sequence:4,reward_totals:{[u[2].id]:4}}),/счётчик/);
 assert.throws(()=>call(s,u[1],'publish',pub),/устройство|хост|Сессия/);
 assert.equal(new Service(sql).me(u[1]).cosmetics.points,79);assert.equal(new Service(sql).me(u[1]).cosmetics.equipped.color,'color-ruby');
 const club=call(s,u[1],'poll',{code:r.code}).club;assert.equal(club.looks[u[1].id].color,'color-ruby');assert.ok(!JSON.stringify(club).includes('promo_digest'));
 assert.throws(()=>shop(u[1],{action:'react',code:r.code,item:'emote-saber-duel'}),/не открыта/);
 shop(u[1],{action:'react',code:r.code,item:'emote-wave'});assert.equal(call(s,u[0],'sync',h).club.reactions.length,1);assert.throws(()=>shop(u[1],{action:'react',code:r.code,item:'emote-wave'}));
 const {PROMOS}=await import('../src/promos.js');const personal=Object.entries(PROMOS).find(([,p])=>p.single)[0];assert.equal(shop(u[0],{action:'promo',promo_digest:personal}).added,1000000000);assert.throws(()=>shop(u[2],{action:'promo',promo_digest:personal}),/уже активирован/);
 const restarted=new Service(sql),lease=sync(restarted,u[0],r.code);call(restarted,u[0],'publish',{...pub,...lease,sequence:1});assert.equal(restarted.me(u[1]).cosmetics.points,79);db.close();
});
