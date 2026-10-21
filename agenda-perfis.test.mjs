import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture,ADMIN,ADMIN2,MANAGER} from './agenda-fixture.mjs';
import {dateOnly,addDays,instant} from '../supabase/functions/agenda/core.ts';
import {hash} from '../supabase/functions/agenda/google.ts';
const migration=()=>readFileSync(new URL('../supabase-schema-agenda-perfis.sql',import.meta.url),'utf8');

test('cada perfil tem link e horários próprios; administradores consultam e gerenciam as outras agendas',async()=>{
 const f=await fixture();try{
  const first=await f.configured(),second=await f.configured('admin2');assert.notEqual(first,second);
  const a=(await f.api('adminAgenda')).data,b=(await f.api('adminAgenda',{},'admin2')).data;
  assert.equal(a.calendarId,first);assert.equal(b.calendarId,second);assert.ok(a.publicUrl.includes(first));assert.ok(b.publicUrl.includes(second));
  assert.equal(a.calendars.length,3);assert.equal(a.canConfigureGoogle,true);
  const cross=(await f.api('adminAgenda',{calendarId:first},'admin2')).data;assert.equal(cross.calendarId,first);assert.equal(cross.canConfigureGoogle,false);
  const p=await f.bookPayload({calendarId:first}),q=await f.bookPayload({calendarId:second,email:'outra@example.test'});assert.equal(p.slotId,q.slotId);
  const booked=await Promise.all([f.api('agendaBook',p,null),f.api('agendaBook',q,null)]);assert.deepEqual(booked.map(x=>x.status),[200,200]);
  const date=addDays(dateOnly(new Date()),2),own=(await f.api('adminAgenda',{calendarId:second,startDate:date},'admin2')).data;
  assert.equal(own.bookings.length,1);assert.equal(own.bookings[0].contact.email,'outra@example.test');
  const view=(await f.api('adminAgenda',{calendarId:first,startDate:date},'admin2')).data;assert.equal(view.bookings.length,1);assert.equal(view.bookings[0].contact.email,'ana@example.test');
  assert.equal((await f.api('changeAgendaBooking',{calendarId:first,id:booked[0].data.id,status:'canceled'},'admin2')).status,200);
  assert.equal((await f.api('agendaInfo',{calendarId:second},null)).data.slots.some(s=>s.id===q.slotId),false);
  assert.equal((await f.api('agendaInfo',{calendarId:first},null)).data.slots.some(s=>s.id===p.slotId),true);
  assert.equal((await f.api('agendaInfo',{},null)).data.calendarId,first);
 }finally{await f.close();}
});

test('permissões impedem acesso a outro perfil e IDs de reservas não escapam da agenda selecionada',async()=>{
 const f=await fixture({smtp:true});try{
  const first=await f.configured(),other=await f.configured('gestor'),second=await f.configured('admin2');await f.connect();
  const manager=(await f.api('adminAgenda',{},'gestor')).data;assert.equal(manager.calendars.length,1);assert.equal(manager.calendarId,other);
  for(const action of ['adminAgenda','adminGoogleStart','adminGoogleDisconnect','saveAgendaSettings','changeAgendaBooking'])assert.equal((await f.api(action,{calendarId:first},'gestor')).status,401,action);
  const p=await f.bookPayload({calendarId:first}),booking=(await f.api('agendaBook',p,null)).data;await f.flush();
  assert.equal((await f.api('changeAgendaBooking',{calendarId:second,id:booking.id,status:'canceled'},'admin2')).status,404);
  assert.equal((await f.api('adminGoogleRetry',{calendarId:second,id:booking.id},'admin2')).status,404);
  assert.equal((await f.api('resendAgendaConfirmation',{calendarId:second,id:booking.id,attempt:crypto.randomUUID()},'admin2')).status,404);
  assert.equal((await f.api('agendaBook',{...p,calendarId:second},null)).status,409);
  assert.equal((await f.api('agendaRecover',{calendarId:second,attempt:p.attempt,proof:p.proof},null)).status,409);
  assert.equal((await f.api('agendaInfo',{calendarId:''},null)).status,400);
  assert.equal((await f.api('agendaInfo',{calendarId:crypto.randomUUID()},null)).status,404);
  assert.equal((await f.api('adminGoogleStart',{calendarId:first},'admin2')).status,403);
  const bookingRow=(await f.pg.query('select status from agenda_bookings where id=$1',[booking.id])).rows[0];assert.equal(bookingRow.status,'confirmed');
  await f.pg.exec('set role anon');await assert.rejects(()=>f.pg.query('select * from agenda_calendars'));await assert.rejects(()=>f.pg.query('select agenda_profile_context($1,null)',[ADMIN]));await f.pg.exec('reset role');
 }finally{await f.close();}
});

test('bloqueios, horários extras e reservas internas são exclusivos de cada perfil',async()=>{
 const f=await fixture();try{
  const first=await f.configured(),second=await f.configured('admin2'),date=addDays(dateOnly(new Date()),2);
  let a=(await f.api('adminAgenda')).data;
  assert.equal((await f.api('setAgendaDayState',{calendarId:first,revision:a.settings.revision,date,blocked:true})).status,200);
  assert.ok(!(await f.api('agendaInfo',{calendarId:first},null)).data.slots.some(s=>s.date===date));
  assert.ok((await f.api('agendaInfo',{calendarId:second},null)).data.slots.some(s=>s.date===date));
  const id=crypto.randomUUID();a=(await f.api('adminAgenda')).data;
  assert.equal((await f.api('reserveAgendaInterval',{calendarId:first,id,revision:a.settings.revision,date,from:'13:00',until:'14:00',reason:'Visita'})).status,200);
  const hold=(await f.pg.query('select revision from agenda_holds where id=$1',[id])).rows[0];
  await f.api('releaseAgendaInterval',{calendarId:second,id,holdRevision:hold.revision},'admin2');assert.equal((await f.pg.query('select count(*)::int as n from agenda_holds where id=$1',[id])).rows[0].n,1);
  const b=(await f.api('adminAgenda',{},'admin2')).data;
  assert.equal((await f.api('addAgendaExtra',{calendarId:second,revision:b.settings.revision,date,from:'13:00',until:'14:00',gap:0,modes:['online']},'admin2')).data.added,2);
 }finally{await f.close();}
});

test('contas Google e estados OAuth ficam no perfil; reconectar ou desconectar não altera os demais',async()=>{
 const f=await fixture();try{
  const first=await f.configured(),second=await f.configured('admin2');await f.connect();await f.connect('admin2',second);
  const connections=(await f.pg.query('select * from agenda_google_connections order by calendar_id')).rows;assert.equal(connections.length,2);
  const original=connections.find(x=>x.calendar_id===first),other=connections.find(x=>x.calendar_id===second);
  await f.pg.query('update agenda_google_connections set authorization_required=true where id=$1',[other.id]);await f.connect();
  assert.equal((await f.pg.query('select authorization_required from agenda_google_connections where id=$1',[other.id])).rows[0].authorization_required,true);
  await f.connect('admin2',second);assert.equal((await f.api('adminAgenda',{},'admin2')).data.google.connected,true);
  assert.equal((await f.api('adminGoogleDisconnect')).status,200);assert.equal((await f.api('adminAgenda',{},'admin2')).data.google.connected,true);
  assert.equal((await f.pg.query('select cipher from agenda_google_connections where id=$1',[original.id])).rows[0].cipher,'');
  const start=(await f.api('adminGoogleStart',{},'admin2')).data,url=new URL(start.url);
  const done=await f.api('googleCallback',{state:url.searchParams.get('state'),browserSecret:start.browserSecret,code:'code',calendarId:first},null);assert.equal(done.status,200);
  assert.equal((await f.api('adminAgenda')).data.google.connected,false);assert.equal((await f.api('adminAgenda',{},'admin2')).data.google.connected,true);
  const managerCalendar=await f.configured('gestor');assert.equal((await f.connect('gestor',managerCalendar)).status,200);
  const started=(await f.api('adminGoogleStart',{},'gestor')).data,u=new URL(started.url);await f.pg.query('update perfis set ativo=false where id=$1',[MANAGER]);
  assert.equal((await f.api('googleCallback',{state:u.searchParams.get('state'),browserSecret:started.browserSecret,code:'code'},null)).status,401);
 }finally{await f.close();}
});

test('eventos Google identificam pessoa e empresa; a atualização preserva o evento e o Meet',async()=>{
 const f=await fixture();try{
  await f.configured();await f.connect();const p=await f.bookPayload(),b=(await f.api('agendaBook',p,null)).data;await f.flush();
  const [event]=f.events.values();assert.ok(event.summary.includes(p.name));assert.ok(event.summary.includes(p.company));assert.ok(event.description.includes('Participante: '+p.name));assert.ok(event.description.includes('Empresa/condomínio: '+p.company));
  event.summary='Imperium · Antigo';event.description='Antigo';
  assert.equal((await f.api('adminGoogleRetry',{id:b.id})).status,200);assert.equal(f.events.size,1);assert.equal(f.events.get(event.id).id,event.id);assert.ok(f.events.get(event.id).summary.includes(p.company));
  const patches=f.logs.filter(x=>x.options.method==='PATCH');assert.equal(patches.length,1);assert.equal(new URL(patches[0].url).searchParams.get('sendUpdates'),'none');
  const other=await f.configured('admin2');await f.connect('admin2',other);const connection=(await f.api('adminAgenda',{},'admin2')).data.google.connectionId;
  await f.pg.query("update agenda_bookings set google=jsonb_set(google,'{connectionId}',to_jsonb($1::text)) where id=$2",[connection,b.id]);
  const before=f.logs.length;await f.api('adminGoogleRetry',{id:b.id});assert.equal(f.logs.length,before,'Conexão de outro perfil não pode ser usada pelo processador');
 }finally{await f.close();}
});

test('migração preserva agenda anterior, escolhe seu responsável e pode ser reaplicada sem mover novas reservas',async()=>{
 const f=await fixture({profiles:false});try{
  const date=addDays(dateOnly(new Date()),2),connection=crypto.randomUUID();
  await f.pg.query('insert into agenda_google_connections(id,email,subject,cipher,created_by) values($1,$2,$3,$4,$5)',[connection,'host@example.test','old-sub',await f.cipher({refresh:'original'}),ADMIN2]);
  await f.pg.query("update agenda_config set google_connection_id=$1,settings=settings||'{\"enabled\":true,\"noticeMinutes\":0}'::jsonb where id",[connection]);
  const c=(await f.pg.query('select * from agenda_config')).rows[0],attempt=crypto.randomUUID(),proof=crypto.randomUUID();
  const inserted=await f.db.rpc('agenda_book',{p:{attempt,proof_hash:await hash(proof),fingerprint:await hash('original'),client_hash:'client',email_hash:'email',revision:c.revision,slot_key:'w:'+date+':09:00',date,time:'09:00',start_at:instant(date,'09:00'),end_at:instant(date,'09:30'),duration:30,mode:'online',subject:'Conversa',contact_cipher:await f.cipher({name:'Antigo',company:'Empresa',email:'old@example.test'}),email_configured:true}});assert.equal(inserted.error,null);
  await f.pg.exec(migration());const legacy=(await f.db.rpc('agenda_profile_legacy_id')).data;
  const migrated=(await f.pg.query('select * from agenda_bookings')).rows[0];assert.equal(migrated.calendar_id,legacy);assert.equal(migrated.contact_cipher,inserted.data.contact_cipher);assert.equal(migrated.protocol,inserted.data.protocol);
  assert.equal((await f.api('adminAgenda',{},'admin2')).data.calendarId,legacy);assert.equal((await f.api('agendaRecover',{attempt,proof},null)).data.exists,true);
  const first=await f.configured(),p=await f.bookPayload({calendarId:first});const b=(await f.api('agendaBook',p,null)).data;await f.flush();
  await f.pg.exec(migration());await f.pg.exec(migration());assert.equal((await f.pg.query('select calendar_id from agenda_bookings where id=$1',[b.id])).rows[0].calendar_id,first);
  assert.equal((await f.pg.query('select count(*)::int n from agenda_calendars where legacy')).rows[0].n,1);assert.equal((await f.pg.query('select count(*)::int n from agenda_jobs where booking_id=$1',[migrated.id])).rows[0].n,1);
  assert.equal((await f.pg.query('select owner_id from agenda_calendars where id=$1',[legacy])).rows[0].owner_id,ADMIN2);
 }finally{await f.close();}
});

test('perfil desativado fecha o link público, preservando protocolo e acesso administrativo',async()=>{
 const f=await fixture();try{
  const first=await f.configured(),p=await f.bookPayload(),b=(await f.api('agendaBook',p,null)).data;
  await f.pg.query('update perfis set ativo=false where id=$1',[ADMIN]);assert.equal((await f.api('agendaInfo',{calendarId:first},null)).data.enabled,false);
  const newTry={...p,attempt:crypto.randomUUID(),proof:crypto.randomUUID()};assert.equal((await f.api('agendaBook',newTry,null)).status,409);
  assert.equal((await f.api('agendaRecover',{attempt:p.attempt,proof:p.proof},null)).data.booking.id,b.id);
  assert.equal((await f.api('adminAgenda',{calendarId:first},'admin2')).status,200);
 }finally{await f.close();}
});
