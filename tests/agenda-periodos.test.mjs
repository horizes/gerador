import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from './agenda-fixture.mjs';
import {occupation,instant,addDays,dateOnly} from '../supabase/functions/agenda/core.ts';
import {calendarFile} from '../supabase/functions/agenda/mail.ts';

const tomorrow=()=>addDays(dateOnly(new Date()),2);
async function payloadAt(f,time,change={}){
 const payload=await f.bookPayload(change),info=(await f.api('agendaInfo',{calendarId:change.calendarId},null)).data;
 const slot=info.slots.find(s=>s.date===tomorrow()&&s.time===time);
 assert.ok(slot,'Horário disponível para o teste: '+time);
 return {...payload,slotId:slot.id};
}
async function publicDay(f,calendarId){return (await f.api('agendaInfo',{calendarId},null)).data.slots.filter(s=>s.date===tomorrow());}

test('ocupação presencial usa meio-dia de Brasília e preserva o término real ao cruzar o período',()=>{
 const row={startAt:instant('2026-11-05','10:00'),endAt:instant('2026-11-05','10:30')};
 assert.deepEqual(occupation(row,'online'),row);
 assert.deepEqual(occupation(row,'presencial'),{startAt:instant('2026-11-05','00:00'),endAt:instant('2026-11-05','12:00')});
 const afternoon={startAt:instant('2026-11-05','12:00'),endAt:instant('2026-11-05','12:30')};
 assert.deepEqual(occupation(afternoon,'presencial'),{startAt:afternoon.startAt,endAt:instant('2026-11-06','00:00')});
 const crossing={startAt:instant('2026-11-05','11:30'),endAt:instant('2026-11-05','13:00')};
 assert.equal(occupation(crossing,'presencial').endAt,crossing.endAt);
});

test('presencial às 10h reserva a manhã; painel e convite mantêm a reunião às 10h',async()=>{
 const f=await fixture();try{
  const cid=await f.configured(),payload=await payloadAt(f,'10:00',{mode:'presencial',calendarId:cid});
  const booked=await f.api('agendaBook',payload,null);assert.equal(booked.status,200);assert.equal(booked.data.time,'10:00');assert.equal(booked.data.duration,30);
  const remaining=await publicDay(f,cid);assert.ok(remaining.length);assert.ok(remaining.every(s=>s.time>='12:00'));assert.ok(remaining.every(s=>s.modes.includes('presencial')));
  const admin=(await f.api('adminAgenda',{calendarId:cid,startDate:tomorrow()})).data;
  assert.equal(admin.bookings.length,1);assert.equal(admin.bookings[0].time,'10:00');
  const early=admin.slots.find(s=>s.date===tomorrow()&&s.time==='09:00'),actual=admin.slots.find(s=>s.date===tomorrow()&&s.time==='10:00');
  assert.equal(early.periodReserved,true);assert.equal(early.bookingId,null);assert.equal(actual.bookingId,booked.data.id);
  const row=(await f.pg.query('select * from agenda_bookings where id=$1',[booked.data.id])).rows[0];
  assert.equal(new Date(row.start_at).toISOString(),instant(tomorrow(),'10:00'));assert.equal(new Date(row.end_at).toISOString(),instant(tomorrow(),'10:30'));
  const stamp=instant(tomorrow(),'10:00').replace(/[-:]/g,'').replace(/\.\d{3}/,'');assert.ok(calendarFile(row,{name:'Ana',email:payload.email,address:payload.address}).includes('DTSTART:'+stamp));
 }finally{await f.close();}
});

test('presencial à tarde deixa a manhã livre',async()=>{
 const f=await fixture();try{
  const cid=await f.configured(),payload=await payloadAt(f,'15:00',{mode:'presencial'});assert.equal((await f.api('agendaBook',payload,null)).status,200);
  const remaining=await publicDay(f,cid);assert.ok(remaining.length);assert.ok(remaining.every(s=>s.time<'12:00'));
 }finally{await f.close();}
});

test('online ocupa só seu horário e mantém os outros online; presencial exige o período inteiro livre',async()=>{
 const f=await fixture();try{
  const cid=await f.configured(),stale=await payloadAt(f,'11:00',{mode:'presencial',email:'presencial@example.test'});
  assert.equal((await f.api('agendaBook',await payloadAt(f,'10:00'),null)).status,200);
  const remaining=await publicDay(f,cid);assert.ok(!remaining.some(s=>s.time==='10:00'));
  for(const time of ['09:00','09:30','10:30','11:00','11:30'])assert.deepEqual(remaining.find(s=>s.time===time)?.modes,['online']);
  assert.ok(remaining.find(s=>s.time==='14:00').modes.includes('presencial'));
  assert.equal((await f.api('agendaBook',stale,null)).status,409);
  assert.equal((await f.api('agendaBook',await payloadAt(f,'11:00',{email:'online2@example.test'}),null)).status,200);
 }finally{await f.close();}
});

test('o banco rejeita a reserva do período mesmo quando a API recebe uma consulta antiga',async()=>{
 const f=await fixture();try{
  const cid=await f.configured(),booked=await f.api('agendaBook',await payloadAt(f,'09:00'),null);assert.equal(booked.status,200);
  const row=(await f.pg.query('select * from agenda_bookings where id=$1',[booked.data.id])).rows[0],admin=(await f.api('adminAgenda')).data;
  const result=await f.db.rpc('agenda_profile_book',{p:{...row,calendar_id:cid,attempt:crypto.randomUUID(),revision:admin.settings.revision,mode:'presencial',time:'10:00',slot_key:'w:'+tomorrow()+':10:00',start_at:instant(tomorrow(),'10:00'),end_at:instant(tomorrow(),'10:30'),email_configured:false}});
  assert.ok(result.error);assert.match(result.error.message,/CONFLICT/);
 }finally{await f.close();}
});

for(const competingMode of ['online','presencial'])test('reservas simultâneas em horários diferentes: presencial disputa o período com '+competingMode,async()=>{
 const f=await fixture();try{
  await f.configured();const a=await payloadAt(f,'10:00',{mode:'presencial'}),b=await payloadAt(f,'09:00',{mode:competingMode,email:'outra@example.test'});
  const results=await Promise.all([f.api('agendaBook',a,null),f.api('agendaBook',b,null)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.pg.query('select count(*)::int as n from agenda_bookings')).rows[0].n,1);
 }finally{await f.close();}
});

test('reserva interna impede presencial no período, preservando horários online fora dela',async()=>{
 const f=await fixture();try{
  const cid=await f.configured(),admin=(await f.api('adminAgenda')).data;
  assert.equal((await f.api('reserveAgendaInterval',{calendarId:cid,id:crypto.randomUUID(),revision:admin.settings.revision,date:tomorrow(),from:'09:00',until:'09:30',reason:'Interno'})).status,200);
  const remaining=await publicDay(f,cid);assert.deepEqual(remaining.find(s=>s.time==='10:00').modes,['online']);assert.ok(remaining.find(s=>s.time==='14:00').modes.includes('presencial'));
 }finally{await f.close();}
});

test('cancelamento libera o período, sem bloquear a agenda de outro perfil',async()=>{
 const f=await fixture();try{
  const a=await f.configured(),b=await f.configured('admin2'),booked=await f.api('agendaBook',await payloadAt(f,'10:00',{mode:'presencial',calendarId:a}),null);assert.equal(booked.status,200);
  assert.ok((await publicDay(f,b)).find(s=>s.time==='09:00').modes.includes('presencial'));
  assert.equal((await f.api('changeAgendaBooking',{calendarId:a,id:booked.data.id,status:'canceled'})).status,200);
  assert.ok((await publicDay(f,a)).find(s=>s.time==='09:00').modes.includes('presencial'));
 }finally{await f.close();}
});

test('migração de períodos pode ser reaplicada sem alterar reservas existentes ou liberar RPC pública',async()=>{
 const f=await fixture();try{
  await f.configured();const booked=await f.api('agendaBook',await payloadAt(f,'10:00',{mode:'presencial'}),null);assert.equal(booked.status,200);
  const before=(await f.pg.query('select to_jsonb(b) as row from agenda_bookings b')).rows;
  const migration=readFileSync(new URL('../supabase-schema-agenda-periodos.sql',import.meta.url),'utf8');await f.pg.exec(migration);await f.pg.exec(migration);
  assert.deepEqual((await f.pg.query('select to_jsonb(b) as row from agenda_bookings b')).rows,before);
  await f.pg.exec('set role anon');await assert.rejects(()=>f.pg.query("select agenda_booking_occupation('online',now(),now()+interval '1 hour')"));await f.pg.exec('reset role');
 }finally{await f.close();}
});
