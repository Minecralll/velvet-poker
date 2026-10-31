import {DurableObject} from 'cloudflare:workers';
import {Service,RuleError,check,object,hash,random} from './service.js';
const ORIGIN='https://appassets.androidplatform.net';
const health={ok:true,protocol:3,phone_host:true,transport:'websocket',service:'velvet-cloudflare',version:'0.3.0'};
const json=(data,status=200,origin='')=>new Response(JSON.stringify(data),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
 ...(origin===ORIGIN?{'Access-Control-Allow-Origin':ORIGIN,'Vary':'Origin'}:{})
}});
const safeError=e=>e instanceof RuleError?e.message:'Ошибка сервиса. Повторите запрос с тем же номером команды.';
export class VelvetClub extends DurableObject {
 constructor(ctx,env){
  super(ctx,env);this.clients=new Set();this.queue=Promise.resolve();
  this.service=new Service(ctx.storage.sql,(ids,code)=>{
   for(const c of this.clients)if(c.user&&ids.includes(c.user.id))this.send(c,{type:'invalidate',code:code||null});
  });
 }
 serial(fn){const p=this.queue.then(fn);this.queue=p.catch(()=>{});return p}
 send(c,data){try{c.ws.send(JSON.stringify(data))}catch{this.close(c)}}
 close(c){if(c.closed)return;c.closed=true;clearTimeout(c.timeout);this.clients.delete(c);this.service.disconnected(c.id);try{c.ws.close(1000,'Disconnected')}catch{}}
 async fetch(request){
  const url=new URL(request.url),origin=request.headers.get('Origin')||'',ip=request.headers.get('CF-Connecting-IP')||'local';
  try{
   check(!origin||origin===ORIGIN||origin===url.origin,'Этот источник не разрешён');
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Max-Age':'3600'}});
   if(url.pathname==='/health'&&request.method==='GET')return json(health,200,origin);
   if(url.pathname==='/'&&request.method==='GET')return json({...health,message:'Velvet Poker: сервис готов. Откройте приложение.'},200,origin);
   this.service.rate('http:'+ip,120,60);
   if(url.pathname==='/api/ws'){
    check(request.headers.get('Upgrade')?.toLowerCase()==='websocket','Нужно WebSocket-подключение');check(this.clients.size<64,'Клуб заполнен. Повторите позже.');
    const pair=new WebSocketPair(),ws=pair[1],c={ws,id:random(12),ip,user:null,pending:0};
    // A single object for the private club. Ordinary sockets keep volatile
    // mailboxes alive; after isolate restart the host republishes its local save.
    ws.accept();this.clients.add(c);c.timeout=setTimeout(()=>this.close(c),10000);
    ws.addEventListener('message',event=>{
     if(typeof event.data!=='string'||event.data.length>400000||c.pending>=16){this.close(c);return}
     c.pending++;
     this.serial(async()=>{
      let m;try{
       if(c.closed)return;m=JSON.parse(event.data);check(object(m),'Неверный пакет');this.service.rate('ws:'+ip,1200,60);
       if(!c.user){
        check(m.type==='auth'&&typeof m.token==='string'&&m.token.length<=200,'Нужен ключ профиля');
        c.user=this.service.userByHash(await hash(m.token));clearTimeout(c.timeout);this.send(c,{type:'ready',...health});return;
       }
       check(m.type==='rpc'&&typeof m.id==='string'&&m.id.length<=80&&typeof m.path==='string'&&m.path.length<=300,'Неверный запрос');
       const u=new URL(m.path,'https://local');check(u.origin==='https://local'&&u.pathname.startsWith('/api/'),'Неверный путь');
       const method=m.data===null||m.data===undefined?'GET':'POST',d=method==='GET'?Object.fromEntries(u.searchParams):m.data;
       const result=this.ctx.storage.transactionSync(()=>this.service.call(u.pathname,d,c.user,method,c.id));
       this.send(c,{type:'result',id:m.id,ok:true,result});
      }catch(e){this.send(c,{type:'result',id:typeof m?.id==='string'?m.id:null,ok:false,error:safeError(e)});if(!c.user)this.close(c)}
     }).finally(()=>c.pending--);
    });
    ws.addEventListener('close',()=>this.close(c));ws.addEventListener('error',()=>this.close(c));
    return new Response(null,{status:101,webSocket:pair[0]});
   }
   check(['GET','POST'].includes(request.method),'Метод недоступен');
   let d={};if(request.method==='POST'){
    check(Number(request.headers.get('Content-Length')||0)<=400000,'Запрос слишком большой');
    const body=await request.text();check(body.length<=400000,'Запрос слишком большой');d=JSON.parse(body);check(object(d),'Нужен объект');
   }else d=Object.fromEntries(url.searchParams);
   if(url.pathname==='/api/register'){
    check(request.method==='POST','Нужен POST');this.service.rate('register:'+ip,12,3600);
    const token=random(32),tokenHash=await hash(token);
    const result=await this.serial(()=>this.ctx.storage.transactionSync(()=>this.service.register(d.name,token,tokenHash)));return json(result,200,origin);
   }
   // HTTP supports compatibility and diagnostics; APK 0.3 polls via WebSocket.
   const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';check(token.length<=200,'Неверный ключ профиля');
   const tokenHash=await hash(token);
   const result=await this.serial(()=>this.ctx.storage.transactionSync(()=>this.service.call(url.pathname,d,this.service.userByHash(tokenHash),request.method)));
   return json(result,200,origin);
  }catch(e){return json({error:e instanceof SyntaxError?'Неверный JSON':safeError(e)},400,origin)}
 }
}
export default {
 async fetch(request,env){
  // Constant across deploys. Changing this name creates a different club.
  return env.CLUB.get(env.CLUB.idFromName('velvet-private-club-v1')).fetch(request);
 }
};
