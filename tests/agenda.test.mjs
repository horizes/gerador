import {test} from 'node:test';import assert from 'node:assert/strict';import {fixture,ADMIN,MANAGER} from './agenda-fixture.mjs';
import {slots,weekly,instant,validDate,AgendaError,addDays,dateOnly} from '../supabase/functions/agenda/core.ts';
import {hash,seal,unseal} from '../supabase/functions/agenda/google.ts';import {mailContent,calendarFile,smtpOptions,smtpSender} from '../supabase/functions/agenda/mail.ts';
test('datas e horários usam Brasília, validam o calendário e respeitam faixas',()=>{
 assert.equal(instant('2026-10-14','09:00'),'2026-10-14T12:00:00.000Z');assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2026-13-01'),false);
 assert.throws(()=>weekly({gap:0,modes:['online'],days:Array.from({length:7},(_,day)=>({day,enabled:true,ranges:[{from:'10:00',until:'09:00'}]}))},30),AgendaError);
});
test('contatos e credenciais são cifrados e a alteração do conteúdo é rejeitada',async()=>{
 const key=Buffer.alloc(32,1).toString('base64'),cipher=await seal({email:'ana@example.test',secret:'private'},key);assert.ok(!cipher.includes('private'));assert.equal((await unseal(cipher,key)).email,'ana@example.test');await assert.rejects(()=>unseal(cipher,Buffer.alloc(32,2).toString('base64')));
});
test('e-mail mantém a identidade Imperium, escapa conteúdo e anexa calendário UTC',()=>{
 const b={id:'id',protocol:'IMP-TEST',host_name:'Equipe Imperium',start_at:'2026-10-14T12:00:00Z',end_at:'2026-10-14T12:30:00Z',duration:30,mode:'online',subject:'Proposta',online_link:'https://meet.google.com/abc-defg-hij',google:{status:'ready'}};
 const c={name:'<img src=x>',email:'ana@example.test',address:''},mail=mailContent(b,c);assert.match(mail.html,/#d4b66e/);assert.match(mail.html,/&lt;img/);assert.doesNotMatch(mail.html,/<img src=x>/);assert.match(calendarFile(b,c),/DTSTART:20261014T120000Z/);assert.match(calendarFile(b,c),/UID:id@imperium-agenda/);
 assert.equal(smtpOptions({SMTP_HOST:'host',SMTP_USER:'u',SMTP_PASS:'p',SMTP_FROM:'a@example.test'}).port,465);assert.throws(()=>smtpOptions({SMTP_HOST:'host',SMTP_USER:'u',SMTP_PASS:'p',SMTP_FROM:'a@example.test',SMTP_PORT:587}),AgendaError);
});
test('SMTP incerto pede conferência e não afirma envio aceito',async()=>{
 const sender=smtpSender({createTransport(){return {sendMail:async()=>{throw {code:'ETIMEDOUT',command:'DATA'};},close(){}};}},{SMTP_HOST:'host',SMTP_USER:'u',SMTP_PASS:'p',SMTP_FROM:'a@example.test'});
 await assert.rejects(()=>sender({id:'i'}, {email:'a@example.test'}, {id:'j',kind:'email'}),e=>e.code==='EMAIL_REVIEW');
});
test('agenda começa pausada, não revela contatos e respeita acesso por cargo',async()=>{
 const f=await fixture();try{assert.equal((await f.api('agendaInfo',{},null)).data.enabled,false);assert.equal((await f.api('adminAgenda',{},null)).status,401);assert.equal((await f.api('adminAgenda',{},'usuario')).status,403);assert.equal((await f.api('adminAgenda',{},'gestor')).status,200);assert.equal((await f.api('adminGoogleStart',{},'gestor')).status,403);
 await f.pg.query('update auth.users set encrypted_password=\'\' where id=$1',[MANAGER]);assert.equal((await f.api('adminAgenda',{},'gestor')).status,403);
 }finally{await f.close();}
});
test('rotina continua no futuro sem republicação e revisões antigas não sobrescrevem alterações',async()=>{
 const f=await fixture();try{await f.configured();const admin=(await f.api('adminAgenda')).data;
 const future=addDays(dateOnly(new Date()),180),snap=(await f.db.rpc('agenda_snapshot',{p_from:future,p_until:addDays(future,2)})).data;assert.ok(slots(snap,future,addDays(future,2)).length>0);
 assert.equal((await f.api('saveAgendaSettings',{...admin.settings,hostName:'Nova equipe'})).status,200);assert.equal((await f.api('saveAgendaSettings',{...admin.settings,hostName:'Rascunho antigo'})).status,409);
 }finally{await f.close();}
});
test('dois formatos disputam o mesmo intervalo; repetição recupera a reserva original',async()=>{
 const f=await fixture();try{await f.configured();const payload=await f.bookPayload(),other={...payload,attempt:crypto.randomUUID(),proof:crypto.randomUUID(),mode:'presencial',email:'outra@example.test'};const [a,b]=await Promise.all([f.api('agendaBook',payload,null),f.api('agendaBook',other,null)]);assert.equal([a.status,b.status].sort().join(','),'200,409');
 const ok=a.status===200?a:b,winner=a.status===200?payload:other,repeat=await f.api('agendaBook',winner,null);assert.equal(repeat.status,200);assert.equal(repeat.data.id,ok.data.id);assert.equal((await f.pg.query('select count(*)::int as n from agenda_bookings')).rows[0].n,1);
 const recovered=await f.api('agendaRecover',{attempt:winner.attempt,proof:winner.proof},null);assert.equal(recovered.data.exists,true);assert.equal(recovered.data.booking.protocol,ok.data.protocol);
 assert.equal((await f.api('agendaRecover',{attempt:winner.attempt,proof:crypto.randomUUID()},null)).data.exists,false);
 assert.equal((await f.api('agendaBook',{...winner,name:'Nome diferente'},null)).status,409);
 const info=(await f.api('agendaInfo',{},null)).data;assert.ok(!info.slots.some(s=>s.id===payload.slotId));assert.ok(!JSON.stringify(info).includes('ana@example.test'));
 }finally{await f.close();}
});
test('bloqueio preserva reuniões; cancelar libera apenas quando o dia estiver aberto',async()=>{
 const f=await fixture();try{await f.configured();const p=await f.bookPayload(),b=(await f.api('agendaBook',p,null)).data;let admin=(await f.api('adminAgenda')).data;
 assert.equal((await f.api('setAgendaDayState',{revision:admin.settings.revision,date:b.date,blocked:true})).status,200);assert.equal((await f.api('changeAgendaBooking',{id:b.id,status:'canceled'})).status,200);assert.equal((await f.api('agendaInfo',{},null)).data.slots.some(s=>s.id===p.slotId),false);
 admin=(await f.api('adminAgenda')).data;await f.api('setAgendaDayState',{revision:admin.settings.revision,date:b.date,blocked:false});assert.equal((await f.api('agendaInfo',{},null)).data.slots.some(s=>s.id===p.slotId),true);
 }finally{await f.close();}
});
test('reserva interna bloqueia sobreposição; extras substituem apenas horários livres',async()=>{
 const f=await fixture();try{await f.configured();let admin=(await f.api('adminAgenda')).data;const date=addDays(dateOnly(new Date()),2);
 await f.api('reserveAgendaInterval',{id:crypto.randomUUID(),revision:admin.settings.revision,date,from:'09:00',until:'10:00',reason:'Equipe'});assert.equal((await f.api('agendaInfo',{},null)).data.slots.some(s=>s.date===date&&s.time==='09:00'),false);
 admin=(await f.api('adminAgenda')).data;assert.equal((await f.api('addAgendaExtra',{revision:admin.settings.revision,date,from:'09:00',until:'10:00',gap:0,modes:['online']})).status,409);
 assert.equal((await f.api('addAgendaExtra',{revision:admin.settings.revision,date,from:'11:00',until:'12:00',gap:0,modes:['online']})).data.added,2);
 const all=(await f.api('agendaInfo',{},null)).data.slots.filter(s=>s.date===date&&s.time==='11:00');assert.equal(all.length,1);assert.match(all[0].id,/^e:/);
 }finally{await f.close();}
});
test('horários antigos mantêm duração e detalhes quando configurações mudam',async()=>{
 const f=await fixture();try{await f.configured();const p=await f.bookPayload(),b=(await f.api('agendaBook',p,null)).data,admin=(await f.api('adminAgenda')).data;
 await f.api('saveAgendaSettings',{...admin.settings,duration:60,hostName:'Outro responsável'});const got=(await f.api('agendaRecover',{attempt:p.attempt,proof:p.proof},null)).data.booking;assert.equal(got.duration,30);assert.equal(got.hostName,b.hostName);
 assert.equal((await f.api('changeAgendaBooking',{id:b.id,status:'completed'})).status,409);
 }finally{await f.close();}
});
test('visitantes não leem tabelas, contatos nem funções internas com a chave pública',async()=>{
 const f=await fixture();try{await f.pg.exec('set role anon');await assert.rejects(()=>f.pg.query('select * from agenda_bookings'));await assert.rejects(()=>f.pg.query('select agenda_snapshot(current_date,current_date)'));await f.pg.exec('reset role');await f.pg.exec('set role authenticated');await assert.rejects(()=>f.pg.query('select * from agenda_google_connections'));await f.pg.exec('reset role');}finally{await f.close();}
});
test('OAuth exige estado, navegador e admin ativo; não devolve credenciais ao cliente',async()=>{
 const f=await fixture();try{
 await f.api('adminGoogleConfigure',{web:{client_id:'test.apps.googleusercontent.com',client_secret:'test-secret',redirect_uris:['https://imperium.test/agenda-google-callback.html']}});
 const start=(await f.api('adminGoogleStart')).data,url=new URL(start.url);assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(!JSON.stringify(start).includes('test-secret'));
 assert.equal((await f.api('googleCallback',{state:url.searchParams.get('state'),browserSecret:'wrong-browser',code:'code'},null)).status,401);
 assert.equal((await f.api('googleCallback',{state:url.searchParams.get('state'),browserSecret:start.browserSecret,code:'code'},null)).status,200);
 assert.equal((await f.api('googleCallback',{state:url.searchParams.get('state'),browserSecret:start.browserSecret,code:'code'},null)).status,401);
 assert.ok(!JSON.stringify((await f.api('adminAgenda')).data).includes('test-refresh'));
 }finally{await f.close();}
});
test('Google cria um único evento e Meet, atualiza link e cancela o evento correspondente',async()=>{
 const f=await fixture();try{await f.configured();assert.equal((await f.connect()).status,200);const p=await f.bookPayload(),b=(await f.api('agendaBook',p,null)).data;await f.flush();assert.equal(f.events.size,1);
 let recovered=(await f.api('agendaRecover',{attempt:p.attempt,proof:p.proof},null)).data.booking;assert.equal(recovered.meetingStatus,'ready');assert.equal(recovered.onlineLink,'https://meet.google.com/abc-defg-hij');
 await f.api('agendaBook',p,null);await f.flush();assert.equal(f.events.size,1);
 await f.api('changeAgendaBooking',{id:b.id,status:'canceled'});await f.flush();assert.equal(f.events.size,0);recovered=(await f.api('agendaRecover',{attempt:p.attempt,proof:p.proof},null)).data.booking;assert.equal(recovered.status,'canceled');assert.equal(recovered.onlineLink,'');
 }finally{await f.close();}
});
test('reconectar a mesma conta recupera autorizações de reuniões anteriores',async()=>{
 const f=await fixture();try{
  await f.configured();await f.connect();const payload=await f.bookPayload(),booking=(await f.api('agendaBook',payload,null)).data;await f.flush();
  const row=(await f.pg.query('select google from agenda_bookings where id=$1',[booking.id])).rows[0],oldId=row.google.connectionId;
  await f.pg.query('update agenda_google_connections set authorization_required=true where id=$1',[oldId]);
  await f.api('changeAgendaBooking',{id:booking.id,status:'canceled'});await f.flush();assert.equal(f.events.size,1);
  await f.connect();assert.equal((await f.pg.query('select authorization_required from agenda_google_connections where id=$1',[oldId])).rows[0].authorization_required,false);
  assert.equal((await f.api('adminGoogleRetry',{id:booking.id})).status,200);await f.flush();assert.equal(f.events.size,0);
  const recovered=(await f.api('agendaRecover',{attempt:payload.attempt,proof:payload.proof},null)).data.booking;assert.equal(recovered.status,'canceled');assert.equal(recovered.meetingStatus,'canceled');
 }finally{await f.close();}
});
test('falha Google não perde reserva; uma verificação recupera sem duplicar evento',async()=>{
 const f=await fixture();try{await f.configured();await f.connect();f.setGoogleFailure(true);const p=await f.bookPayload(),b=(await f.api('agendaBook',p,null)).data;await f.flush();assert.equal((await f.api('agendaRecover',{attempt:p.attempt,proof:p.proof},null)).data.booking.status,'confirmed');
 f.setGoogleFailure(false);await f.api('adminGoogleRetry',{id:b.id});assert.equal(f.events.size,1);assert.equal((await f.api('agendaRecover',{attempt:p.attempt,proof:p.proof},null)).data.booking.meetingStatus,'ready');
 }finally{await f.close();}
});
test('e-mail SMTP é enviado uma vez e uma resposta perdida não gera outra confirmação',async()=>{
 const f=await fixture({smtp:true});try{await f.configured();const p=await f.bookPayload();await f.api('agendaBook',p,null);await f.flush();assert.equal(f.sent.length,1);await f.api('agendaBook',p,null);await f.flush();assert.equal(f.sent.length,1);assert.equal((await f.api('agendaRecover',{attempt:p.attempt,proof:p.proof},null)).data.booking.emailStatus,'accepted');
 }finally{await f.close();}
});
test('e-mail com resultado incerto fica em conferência, sem reenvio automático',async()=>{
 const f=await fixture({smtp:true});try{await f.configured();f.setSMTPFailure(new AgendaError('Incerto','EMAIL_REVIEW',503));const p=await f.bookPayload();await f.api('agendaBook',p,null);await f.flush();assert.equal((await f.api('agendaRecover',{attempt:p.attempt,proof:p.proof},null)).data.booking.emailStatus,'review');assert.equal((await f.pg.query("select status from agenda_jobs where kind='email'")).rows[0].status,'failed');
 }finally{await f.close();}
});
test('chave do processador é obrigatória e origem externa não pode chamar a agenda',async()=>{
 const f=await fixture();try{assert.equal((await f.api('processQueue')).status,401);const r=await f.service.fetch(new Request('https://imperium.test/functions/agenda',{method:'POST',headers:{Origin:'https://other.test'},body:JSON.stringify({action:'agendaInfo',payload:{}})}));assert.equal(r.status,403);}finally{await f.close();}
});
test('se o Meet estiver pronto, a confirmação SMTP já o inclui sem mandar e-mail duplicado',async()=>{
 const f=await fixture({smtp:true});try{await f.configured();await f.connect();const p=await f.bookPayload();await f.api('agendaBook',p,null);await f.flush();assert.equal(f.sent.length,1);assert.equal(f.sent[0].hadLink,true);const b=(await f.api('agendaRecover',{attempt:p.attempt,proof:p.proof},null)).data.booking;assert.equal(b.emailMeetStatus,'not_needed');}finally{await f.close();}
});
test('se o Meet chegar depois do e-mail, apenas o link adicional é enviado',async()=>{
 const f=await fixture({smtp:true});try{await f.configured();await f.connect();const original=f.service.google.transport;let release,started;const gate=new Promise(r=>release=r),began=new Promise(r=>started=r);
 f.service.google.transport=async(url,options)=>{const result=await original(url,options);if(options.method==='POST'&&url.includes('/events?')){started();await gate;}return result;};
 const p=await f.bookPayload();await f.api('agendaBook',p,null);await began;await f.service.queue(1);assert.equal(f.sent.length,1);assert.equal(f.sent[0].hadLink,false);release();await f.flush();assert.equal(f.sent.length,2);assert.equal(f.sent[1].kind,'email_meet');assert.equal(f.sent[1].hadLink,true);
 }finally{await f.close();}
});
test('cancelar durante a criação Google não ressuscita a reunião nem mantém o evento',async()=>{
 const f=await fixture();try{await f.configured();await f.connect();const original=f.service.google.transport;let release,started;const gate=new Promise(r=>release=r),began=new Promise(r=>started=r);
 f.service.google.transport=async(url,options)=>{const result=await original(url,options);if(options.method==='POST'&&url.includes('/events?')){started();await gate;}return result;};
 const p=await f.bookPayload(),b=(await f.api('agendaBook',p,null)).data;await began;await f.api('changeAgendaBooking',{id:b.id,status:'canceled'});release();await f.flush();await f.service.queue();assert.equal(f.events.size,0);assert.equal((await f.api('agendaRecover',{attempt:p.attempt,proof:p.proof},null)).data.booking.meetingStatus,'canceled');
 }finally{await f.close();}
});
test('trabalho SMTP interrompido fica em conferência após expirar, sem envio automático',async()=>{
 const f=await fixture({smtp:true});try{await f.configured();const p=await f.bookPayload(),b=(await f.api('agendaBook',p,null)).data;await f.flush();const n=f.sent.length;
 await f.pg.query("insert into agenda_jobs(booking_id,kind,attempts,lease_until) values($1,'email',1,clock_timestamp()-interval '1 second')",[b.id]);await f.service.queue();assert.equal(f.sent.length,n);assert.equal((await f.api('agendaRecover',{attempt:p.attempt,proof:p.proof},null)).data.booking.emailStatus,'review');
 }finally{await f.close();}
});
