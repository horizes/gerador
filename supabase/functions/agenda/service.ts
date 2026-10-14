import {AgendaError,SUBJECTS,dateOnly,addDays,validDate,minutes,instant,clean,settings,weekly,extra,slots,contact,publicBooking} from './core.ts';
import {GoogleAgenda,hash,seal,unseal} from './google.ts';
import {smtpOptions} from './mail.ts';
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
const publics=new Set(['agendaInfo','agendaBook','agendaRecover','googleCallback']);
const errors={CONFLICT:['O horário ou as configurações mudaram. Atualize a agenda e tente novamente.',409],VALIDATION:['Confira os dados informados.',400],RATE_LIMIT:['Aguarde alguns minutos antes de tentar novamente.',429],UNAUTHORIZED:['Você não tem autorização para esta ação.',401],NOT_FOUND:['Agendamento não encontrado.',404]};
export function createAgendaService(db,env,{transport=fetch,sendMail=async()=>{throw new AgendaError('SMTP indisponível.','MAIL_CONFIG',503);},defer=null}={}){
 async function rpc(name,args={}){const r=await db.rpc(name,args);if(r.error){const code=Object.keys(errors).find(k=>String(r.error.message).includes(k));if(code)throw new AgendaError(errors[code][0],code,errors[code][1]);throw new AgendaError('A agenda precisa ser instalada ou está temporariamente indisponível.','UNAVAILABLE',503);}return r.data;}
 const google=new GoogleAgenda(db,env,rpc,transport);
 function emailConfigured(){try{smtpOptions(env);return true;}catch{return false;}}
 async function permission(req,admin=false){
  const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');if(!token)throw new AgendaError('Entre na plataforma para gerenciar a agenda.','UNAUTHORIZED',401);
  const r=await db.auth.getUser(token);if(r.error||!r.data?.user?.email_confirmed_at)throw new AgendaError('Sua sessão expirou. Entre novamente.','UNAUTHORIZED',401);
  const p=await rpc('agenda_permission',{p_actor:r.data.user.id});if(!(admin?p.admin:p.manage))throw new AgendaError('Você não tem acesso a esta configuração.','UNAUTHORIZED',403);
  return {id:r.data.user.id,...p};
 }
 async function one(table,id){const r=await db.from(table).select('*').eq('id',id).maybeSingle();if(r.error)throw new AgendaError('Não foi possível consultar a agenda.','UNAVAILABLE',503);return r.data;}
 async function bookingByProof(p){
  if(!uuid(p.attempt)||!uuid(p.proof))throw new AgendaError('A tentativa é inválida.','VALIDATION',400);
  const r=await db.from('agenda_bookings').select('*').eq('attempt',p.attempt).eq('proof_hash',await hash(p.proof)).maybeSingle();if(r.error)throw new AgendaError('Não foi possível recuperar a tentativa.','UNAVAILABLE',503);return r.data;
 }
 async function display(b){return publicBooking(b,await unseal(b.contact_cipher,env.DATA_KEY));}
 async function queue(limit=3){
  for(let i=0;i<limit;i++){
   const job=await rpc('agenda_claim_job');if(!job)break;const b=await one('agenda_bookings',job.booking_id);
   let success=false,patch=null,code='';
   try{
    if(!b)throw new AgendaError('Registro indisponível.','NOT_FOUND',404);
    const c=await unseal(b.contact_cipher,env.DATA_KEY);
    if(job.kind==='google')patch=await google.synchronize(b,c);
    else if(b.status==='confirmed'&&!(job.kind==='email_meet'&&b.email_meet_status==='not_needed'))await sendMail(b,c,job);
    success=true;
   }catch(e){
    code=e instanceof AgendaError?e.code:job.kind==='google'?'GOOGLE_FAILED':'EMAIL_REVIEW';
    if(job.kind==='google')patch={status:b?.status==='canceled'?'cancel_pending':code==='AUTHORIZATION_REQUIRED'?'authorization_required':code==='CONFERENCE_PENDING'?'pending':'failed'};
   }
   await rpc('agenda_finish_job',{p_id:job.id,p_success:success,p_google:patch,p_error:code,p_had_link:job.kind==='email'?!!b?.online_link:null});
  }
 }
 function background(){const work=queue().catch(()=>{});if(defer)defer(work);return work;}
 function siteURL(file){if(!env.SITE_URL)throw new AgendaError('Configure o endereço da Imperium na agenda.','CONFIGURATION',503);return new URL(file,env.SITE_URL.endsWith('/')?env.SITE_URL:env.SITE_URL+'/').href;}
 async function snapshot(from,until){return rpc('agenda_snapshot',{p_from:from,p_until:until});}
 async function handle(action,p,req){
  const now=new Date(),today=dateOnly(now);
  if(action==='processQueue'){
   if(!env.CRON_SECRET||req.headers.get('x-agenda-key')!==env.CRON_SECRET)throw new AgendaError('Não autorizado.','UNAUTHORIZED',401);await queue(6);return {ok:true};
  }
  if(action==='googleCallback')return google.finish(p);
  if(action==='agendaInfo'){
   const snap=await snapshot(today,addDays(today,90));
   return {hostName:snap.settings.hostName,revision:snap.settings.revision,enabled:snap.settings.enabled,subjects:Object.fromEntries(SUBJECTS.map(s=>[s,s])),now:now.toISOString(),slots:snap.settings.enabled?slots(snap,today,addDays(today,90),now).filter(s=>s.available).map(({id,date,time,duration,modes})=>({id,date,time,duration,modes})):[]};
  }
  if(action==='agendaRecover'){
   let b=await bookingByProof(p);if(!b)return {exists:false};
   if(b.google.status==='pending'||['pending','sending'].includes(b.email_status)||b.email_meet_status==='pending')background();
   b=await one('agenda_bookings',b.id);return {exists:true,booking:await display(b)};
  }
  if(action==='agendaBook'){
   if(!uuid(p.attempt)||!uuid(p.proof)||!uuid(p.revision)||typeof p.slotId!=='string'||p.slotId.length>100)throw new AgendaError('A tentativa é inválida.');
   const c=contact(p),fingerprint=await hash(JSON.stringify({contact:c,mode:p.mode,subject:p.subject,slotId:p.slotId}));
   const existing=await bookingByProof(p);
   if(existing){if(existing.fingerprint!==fingerprint)throw new AgendaError('Esta tentativa já foi usada com outros dados.','CONFLICT',409);background();return display(existing);}
   const snap=await snapshot(today,addDays(today,90)),slot=slots(snap,today,addDays(today,90),now).find(s=>s.id===p.slotId);
   if(!snap.settings.enabled||snap.settings.revision!==p.revision||!slot?.available||!slot.modes.includes(p.mode))throw new AgendaError('Este horário não está mais disponível. Escolha outro.','CONFLICT',409);
   const row=await rpc('agenda_book',{p:{attempt:p.attempt,proof_hash:await hash(p.proof),fingerprint,email_hash:await hash(c.email),client_hash:await hash((req.headers.get('x-forwarded-for')||'desconhecido').split(',')[0]+env.RATE_SALT),
    revision:p.revision,slot_key:slot.id,date:slot.date,time:slot.time,start_at:slot.startAt,end_at:slot.endAt,duration:slot.duration,mode:p.mode,subject:p.subject,contact_cipher:await seal(c,env.DATA_KEY),email_configured:emailConfigured()}});
   background();return display(row);
  }
  const googleAction=action.startsWith('adminGoogle');const actor=await permission(req,googleAction&&action!=='adminGoogleRetry');
  if(action==='adminGoogleConfigure')return google.configure(p.web);
  if(action==='adminGoogleStart')return google.start(actor.id);
  if(action==='adminGoogleDisconnect'){
   await rpc('agenda_disconnect_google',{p_actor:actor.id});return {ok:true};
  }
  if(action==='adminGoogleRetry'){
   if(!uuid(p.id))throw new AgendaError('Registro inválido.');const b=await one('agenda_bookings',p.id);if(!b||b.google.status==='manual')throw new AgendaError('Este agendamento não usa o Meet automático.');
   if(b.google.status==='failed'){
    const changed=await db.from('agenda_bookings').update({google:{...b.google,conferenceRequestId:crypto.randomUUID(),status:b.status==='canceled'?'cancel_pending':'pending'}}).eq('id',b.id);if(changed.error)throw new AgendaError('Não foi possível preparar a verificação.','UNAVAILABLE',503);
   }
   const r=await db.from('agenda_jobs').update({status:'pending',attempts:0,next_at:new Date().toISOString()}).eq('booking_id',p.id).eq('kind','google');if(r.error)throw new AgendaError('Não foi possível preparar a verificação.','UNAVAILABLE',503);
   await queue();return {ok:true};
  }
  if(action==='resendAgendaConfirmation'){
   if(!uuid(p.id)||!uuid(p.attempt)||!emailConfigured())throw new AgendaError('Confira a configuração SMTP da agenda.');const b=await one('agenda_bookings',p.id);if(!b||b.status!=='confirmed'||Date.parse(b.start_at)<=Date.now())throw new AgendaError('Esta reunião não pode receber outra confirmação.');
   const old=await one('agenda_jobs',p.attempt);if(old&&(old.booking_id!==p.id||old.kind!=='email'))throw new AgendaError('Tentativa inválida.');
   if(!old){const r=await db.from('agenda_jobs').insert({id:p.attempt,booking_id:p.id,kind:'email'});if(r.error&&r.error.code!=='23505')throw new AgendaError('Não foi possível preparar o envio.','UNAVAILABLE',503);}
   background();return {ok:true};
  }
  if(action==='adminAgenda'){
   const day=p.startDate||today,month=p.month||day.slice(0,7);
   if(!validDate(day)||!validDate(month+'-01')||day.slice(0,7)!==month||month<'2020-01'||month>'2100-12')throw new AgendaError('Selecione um mês e um dia válidos.');
   const until=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0,12)).toISOString().slice(0,10),snap=await snapshot(month+'-01',until),list=slots(snap,month+'-01',until,now);
   const days={};for(let d=month+'-01';d<=until;d=addDays(d,1))days[d]={free:list.filter(s=>s.date===d&&s.available).length,bookings:snap.bookings.filter(b=>b.date===d&&b.status==='confirmed').length,holds:snap.holds.filter(h=>h.date===d).length,blocked:snap.blocked.includes(d)};
   const offset=p.cursor?Number(p.cursor):0;if(!Number.isInteger(offset)||offset<0||offset>10000)throw new AgendaError('Página inválida.');
   const bookings=snap.bookings.filter(b=>b.date===day);
   return {today,now:now.toISOString(),startDate:day,adminMaxDate:addDays(today,365),publicUrl:siteURL('agenda.html'),settings:snap.settings,weekly:snap.weekly,slots:list,holds:snap.holds,calendar:{month,days},bookings:await Promise.all(bookings.slice(offset,offset+50).map(display)),cursor:bookings.length>offset+50?String(offset+50):null,google:await google.status(),emailConfigured:emailConfigured(),canConfigureGoogle:actor.admin};
  }
  const snap=await snapshot(today,addDays(today,90));let sqlAction='',data=p,revision=p.revision;
  switch(action){
   case 'saveAgendaSettings':sqlAction='saveSettings';data=settings(p,snap.settings,(await google.status()).connected);break;
   case 'saveWeeklyAgenda':sqlAction='saveWeekly';if(!uuid(p.weeklyRevision))throw new AgendaError('Atualize a rotina semanal.');data={...weekly(p,snap.settings.duration),weeklyRevision:p.weeklyRevision};break;
   case 'addAgendaExtra':sqlAction='addExtra';data=extra(p,snap.settings.duration,today);break;
   case 'removeAgendaSlot':sqlAction='removeExtra';revision=null;if(!uuid(p.id)||!uuid(p.revision))throw new AgendaError('Horário inválido.');break;
   case 'setAgendaDayState':sqlAction='blockDay';if(!validDate(p.date)||p.date<today||p.date>addDays(today,365)||typeof p.blocked!=='boolean')throw new AgendaError('Data inválida.');break;
   case 'reserveAgendaInterval':sqlAction='hold';if(!uuid(p.id)||!validDate(p.date)||p.date<today||p.date>addDays(today,365)||minutes(p.until)<=minutes(p.from))throw new AgendaError('Confira a reserva interna.');data={id:p.id,date:p.date,start_at:instant(p.date,p.from),end_at:instant(p.date,p.until),reason:clean(p.reason||'',0,200,'o motivo')};break;
   case 'releaseAgendaInterval':sqlAction='releaseHold';revision=null;if(!uuid(p.id)||!uuid(p.holdRevision))throw new AgendaError('Reserva inválida.');break;
   case 'changeAgendaBooking':sqlAction='bookingStatus';revision=null;if(!uuid(p.id)||!['canceled','completed'].includes(p.status))throw new AgendaError('Agendamento inválido.');break;
   default:throw new AgendaError('Ação não disponível.','NOT_FOUND',404);
  }
  if(revision!==null&&!uuid(revision))throw new AgendaError('Atualize a agenda antes de salvar.');
  const result=await rpc('agenda_mutate',{p_actor:actor.id,p_revision:revision,p_action:sqlAction,p_data:data});
  if(action==='changeAgendaBooking')background();return result;
 }
 return {handle,queue,google,rpc,async fetch(req){
  const origin=req.headers.get('origin'),allowed=env.SITE_URL?new URL(env.SITE_URL).origin:null;
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':allowed||'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type,x-agenda-key','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
  const answer=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&allowed&&origin!==allowed)return answer({error:{code:'UNAUTHORIZED',message:'Origem não autorizada.'}},403);
  if(req.method==='OPTIONS')return new Response('ok',{headers});if(req.method!=='POST')return answer({error:{code:'NOT_FOUND',message:'Método não permitido.'}},405);
  try{
   const raw=await req.text();if(raw.length>40000)throw new AgendaError('Dados acima do limite.');let input;try{input=JSON.parse(raw);}catch{throw new AgendaError('Dados inválidos.');}
   if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.action!=='string'||!input.payload||typeof input.payload!=='object'||Array.isArray(input.payload))throw new AgendaError('Dados inválidos.');
   if(publics.has(input.action)){
    const key=await hash((req.headers.get('x-forwarded-for')||'desconhecido').split(',')[0]+env.RATE_SALT+input.action);
    await rpc('agenda_rate',{p_key:key,p_window:input.action==='agendaBook'?900:60,p_max:input.action==='agendaBook'?10:90});
   }
   return answer({data:await handle(input.action,input.payload,req)});
  }catch(e){const known=e instanceof AgendaError;return answer({error:{code:known?e.code:'UNAVAILABLE',message:known?e.message:'Não foi possível concluir a operação agora. Verifique a mesma tentativa antes de reenviar.'}},known?e.status:503);}
 }};
}
