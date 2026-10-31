// Metadata and encrypted mailboxes only. The poker engine runs on the host phone.
export class RuleError extends Error {}
export const check=(ok,message)=>{if(!ok)throw new RuleError(message)};
export const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const time=()=>Date.now()/1000;
export const random=(n=24)=>Array.from(crypto.getRandomValues(new Uint8Array(n)),x=>x.toString(16).padStart(2,'0')).join('');
export const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
function integer(v,min,max){check(Number.isSafeInteger(v)&&v>=min&&v<=max,'Число вне допустимого диапазона');return v}
function text(v,min,max,label){check(typeof v==='string'&&v.length>=min&&v.length<=max,label);return v}
const pub=u=>({id:u.id,name:u.name,code:u.code});
function publicKey(k){
 check(object(k)&&k.kty==='EC'&&k.crv==='P-256'&&typeof k.x==='string'&&typeof k.y==='string'&&/^[A-Za-z0-9_-]{43}$/.test(k.x)&&/^[A-Za-z0-9_-]{43}$/.test(k.y),'Нужен открытый ключ P-256');
 return {kty:k.kty,crv:k.crv,x:k.x,y:k.y};
}
function packet(p){
 check(object(p)&&Object.keys(p).sort().join(',')==='body,iv','Нужен зашифрованный пакет');
 check(typeof p.iv==='string'&&/^[A-Za-z0-9+/]{16}$/.test(p.iv),'Неверный nonce');
 check(typeof p.body==='string'&&p.body.length>=20&&p.body.length<=90000&&/^[A-Za-z0-9+/=]+$/.test(p.body),'Неверный размер пакета');return p;
}
export class Service {
 constructor(sql,notify=()=>{}){
  this.sql=sql;this.notify=notify;this.rooms=new Map();this.live=new Map();this.rates=new Map();
  sql.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,token TEXT UNIQUE,code TEXT UNIQUE,name TEXT);
    CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS friends(sender TEXT,target TEXT,accepted INTEGER DEFAULT 0,PRIMARY KEY(sender,target));
    CREATE INDEX IF NOT EXISTS friends_target ON friends(target);
    CREATE TABLE IF NOT EXISTS invites(sender TEXT,target TEXT,room TEXT,created REAL,PRIMARY KEY(sender,target,room));
    CREATE INDEX IF NOT EXISTS invites_target ON invites(target);
    CREATE TABLE IF NOT EXISTS commands(uid TEXT,key TEXT,result TEXT,created REAL,PRIMARY KEY(uid,key));`);
  for(const row of this.rows('SELECT data FROM rooms')){const r=JSON.parse(row.data);this.rooms.set(r.code,r)}
 }
 rows(q,...a){return Array.from(this.sql.exec(q,...a))}
 one(q,...a){return this.rows(q,...a)[0]}
 rate(key,limit=600,period=60){
  const now=time();let entry=this.rates.get(key);
  if(!entry||now-entry.start>=period){entry={start:now,count:0};this.rates.set(key,entry)}
  check(++entry.count<=limit,'Слишком много запросов. Подождите.');
  if(this.rates.size>4096)for(const [k,v]of this.rates)if(now-v.start>3600)this.rates.delete(k);
 }
 userByHash(tokenHash){const u=this.one('SELECT * FROM users WHERE token=?',tokenHash);check(u,'Войдите в профиль');return u}
 user(uid){const u=this.one('SELECT id,name,code FROM users WHERE id=?',uid);check(u,'Игрок не найден');return u}
 code(table){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(let i=0;i<100;i++){
   const code=Array.from(crypto.getRandomValues(new Uint8Array(8)),x=>chars[x%32]).join('');
   if(table==='rooms'?!this.rooms.has(code):!this.one('SELECT id FROM users WHERE code=?',code))return code;
  }throw Error('Не удалось подобрать код');
 }
 register(name,token,tokenHash){
  name=text(name?.trim(),1,20,'Имя: от 1 до 20 символов');
  check(this.one('SELECT COUNT(*) AS n FROM users').n<2000,'Этот частный клуб заполнен');
  const u={id:random(12),name,code:this.code('users')};
  this.sql.exec('INSERT INTO users VALUES(?,?,?,?)',u.id,tokenHash,u.code,name);return{user:u,token};
 }
 room(code){check(typeof code==='string'&&/^[A-Z2-9]{8}$/.test(code),'Неверный код комнаты');const r=this.rooms.get(code);check(r,'Комната не найдена');return r}
 save(r){this.sql.exec('INSERT OR REPLACE INTO rooms VALUES(?,?)',r.code,JSON.stringify(r));this.rooms.set(r.code,r)}
 runtime(code){if(!this.live.has(code))this.live.set(code,{seen:0,session:'',lease:'',sequence:0,peers:{},inbox:[],snapshots:{},links:{},hostLink:''});return this.live.get(code)}
 online(code){return time()-this.runtime(code).seen<8}
 member(r,uid){check(r.members.some(m=>m.id===uid),'Вы не участник комнаты')}
 disconnected(link){for(const rt of this.live.values()){if(rt.hostLink===link)rt.seen=0;for(const [uid,id]of Object.entries(rt.links))if(id===link)rt.peers[uid]=0}}
 update(r){this.notify(r.members.map(p=>p.id),r.code)}
 me(u){
  const friends=[],requests=[];
  for(const f of this.rows('SELECT * FROM friends WHERE sender=? OR target=?',u.id,u.id)){
   const item=this.user(f.sender===u.id?f.target:f.sender);if(f.accepted)friends.push(item);else requests.push({...item,incoming:f.target===u.id});
  }
  const invites=this.rows('SELECT * FROM invites WHERE target=? AND created>?',u.id,time()-86400).map(i=>({room:i.room,sender:this.user(i.sender)}));
  const rooms=[];for(const r of this.rooms.values())if(r.members.some(m=>m.id===u.id))rooms.push({code:r.code,owner:r.owner,name:r.name,players:r.members.length,mode:'phone',host_online:this.online(r.code),...r.summary});
  return{user:pub(u),friends,requests,invites,rooms};
 }
 call(path,d,u,method='POST',link='http'){
  check(object(d),'Нужен объект');
  if(path.startsWith('/api/phone/'))return this.phone(path.slice(11),d,u,method,link);
  if(path==='/api/me'&&method==='GET')return this.me(u);
  check(method==='POST','Неизвестный запрос');
  const key=text(d.key,8,100,'Нужен номер команды'),cached=this.one('SELECT result FROM commands WHERE uid=? AND key=?',u.id,key);
  if(cached)return JSON.parse(cached.result);
  const result=this.social(path,d,u);
  this.sql.exec('INSERT INTO commands VALUES(?,?,?,?)',u.id,key,JSON.stringify(result),time());
  this.sql.exec('DELETE FROM commands WHERE created<?',time()-7*86400);return result;
 }
 social(path,d,u){
  const uid=u.id;
  if(path==='/api/friend'){
   const other=this.one('SELECT id FROM users WHERE code=?',String(d.code||'').trim().toUpperCase());check(other,'Игрок с таким кодом не найден');check(other.id!==uid,'Это ваш код');
   const rows=this.rows('SELECT * FROM friends WHERE (sender=? AND target=?) OR (sender=? AND target=?)',uid,other.id,other.id,uid);
   if(d.action==='request'){
    check(!rows.length,'Заявка или дружба уже существует');
    for(const id of [uid,other.id])check(this.one('SELECT COUNT(*) AS n FROM friends WHERE sender=? OR target=?',id,id).n<100,'Лимит: 100 друзей и заявок');
    this.sql.exec('INSERT INTO friends VALUES(?,?,0)',uid,other.id);
   }else if(d.action==='accept'){
    check(rows.some(r=>r.sender===other.id&&!r.accepted),'Входящей заявки нет');this.sql.exec('UPDATE friends SET accepted=1 WHERE sender=? AND target=?',other.id,uid);
   }else if(d.action==='remove')this.sql.exec('DELETE FROM friends WHERE (sender=? AND target=?) OR (sender=? AND target=?)',uid,other.id,other.id,uid);
   else throw new RuleError('Неизвестное действие');
   this.notify([uid,other.id]);return{ok:true};
  }
  if(path==='/api/invite'){
   const r=this.room(d.code);this.member(r,uid);
   check(typeof d.target==='string'&&this.one('SELECT 1 AS ok FROM friends WHERE accepted=1 AND ((sender=? AND target=?) OR (sender=? AND target=?))',uid,d.target,d.target,uid),'Пригласить можно друга');
   this.sql.exec('INSERT OR REPLACE INTO invites VALUES(?,?,?,?)',uid,d.target,r.code,time());this.notify([d.target]);return{ok:true};
  }
  if(path==='/api/dismiss-invite'){this.sql.exec('DELETE FROM invites WHERE target=? AND room=?',uid,String(d.code||''));this.notify([uid]);return{ok:true}}
  throw new RuleError('Этот сервис поддерживает комнаты с хостом на телефоне. Обновите APK.');
 }
 phone(op,d,u,method,link){
  const uid=u.id;
  if(op==='lookup'){
   const r=this.rooms.get(String(d.code||'').trim().toUpperCase());if(!r)return{phone:false};
   return{phone:true,code:r.code,name:r.name,owner:r.owner,host_online:this.online(r.code),public_key:r.public_key};
  }
  check(method==='POST','Нужен POST');
  if(op==='create'){
   const key=text(d.key,8,100,'Нужен номер команды'),old=this.one('SELECT result FROM commands WHERE uid=? AND key=?',uid,key);if(old)return JSON.parse(old.result);
   check([...this.rooms.values()].filter(r=>r.owner===uid).length<20,'Можно создать до 20 комнат');check(this.rooms.size<2000,'Этот частный клуб заполнен');
   const r={code:this.code('rooms'),owner:uid,name:text(d.name?.trim(),1,32,'Название: 1–32 символа'),device:text(d.device,20,100,'Нужен ключ устройства хоста'),public_key:publicKey(d.public_key),members:[],summary:{hand:0,phase:'waiting',paused:false}};
   r.members.push({id:uid,name:u.name,public_key:r.public_key});this.save(r);
   const result={phone:true,code:r.code,owner:uid,public_key:r.public_key};
   this.sql.exec('INSERT INTO commands VALUES(?,?,?,?)',uid,key,JSON.stringify(result),time());this.notify([uid]);return result;
  }
  const r=this.room(String(d.code||'').trim().toUpperCase()),rt=this.runtime(r.code),code=r.code;
  if(op==='join'){
   const key=publicKey(d.public_key);let m=r.members.find(m=>m.id===uid),changed=false;
   if(!m){
    check(this.online(code),'Хост не в сети. Он должен открыть комнату на своём телефоне.');check(r.members.length<4,'В комнате уже четыре игрока');check(['waiting','finished'].includes(r.summary.phase),'Дождитесь окончания раздачи');
    r.members.push({id:uid,name:u.name,public_key:key});changed=true;
   }else if(uid!==r.owner&&JSON.stringify(m.public_key)!==JSON.stringify(key)){
    delete rt.snapshots[uid];rt.inbox=rt.inbox.filter(m=>m.sender!==uid);m.public_key=key;changed=true;
   }
   if(changed)this.save(r);rt.peers[uid]=time();rt.links[uid]=link;
   this.sql.exec('DELETE FROM invites WHERE target=? AND room=?',uid,code);this.update(r);
   return{code,owner:r.owner,name:r.name,public_key:r.public_key,host_online:this.online(code)};
  }
  this.member(r,uid);
  if(['sync','publish','sleep'].includes(op)){
   check(uid===r.owner&&d.device===r.device,'Это не устройство хоста');text(d.session,20,100,'Нужен идентификатор сессии');
   if(op==='sync'){
    if(rt.session!==d.session){check(!this.online(code),'Комната уже открыта в другом окне хоста. Закройте его и подождите 8 секунд.');Object.assign(rt,{session:d.session,lease:random(),sequence:0,snapshots:{}})}
    rt.seen=time();rt.peers[uid]=time();rt.hostLink=link;rt.links[uid]=link;
    return{lease:rt.lease,members:r.members,inbox:rt.inbox.slice(0,128),online:Object.fromEntries(r.members.map(m=>[m.id,time()-(rt.peers[m.id]||0)<8]))};
   }
   check(rt.session===d.session&&rt.lease===d.lease,'Сессия хоста изменилась');
   if(op==='sleep'){rt.seen=0;this.update(r);return{ok:true}}
   const sequence=integer(d.sequence,1,Number.MAX_SAFE_INTEGER);if(sequence<=rt.sequence)return{ok:true};
   check(object(d.packets)&&Object.keys(d.packets).length<=4,'Слишком много пакетов');
   for(const [target,p]of Object.entries(d.packets)){check(target!==uid&&r.members.some(m=>m.id===target),'Неверный получатель');packet(p)}
   check(Array.isArray(d.ack)&&d.ack.length<=128&&d.ack.every(x=>typeof x==='string'&&x.length<=160),'Неверные подтверждения');
   const s=d.summary;check(object(s)&&['waiting','preflop','flop','turn','river','finished'].includes(s.phase)&&typeof s.paused==='boolean','Неверная стадия');integer(s.hand,0,100000000);
   const summary={phase:s.phase,hand:s.hand,paused:s.paused};
   if(JSON.stringify(summary)!==JSON.stringify(r.summary)){r.summary=summary;this.save(r)}
   Object.assign(rt.snapshots,d.packets);rt.sequence=sequence;rt.seen=time();rt.inbox=rt.inbox.filter(m=>!d.ack.includes(m.id));this.update(r);return{ok:true};
  }
  if(op==='poll'){
   rt.peers[uid]=time();rt.links[uid]=link;
   return{host_online:this.online(code),packet:rt.snapshots[uid]||null,sequence:rt.sequence,lease:rt.lease};
  }
  if(op==='send'){
   check(uid!==r.owner,'Хост обрабатывает свои команды локально');check(this.online(code),'Хост не в сети. Игра приостановлена.');
   const key=text(d.key,8,100,'Нужен номер команды'),p=packet(d.packet),id=uid+':'+key;
   if(!rt.inbox.some(m=>m.id===id)){check(rt.inbox.filter(m=>m.sender===uid).length<32,'Дождитесь обработки предыдущих действий');rt.inbox.push({id,key,sender:uid,packet:p})}
   rt.peers[uid]=time();rt.links[uid]=link;this.notify([r.owner],code);return{queued:true};
  }
  throw new RuleError('Неизвестный запрос ретранслятора');
 }
}
