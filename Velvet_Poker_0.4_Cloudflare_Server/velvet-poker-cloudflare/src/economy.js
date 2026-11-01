import './catalog.js';
import {PROMOS} from './promos.js';
const C=globalThis.VelvetCosmetics;
export class Economy{
 constructor(s){this.s=s;this.cache=new Map();s.sql.exec(`CREATE TABLE IF NOT EXISTS wallets(uid TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE IF NOT EXISTS reward_totals(room TEXT,uid TEXT,total INTEGER NOT NULL,PRIMARY KEY(room,uid));CREATE TABLE IF NOT EXISTS promo_claims(promo TEXT,uid TEXT,PRIMARY KEY(promo,uid));`)}
 wallet(uid){if(!this.cache.has(uid)){const row=this.s.one('SELECT data FROM wallets WHERE uid=?',uid);this.cache.set(uid,row?JSON.parse(row.data):{points:0,earned:0,owned:[],equipped:{}})}const w=JSON.parse(JSON.stringify(this.cache.get(uid)));w.owned=[...new Set([...C.free,...w.owned])];w.equipped={...C.defaults,...w.equipped};return w}
 save(uid,w){this.s.sql.exec('INSERT OR REPLACE INTO wallets VALUES(?,?)',uid,JSON.stringify(w));this.cache.set(uid,w);this.s.notify([uid])}
 club(r,uid){const rt=this.s.runtime(r.code);return{version:1,mine:this.wallet(uid),looks:Object.fromEntries(r.members.map(m=>[m.id,this.wallet(m.id).equipped])),reactions:(rt.reactions||[]).filter(e=>e.at>Date.now()/1000-6)}}
 credit(r,totals,check){if(totals===undefined)return;check(totals&&typeof totals==='object'&&!Array.isArray(totals)&&Object.keys(totals).length<=4,'Неверные начисления');const changes=[];
  for(const [uid,total]of Object.entries(totals)){check(r.members.some(m=>m.id===uid)&&Number.isSafeInteger(total)&&total>=0&&total<=10000000,'Неверный счётчик ходов');const old=this.s.one('SELECT total FROM reward_totals WHERE room=? AND uid=?',r.code,uid)?.total||0;if(total<=old)continue;check(total-old<=10000,'Слишком большой пакет начислений');changes.push({uid,total,delta:total-old})}
  for(const {uid,total,delta}of changes){const w=this.wallet(uid);w.points+=delta;w.earned+=delta;this.s.sql.exec('INSERT OR REPLACE INTO reward_totals VALUES(?,?,?)',r.code,uid,total);this.save(uid,w)}
 }
 call(d,u,check){const s=this.s,w=this.wallet(u.id);
  if(d.action==='buy'||d.action==='equip'){const item=C.byId[d.item];check(item,'Предмет не найден');if(d.action==='buy'&&!w.owned.includes(item.id)){check(w.points>=item.price,'Не хватает баллов');w.points-=item.price;w.owned.push(item.id)}check(w.owned.includes(item.id),'Сначала откройте предмет');if(item.type!=='emote')w.equipped[item.type]=item.id;this.save(u.id,w);for(const r of s.rooms.values())if(r.members.some(m=>m.id===u.id))s.update(r);return{wallet:w}}
  if(d.action==='promo'){const p=PROMOS[d.promo_digest];check(p,'Промокод не найден');check(!s.one('SELECT 1 AS ok FROM promo_claims WHERE promo=? AND uid=?',p.id,u.id),'Промокод уже использован');if(p.single)check(!s.one('SELECT 1 AS ok FROM promo_claims WHERE promo=?',p.id),'Личный промокод уже активирован');s.sql.exec('INSERT INTO promo_claims VALUES(?,?)',p.id,u.id);w.points+=p.points;this.save(u.id,w);return{wallet:w,added:p.points}}
  if(d.action==='react'){const r=s.room(d.code);s.member(r,u.id);check(s.online(r.code),'Хост не в сети');const item=C.byId[d.item];check(item?.type==='emote'&&w.owned.includes(item.id),'Эмоция не открыта');s.rate('reaction:'+u.id,1,3);const rt=s.runtime(r.code);rt.reactions=(rt.reactions||[]).filter(e=>e.at>Date.now()/1000-6);rt.reactions.push({id:u.id+':'+d.key,uid:u.id,item:item.id,at:Date.now()/1000});rt.reactions=rt.reactions.slice(-8);s.update(r);return{ok:true}}
  check(false,'Неизвестное действие магазина');
 }
}
