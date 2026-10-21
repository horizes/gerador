import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mailOptions,mailSender,calendarFile} from '../supabase/functions/agenda/mail.ts';
import {fixture} from './agenda-fixture.mjs';
const env={RESEND_API_KEY:'test-api-key',RESEND_FROM_EMAIL:'Imperium <agenda@example.test>'};
const b={id:'booking-id',protocol:'IMP-TEST',created_at:'2026-10-21T12:00:00Z',start_at:'2026-11-05T13:00:00Z',end_at:'2026-11-05T13:30:00Z',duration:30,mode:'online',subject:'Conversa',host_name:'Equipe Imperium',online_link:'https://meet.google.com/abc-defg-hij',google:{status:'ready'}};
const contact={name:'Ana Pereira',email:'ana@example.test',address:'Rua Imperial, 100'},job={id:'job-id',kind:'email'};
const forbiddenSMTP={createTransport(){throw Error('Não deve tentar um segundo provedor.');}};

test('e-mail usa a configuração Resend existente, sem depender de SMTP',()=>{
 assert.deepEqual(mailOptions(env),{provider:'resend',from:env.RESEND_FROM_EMAIL});assert.throws(()=>mailOptions({RESEND_API_KEY:'test'}),e=>e.code==='MAIL_CONFIG');
 assert.throws(()=>mailOptions({...env,RESEND_FROM_EMAIL:'a@example.test\nBcc: x@example.test'}),e=>e.code==='MAIL_CONFIG');
});
test('envio Resend inclui identidade, horário real, Meet e anexo estável para evitar duplicação',async()=>{
 const calls=[];const sender=mailSender(forbiddenSMTP,env,async(url,options)=>{calls.push({url,options});return Response.json({id:'mail-id'});});
 await sender(b,contact,job);await sender(b,contact,job);
 assert.equal(calls.length,2);assert.equal(calls[0].url,'https://api.resend.com/emails');assert.equal(calls[0].options.headers['Idempotency-Key'],calls[1].options.headers['Idempotency-Key']);assert.equal(calls[0].options.body,calls[1].options.body);
 const body=JSON.parse(calls[0].options.body);assert.equal(body.from,env.RESEND_FROM_EMAIL);assert.deepEqual(body.to,[contact.email]);assert.ok(body.html.includes(b.online_link));assert.ok(!body.html.includes(env.RESEND_API_KEY));
 const ics=Buffer.from(body.attachments[0].content,'base64').toString('utf8');assert.equal(ics,calendarFile(b,contact));assert.match(ics,/DTSTART:20261105T130000Z/);assert.match(ics,/DTEND:20261105T133000Z/);
});
for(const status of [401,403,422,429])test('rejeição '+status+' não afirma envio aceito nem tenta SMTP',async()=>{
 const sender=mailSender(forbiddenSMTP,env,async()=>Response.json({message:'provider rejection'},{status}));await assert.rejects(()=>sender(b,contact,job),e=>e.code==='MAIL_FAILED');
});
test('falha de rede e resposta incerta pedem conferência sem segundo envio',async()=>{
 for(const transport of [async()=>{throw Error('network')},async()=>Response.json({},{status:503}),async()=>Response.json({})]){
  const sender=mailSender(forbiddenSMTP,env,transport);await assert.rejects(()=>sender(b,contact,job),e=>e.code==='EMAIL_REVIEW');
 }
});
test('instalações que usam apenas SMTP continuam funcionando',async()=>{
 const smtp={SMTP_HOST:'smtp.example.test',SMTP_USER:'user',SMTP_PASS:'test-password',SMTP_FROM:'agenda@example.test'};let sent=0;
 const sender=mailSender({createTransport(){return {async sendMail(){sent++;return {accepted:[contact.email]}},close(){}}}},smtp,async()=>{throw Error('Não deve usar Resend.');});
 await sender(b,contact,job);assert.equal(sent,1);assert.equal(mailOptions(smtp).provider,'smtp');
});
test('Resend na fila da agenda fica configurado sem variáveis SMTP',async()=>{
 const f=await fixture();try{
  Object.assign(f.env,env);await f.configured();assert.equal((await f.api('adminAgenda')).data.emailConfigured,true);
  const booked=await f.api('agendaBook',await f.bookPayload(),null);assert.equal(booked.status,200);await f.flush();assert.equal(f.sent.length,1);
  assert.equal((await f.pg.query('select email_status from agenda_bookings where id=$1',[booked.data.id])).rows[0].email_status,'accepted');
 }finally{await f.close();}
});
