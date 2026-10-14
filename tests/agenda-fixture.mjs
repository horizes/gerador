// Banco PostgreSQL local isolado. Nenhuma chamada a SMTP ou Google reais.
import {readFileSync} from 'node:fs';
import {createAgendaService} from '../supabase/functions/agenda/service.ts';
import {seal} from '../supabase/functions/agenda/google.ts';
import {dateOnly,addDays} from '../supabase/functions/agenda/core.ts';
export const ADMIN='11111111-1111-4111-8111-111111111111',MANAGER='22222222-2222-4222-8222-222222222222',USER='33333333-3333-4333-8333-333333333333';
export async function fixture({smtp=false}={}){
 const {PGlite}=await import(process.env.IMPERIUM_PGLITE_PATH||'@electric-sql/pglite');const pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz,encrypted_password text);create table perfis(id uuid primary key,nome text,papel text,cargo_id uuid,ativo boolean);create table cargo_modulos(cargo_id uuid,modulo_id text);create table perfil_modulos(perfil_id uuid,modulo_id text);`);
 await pg.exec(readFileSync(new URL('../supabase-schema-agenda.sql',import.meta.url),'utf8'));
 await pg.exec(`insert into auth.users values('${ADMIN}',now(),'hash'),('${MANAGER}',now(),'hash'),('${USER}',now(),'hash');insert into perfis values('${ADMIN}','Admin','admin',null,true),('${MANAGER}','Gestor','usuario',null,true),('${USER}','Colaborador','usuario',null,true);insert into perfil_modulos values('${MANAGER}','agenda_gestao');`);
 const logs=[],sent=[],events=new Map(),background=[];let googleFail=false,smtpFail=null;
 const qname=s=>{if(!/^[a-z_]+$/.test(s))throw Error('Identificador inválido');return '"'+s+'"';};
 const parameter=x=>x!==null&&typeof x==='object'?JSON.stringify(x):x;
 function from(table){let action='select',patch=null,filters=[],single=false,sort=[],limit=null;const q={
  select(){return q},eq(k,v){filters.push([k,'=',v]);return q},lt(k,v){filters.push([k,'<',v]);return q},in(k,v){filters.push([k,'in',v]);return q},order(k,o={}){sort.push(qname(k)+(o.ascending===false?' desc':' asc'));return q},limit(n){limit=n;return q},maybeSingle(){single=true;return q},single(){single=true;return q},
  insert(v){action='insert';patch=v;return q},upsert(v){action='upsert';patch=v;return q},update(v){action='update';patch=v;return q},delete(){action='delete';return q},
  async run(){try{
   const values=[];const bind=v=>{values.push(parameter(v));return '$'+values.length;};let sql='';
   if(action==='select')sql='select * from '+qname(table);
   if(action==='delete')sql='delete from '+qname(table);
   if(action==='update')sql='update '+qname(table)+' set '+Object.entries(patch).map(([k,v])=>qname(k)+'='+bind(v)).join(',');
   if(action==='insert'||action==='upsert'){
    const rows=Array.isArray(patch)?patch:[patch],keys=Object.keys(rows[0]);sql='insert into '+qname(table)+' ('+keys.map(qname).join(',')+') values '+rows.map(r=>'('+keys.map(k=>bind(r[k])).join(',')+')').join(',');
    if(action==='upsert')sql+=' on conflict(id) do update set '+keys.filter(k=>k!=='id').map(k=>qname(k)+'=excluded.'+qname(k)).join(',');
   }else if(filters.length)sql+=' where '+filters.map(([k,op,v])=>op==='in'?qname(k)+' in ('+v.map(bind).join(',')+')':qname(k)+op+bind(v)).join(' and ');
   if(action!=='select')sql+=' returning *';else{if(sort.length)sql+=' order by '+sort.join(',');if(limit!==null)sql+=' limit '+Number(limit);}
   const r=await pg.query(sql,values);return {data:single?(r.rows[0]||null):r.rows,error:null};
  }catch(error){return {data:null,error:{code:error.code,message:error.message}};}},then(a,b){return q.run().then(a,b)}
 };return q;}
 const db={from,auth:{async getUser(token){const id={admin:ADMIN,gestor:MANAGER,usuario:USER}[token];return id?{data:{user:{id,email_confirmed_at:new Date().toISOString()}},error:null}:{data:null,error:{message:'Sessão inválida'}};}},
  async rpc(name,args={}){try{const entries=Object.entries(args),sql='select '+qname(name)+'('+entries.map(([k],i)=>qname(k)+'=>$'+(i+1)).join(',')+') as data';return {data:(await pg.query(sql,entries.map(([,v])=>parameter(v)))).rows[0].data,error:null};}catch(e){return {data:null,error:{code:e.code,message:e.message}};}}};
 const env={SITE_URL:'https://imperium.test/',DATA_KEY:Buffer.alloc(32,1).toString('base64'),RATE_SALT:'test-only-salt',CRON_SECRET:'test-only-cron'};
 if(smtp)Object.assign(env,{SMTP_HOST:'smtp.example.test',SMTP_PORT:'465',SMTP_USER:'test',SMTP_PASS:'test-only-password',SMTP_FROM:'agenda@example.test'});
 const transport=async(url,options={})=>{
  logs.push({url,options});if(googleFail)return Response.json({error:'test'},{status:503});
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test-access',refresh_token:'test-refresh',scope:'openid email https://www.googleapis.com/auth/calendar.events.owned',expires_in:3600});
  if(url==='https://openidconnect.googleapis.com/v1/userinfo')return Response.json({sub:'test-google-sub',email:'host@example.test',email_verified:true});
  const u=new URL(url),id=decodeURIComponent(u.pathname.split('/').at(-1));
  if(options.method==='POST'){const body=JSON.parse(options.body);if(events.has(body.id))return Response.json({}, {status:409});body.hangoutLink='https://meet.google.com/abc-defg-hij';events.set(body.id,body);return Response.json(body,{status:201});}
  if(options.method==='PATCH'){const e=events.get(id);if(!e)return Response.json({},{status:404});Object.assign(e,JSON.parse(options.body));e.hangoutLink='https://meet.google.com/abc-defg-hij';return Response.json(e);}
  if(options.method==='DELETE'){events.delete(id);return new Response(null,{status:204});}
  return events.has(id)?Response.json(events.get(id)):Response.json({},{status:404});
 };
 const service=createAgendaService(db,env,{transport,sendMail:async(b,c,j)=>{if(smtpFail)throw smtpFail;sent.push({booking:b.id,contact:c,job:j.id,kind:j.kind,hadLink:!!b.online_link});},defer:p=>background.push(p)});
 async function api(action,payload={},token='admin'){
  const req=new Request('https://imperium.test/functions/agenda',{method:'POST',headers:{Origin:'https://imperium.test','Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({action,payload})});
  const r=await service.fetch(req),v=await r.json();return {status:r.status,...v};
 }
 async function flush(){while(background.length)await Promise.all(background.splice(0));}
 async function configured(){
  let snapshot=(await db.rpc('agenda_snapshot',{p_from:dateOnly(new Date()),p_until:addDays(dateOnly(new Date()),90)})).data;
  await api('saveAgendaSettings',{...snapshot.settings,enabled:true,noticeMinutes:0,onlineLink:'https://meet.google.com/abc-defg-hij'});
  snapshot=(await db.rpc('agenda_snapshot',{p_from:dateOnly(new Date()),p_until:addDays(dateOnly(new Date()),90)})).data;
  await api('saveWeeklyAgenda',{revision:snapshot.settings.revision,weeklyRevision:snapshot.weekly.revision,gap:0,modes:['online','presencial'],days:Array.from({length:7},(_,day)=>({day,enabled:true,ranges:[{from:'09:00',until:'12:00'},{from:'14:00',until:'17:00'}]}))});
 }
 async function connect(){
  await api('adminGoogleConfigure',{web:{client_id:'test.apps.googleusercontent.com',client_secret:'test-client-secret',redirect_uris:['https://imperium.test/agenda-google-callback.html']}});
  const result=(await api('adminGoogleStart')).data,u=new URL(result.url);return api('googleCallback',{code:'test-code',state:u.searchParams.get('state'),browserSecret:result.browserSecret},null);
 }
 async function bookPayload(change={}){
  const info=(await api('agendaInfo',{},null)).data,date=addDays(dateOnly(new Date()),2),slot=info.slots.find(s=>s.date===date);
  return {attempt:crypto.randomUUID(),proof:crypto.randomUUID(),revision:info.revision,slotId:slot.id,mode:'online',name:'Ana Pereira',whatsapp:'11999999999',email:'ana@example.test',company:'Condomínio Imperial',address:'Rua Imperial, 100',subject:'Conhecer os serviços da Imperium',notes:'',consent:true,...change};
 }
 return {pg,db,env,service,api,configured,connect,bookPayload,flush,sent,logs,events,setGoogleFailure(v){googleFail=v;},setSMTPFailure(e){smtpFail=e;},async close(){await flush();await pg.close();},async cipher(value){return seal(value,env.DATA_KEY);}};
}
