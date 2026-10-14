// Mesmo SMTP e mesmo padrão visual dos e-mails atuais da Imperium.
import {AgendaError,ZONE} from './core.ts';
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const escapeICS=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
const stamp=s=>new Date(s).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
function fold(s){let out='',line='',size=0;for(const ch of s){const n=new TextEncoder().encode(ch).length;if(size+n>74){out+=line+'\r\n';line=' ';size=1;}line+=ch;size+=n;}return out+line;}
export function calendarFile(b,contact){
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Imperium//Agenda//PT-BR','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${b.id}@imperium-agenda`,`DTSTAMP:${stamp(Date.now())}`,`DTSTART:${stamp(b.start_at)}`,`DTEND:${stamp(b.end_at)}`,
  'SUMMARY:'+escapeICS('Reunião com '+b.host_name),'DESCRIPTION:'+escapeICS(b.subject+'\nProtocolo: '+b.protocol+(b.online_link?'\nAcesso: '+b.online_link:'')),
  'LOCATION:'+escapeICS(b.mode==='online'?(b.online_link||'Online'):(b.location||contact.address||'')),'STATUS:CONFIRMED','END:VEVENT','END:VCALENDAR'];
 return lines.map(fold).join('\r\n')+'\r\n';
}
export function mailContent(b,contact,kind='email'){
 const meet=kind==='email_meet',title=meet?'Seu link do Google Meet':'Agendamento confirmado';
 const date=new Date(b.start_at).toLocaleString('pt-BR',{timeZone:ZONE,dateStyle:'long',timeStyle:'short'});
 const details=[['Protocolo',b.protocol],['Data e horário',date+' · Brasília'],['Duração',b.duration+' minutos'],['Formato',b.mode==='online'?'Online':'Presencial'],['Assunto',b.subject],['Com quem',b.host_name]];
 if(b.mode==='presencial')details.push(['Local',b.location||contact.address||'']);
 const access=b.mode==='online'?(b.online_link?'Acesse sua reunião pelo link abaixo.':b.google?.status==='pending'?'Seu horário está confirmado. O link do Meet será enviado assim que estiver disponível.':'A equipe combinará o acesso à reunião pelo contato informado.'):'Sua reunião será realizada no local indicado.';
 const html=`<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;padding:24px 12px;background:#f3f3f3;font-family:Arial,Helvetica,sans-serif;color:#242424"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;background:#fff;border-collapse:collapse"><tr><td bgcolor="#111111" style="padding:26px 28px;background:#111;border-bottom:3px solid #d4b66e;color:#d4b66e;font-size:20px;font-weight:bold;letter-spacing:3px">IMPERIUM</td></tr><tr><td style="padding:30px 28px"><h1 style="margin:0 0 18px;font-size:24px;line-height:1.3;color:#111">${title}</h1><p style="font-size:16px;line-height:1.6">Olá, ${esc(contact.name)}. ${meet?'O acesso à sua reunião está pronto.':'Recebemos o seu agendamento.'}</p><table role="presentation" width="100%" style="border-collapse:collapse">${details.map(([k,v])=>`<tr><td style="padding:8px 0;color:#555;font-size:14px;vertical-align:top;width:125px">${k}</td><td style="padding:8px 0;font-size:14px">${esc(v)}</td></tr>`).join('')}</table><p style="margin:24px 0 16px;font-size:14px;line-height:1.6;color:#555">${access}</p>${b.mode==='online'&&b.online_link?`<a href="${esc(b.online_link)}" style="display:inline-block;background:#111;color:#d4b66e;border-radius:6px;padding:14px 20px;text-decoration:none;font-weight:bold">Acessar reunião</a>`:''}<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#646464">O arquivo de calendário está anexado. Para alterar ou cancelar, fale com a equipe e informe o protocolo.</p></td></tr><tr><td style="padding:18px 28px;border-top:1px solid #ececec;color:#777;font-size:12px">Imperium · Plataforma</td></tr></table></body></html>`;
 const text=['IMPERIUM',title,'Olá, '+contact.name,...details.map(([k,v])=>k+': '+v),access,b.online_link||'','Para alterar ou cancelar, fale com a equipe e informe o protocolo.'].join('\n');
 return {subject:title+' — Imperium',html,text};
}
export function smtpOptions(env){
 const port=Number(env.SMTP_PORT||465);
 if(!env.SMTP_HOST||!env.SMTP_USER||!env.SMTP_PASS||!env.SMTP_FROM)throw new AgendaError('Configure na agenda o mesmo SMTP e remetente usados pelo sistema.','MAIL_CONFIG',503);
 if([25,587].includes(port)||!Number.isInteger(port)||port<1||port>65535)throw new AgendaError('Use a porta TLS 465 do seu SMTP. As portas 25 e 587 são bloqueadas nas Edge Functions.','MAIL_CONFIG',503);
 return {host:env.SMTP_HOST,port,secure:port===465,requireTLS:true,auth:{user:env.SMTP_USER,pass:env.SMTP_PASS},connectionTimeout:15000,greetingTimeout:10000,socketTimeout:20000,logger:false,debug:false};
}
export function smtpSender(nodemailer,env){
 return async(b,contact,job)=>{
  const transport=nodemailer.createTransport(smtpOptions(env));
  try{
   const content=mailContent(b,contact,job.kind);
   const result=await transport.sendMail({from:{name:'Imperium',address:env.SMTP_FROM},to:contact.email,messageId:`<agenda-${b.id}-${job.id}@${env.SMTP_FROM.split('@')[1]}>`,...content,
    attachments:[{filename:'Imperium-'+b.protocol+'.ics',content:calendarFile(b,contact),contentType:'text/calendar; charset=utf-8'}]});
   if(!result.accepted?.includes(contact.email))throw new AgendaError('O SMTP não aceitou o destinatário.','MAIL_FAILED',503);
  }catch(e){
   if(e instanceof AgendaError)throw e;
   const safe=e.code==='EAUTH'||e.code==='EDNS'||e.code==='ECONNREFUSED'||e.command==='CONN'||(e.responseCode>=500&&e.responseCode<600);
   throw new AgendaError(safe?'Não foi possível encaminhar a confirmação. Confira o SMTP.':'O resultado do envio precisa ser conferido antes de reenviar.',safe?'MAIL_FAILED':'EMAIL_REVIEW',503);
  }finally{transport.close();}
 };
}
