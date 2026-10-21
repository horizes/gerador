(function(){
  'use strict';
  const $=id=>document.getElementById(id),calendarId=new URLSearchParams(location.search).get('agenda'),API={call:(action,payload={})=>window.ImperiumAgendaAPI.call(action,{...payload,...(calendarId!==null?{calendarId}:{})})},form=$('agenda-form'),key='imperium-agenda-attempt-v1'+(calendarId!==null?':'+calendarId:'');
  let info=null,mode='online',selectedDate='',selectedId='',datePage=0,booking=null,pending=null,busy=false,meetTimer=null,meetChecking=false;
  const longDate=value=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'full',timeZone:'America/Sao_Paulo'}).format(new Date(value+'T12:00:00-03:00'));
  function notice(message){$('agenda-notice').textContent=message;$('agenda-notice').hidden=!message;}
  function saveAttempt(value){pending=value;try{if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{}}
  function readAttempt(){try{const value=JSON.parse(sessionStorage.getItem(key)||'null');return value&&typeof value.attempt==='string'&&typeof value.proof==='string'?value:null;}catch{return null;}}
  function setBusy(value){busy=value;$('agenda-inputs').disabled=value||!!pending?.payload;$('agenda-confirm').disabled=value||!!pending?.payload||!selectedId;$('agenda-retry').disabled=value;}
  function filtered(){return(info?.slots||[]).filter(slot=>slot.modes.includes(mode));}
  function dates(){return [...new Set(filtered().map(slot=>slot.date))];}
  function chooseDate(value){selectedDate=value;selectedId='';render();}
  function render(){
    const available=filtered(),allDates=dates();
    for(const radio of form.querySelectorAll('input[name=mode]')){radio.disabled=!info.slots.some(slot=>slot.modes.includes(radio.value));radio.checked=radio.value===mode;}
    form.elements.address.required=mode==='presencial';$('agenda-address-optional').textContent=mode==='presencial'?'(para a reunião presencial)':'(opcional para reunião online)';
    if(!allDates.includes(selectedDate)){selectedDate=allDates[0]||'';selectedId='';datePage=0;}
    if(!available.some(slot=>slot.id===selectedId&&slot.date===selectedDate))selectedId='';
    datePage=Math.max(0,Math.min(datePage,Math.max(0,Math.ceil(allDates.length/3)-1)));
    $('agenda-dates').replaceChildren();
    for(const date of allDates.slice(datePage*3,datePage*3+3)){
      const value=new Date(date+'T12:00:00-03:00'),button=document.createElement('button');button.type='button';button.className='agenda-date-chip';button.setAttribute('aria-pressed',String(date===selectedDate));button.setAttribute('aria-label',longDate(date));
      for(const [tag,text] of [['strong',date.slice(8)],['span',new Intl.DateTimeFormat('pt-BR',{month:'short',timeZone:'America/Sao_Paulo'}).format(value).replace('.','')],['small',new Intl.DateTimeFormat('pt-BR',{weekday:'short',timeZone:'America/Sao_Paulo'}).format(value)]]){const el=document.createElement(tag);el.textContent=text;button.append(el);}
      button.addEventListener('click',()=>chooseDate(date));$('agenda-dates').append(button);
    }
    $('agenda-dates-prev').disabled=datePage===0;$('agenda-dates-next').disabled=(datePage+1)*3>=allDates.length;
    $('agenda-hours').replaceChildren();
    for(const slot of available.filter(slot=>slot.date===selectedDate)){const button=document.createElement('button');button.type='button';button.className='agenda-hour-chip';button.textContent=slot.time;button.setAttribute('aria-label',`${slot.time}, ${slot.duration} minutos`);button.setAttribute('aria-pressed',String(slot.id===selectedId));button.addEventListener('click',()=>{selectedId=slot.id;render();$('agenda-hours').querySelector('[aria-pressed=true]')?.focus();});$('agenda-hours').append(button);}
    if(!available.length){const p=document.createElement('p');p.className='agenda-hint';p.textContent='Não há horários livres para este formato. Escolha outro formato ou fale com a equipe.';$('agenda-hours').append(p);}
    const selected=available.find(slot=>slot.id===selectedId);$('agenda-selection').textContent=selected?`${mode==='online'?'Reunião online':'Reunião presencial'} · ${selected.duration} minutos · ${selected.time} (Brasília)`:'Selecione uma data e um horário.';
    setBusy(busy);
  }
  async function load(){
    info=await API.call('agendaInfo');$('agenda-host-name').textContent=info.hostName;$('agenda-profile-public').textContent='Seu atendimento com '+info.hostName;
    const previousSubject=form.elements.subject.value;$('agenda-subject').replaceChildren();for(const [value,label] of Object.entries(info.subjects)){const option=document.createElement('option');option.value=value;option.textContent=label;$('agenda-subject').append(option);}if(Object.hasOwn(info.subjects,previousSubject))form.elements.subject.value=previousSubject;
    if(!info.enabled||!info.slots.length){form.hidden=true;notice(info.enabled?'Os próximos horários serão disponibilizados em breve. Fale com a equipe para combinar sua reunião.':'Nossa agenda está fechada no momento. Fale com a equipe para combinar sua reunião.');return;}
    if(!info.slots.some(slot=>slot.modes.includes(mode)))mode=info.slots[0].modes[0];form.hidden=false;notice('');render();
  }
  function detail(label,value){const item=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;item.append(dt,dd);$('agenda-confirmation-details').append(item);}
  function confirm(result){
    const first=$('agenda-confirmation').hidden;clearTimeout(meetTimer);booking=result;form.hidden=true;notice('');$('agenda-confirmation').hidden=false;$('agenda-protocol').textContent='Protocolo: '+result.protocol;
    const canceled=result.status==='canceled',completed=result.status==='completed';$('agenda-confirmation-eyebrow').textContent=canceled?'AGENDAMENTO CANCELADO':completed?'REUNIÃO CONCLUÍDA':'AGENDAMENTO CONFIRMADO';$('agenda-confirmation-title').textContent=canceled?'Este agendamento foi cancelado':completed?'Obrigado pela conversa!':'Nos vemos em breve!';
    $('agenda-confirmation-details').replaceChildren();detail('Data',longDate(result.date));detail('Horário',`${result.time} · horário de Brasília`);detail('Formato',result.mode==='online'?'Online':'Presencial');detail('Duração',`${result.duration} minutos`);detail('Assunto',result.subject);detail('Com quem',result.hostName);if(result.mode==='presencial')detail('Local',result.location);
    $('agenda-access-note').textContent=canceled?'Você pode escolher outro horário para uma nova reunião.':completed?'A equipe registrou a conclusão da sua reunião.':result.mode==='online'?(result.onlineLink?'O acesso à sua reunião está disponível no botão abaixo.':result.meetingStatus==='pending'?'Seu horário está confirmado. O Google está preparando o link do Meet.':['failed','authorization_required'].includes(result.meetingStatus)?'Seu horário está confirmado. A equipe precisa conferir a criação do Meet; use o protocolo para falar com ela.':'A equipe combinará o acesso à reunião pelo contato informado.'):'Sua reunião será realizada no endereço indicado acima.';
    const emailNote=$('agenda-email-note');emailNote.hidden=canceled||completed||!result.emailStatus||result.emailStatus==='not_requested';const emailMessages={pending:'A confirmação será enviada para o e-mail informado. Confira também a pasta de spam.',sending:'A confirmação por e-mail está sendo processada.',accepted:'A confirmação por e-mail foi encaminhada. Confira sua caixa de entrada e a pasta de spam.',not_configured:'Seu horário está confirmado nesta página. Fale com a equipe para receber a confirmação por e-mail.',failed:'Seu horário está confirmado. O envio do e-mail precisa ser conferido pela equipe.',review:'Seu horário está confirmado. A equipe precisa conferir o envio do e-mail.'};emailNote.textContent=emailMessages[result.emailStatus]||'';if(result.emailStatus==='accepted'&&result.emailMeetStatus==='waiting_link')emailNote.textContent+=' O link do Meet chegará em outro e-mail assim que estiver disponível.';if(result.emailMeetStatus==='accepted')emailNote.textContent+=' O link do Meet também foi encaminhado por e-mail.';
    const link=$('agenda-meeting-link');link.hidden=true;link.removeAttribute('href');if(!canceled&&!completed&&result.mode==='online'&&/^https:\/\//i.test(result.onlineLink||'')){link.href=result.onlineLink;link.hidden=false;}
    $('agenda-calendar').hidden=canceled||completed;$('agenda-google-calendar').hidden=canceled||completed;saveAttempt({attempt:pending.attempt,proof:pending.proof});$('agenda-meet-refresh').hidden=canceled||completed||result.mode!=='online'||!['pending','failed','authorization_required'].includes(result.meetingStatus);if(first)$('agenda-confirmation').focus();if((result.meetingStatus==='pending'||['pending','sending'].includes(result.emailStatus)||['pending','sending'].includes(result.emailMeetStatus))&&!canceled&&!completed)meetTimer=setTimeout(checkMeet,20000);
  }
  async function checkMeet(){if(meetChecking||!pending||!booking)return;const attempt=pending.attempt,id=booking.id;meetChecking=true;$('agenda-meet-refresh').disabled=true;try{const result=await API.call('agendaRecover',{attempt,proof:pending.proof});if(result.exists&&pending?.attempt===attempt&&booking?.id===id)confirm(result.booking);}catch{if(booking?.id===id){$('agenda-access-note').textContent='Seu horário está confirmado. Não foi possível verificar o Meet agora; tente novamente.';clearTimeout(meetTimer);}}finally{meetChecking=false;$('agenda-meet-refresh').disabled=false;}}
  $('agenda-meet-refresh').addEventListener('click',checkMeet);
  function uncertain(error){$('agenda-error').textContent=error.message+' Use o botão abaixo para verificar a mesma tentativa.';$('agenda-retry').hidden=false;setBusy(false);}
  async function send(){
    if(busy||!pending?.payload)return;setBusy(true);$('agenda-error').textContent='';
    try{confirm(await API.call('agendaBook',pending.payload));}
    catch(error){if(['VALIDATION','CONFLICT','RATE_LIMIT','UNAUTHORIZED'].includes(error.code)){saveAttempt(null);$('agenda-retry').hidden=true;$('agenda-error').textContent=error.message;selectedId='';try{await load();}catch{notice('Não foi possível atualizar os horários. Recarregue a página antes de continuar.');form.hidden=true;}}else uncertain(error);}
    finally{setBusy(false);}
  }
  async function recover(){
    if(busy||!pending)return;setBusy(true);$('agenda-error').textContent='';notice('Verificando seu agendamento…');
    try{const result=await API.call('agendaRecover',{attempt:pending.attempt,proof:pending.proof});if(result.exists){confirm(result.booking);return;}notice('');if(pending.payload){setBusy(false);await send();}else{saveAttempt(null);await load();}}
    catch(error){notice('');if(pending.payload){form.hidden=false;uncertain(error);}else{notice('Não foi possível consultar seu agendamento. Tente novamente para verificar o protocolo.');$('agenda-retry').hidden=false;form.hidden=false;$('agenda-inputs').disabled=true;$('agenda-confirm').disabled=true;}}
    finally{setBusy(false);if(!info&&!booking){$('agenda-inputs').disabled=true;$('agenda-confirm').disabled=true;}}
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();if(busy||pending?.payload)return;if(!selectedId){$('agenda-error').textContent='Escolha um horário disponível.';return;}if(!form.reportValidity())return;
    const data=Object.fromEntries(new FormData(form));delete data.mode;delete data.consent;const attempt=crypto.randomUUID(),proof=crypto.randomUUID();saveAttempt({attempt,proof,payload:{...data,mode,slotId:selectedId,revision:info.revision,consent:true,attempt,proof}});send();
  });
  for(const radio of form.querySelectorAll('input[name=mode]'))radio.addEventListener('change',()=>{mode=radio.value;selectedDate='';selectedId='';datePage=0;render();});
  $('agenda-dates-prev').addEventListener('click',()=>{datePage--;chooseDate(dates()[datePage*3]);});$('agenda-dates-next').addEventListener('click',()=>{datePage++;chooseDate(dates()[datePage*3]);});$('agenda-retry').addEventListener('click',recover);
  $('agenda-another').addEventListener('click',async()=>{clearTimeout(meetTimer);saveAttempt(null);booking=null;selectedId='';$('agenda-confirmation').hidden=true;form.reset();$('agenda-error').textContent='';$('agenda-retry').hidden=true;notice('Buscando os próximos horários…');try{await load();}catch(error){notice(error.message);}});
  function escapeICS(value){return String(value||'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');}
  function foldICS(line){let out='',current='',size=0;for(const char of line){const len=new TextEncoder().encode(char).length;if(size+len>74){out+=current+'\r\n';current=' ';size=1;}current+=char;size+=len;}return out+current;}
  $('agenda-calendar').addEventListener('click',()=>{
    if(!booking)return;try{const stamp=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Imperium//Agenda//PT-BR','CALSCALE:GREGORIAN','BEGIN:VEVENT','UID:'+booking.id+'@imperium-agenda','DTSTAMP:'+stamp(Date.now()),'DTSTART:'+stamp(booking.startAt),'DTEND:'+stamp(booking.endAt),'SUMMARY:'+escapeICS('Conversa com '+booking.hostName),'DESCRIPTION:'+escapeICS(booking.subject+'\nProtocolo: '+booking.protocol+(booking.onlineLink?'\nAcesso: '+booking.onlineLink:'')),'LOCATION:'+escapeICS(booking.mode==='online'?(booking.onlineLink||'Online'):booking.location),'STATUS:CONFIRMED','END:VEVENT','END:VCALENDAR'];const url=URL.createObjectURL(new Blob([lines.map(foldICS).join('\r\n')+'\r\n'],{type:'text/calendar;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='Imperium-'+booking.protocol+'.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch{$('agenda-calendar-error').textContent='Não foi possível gerar o arquivo de calendário. Os detalhes da reunião estão acima.';}
  });
  $('agenda-google-calendar').addEventListener('click',()=>{if(!booking)return;const stamp=value=>new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');const u=new URL('https://calendar.google.com/calendar/render');u.search=new URLSearchParams({action:'TEMPLATE',text:'Imperium · '+booking.contact.name+' · '+booking.contact.company,dates:stamp(booking.startAt)+'/'+stamp(booking.endAt),details:'Participante: '+booking.contact.name+'\nEmpresa/condomínio: '+booking.contact.company+'\nResponsável: '+booking.hostName+'\n'+booking.subject+'\nProtocolo: '+booking.protocol+(booking.onlineLink?'\nAcesso: '+booking.onlineLink:''),location:booking.mode==='online'?(booking.onlineLink||'Online'):booking.location,ctz:'America/Sao_Paulo'}).toString();window.open(u.href,'_blank','noopener,noreferrer');});
  window.addEventListener('pagehide',()=>clearTimeout(meetTimer));
  pending=readAttempt();if(pending){if(pending.payload)for(const [name,value]of Object.entries(pending.payload)){const field=form.elements[name];if(field&&typeof value==='string')field.value=value;}recover();}else load().catch(error=>notice(error.message));
})();
