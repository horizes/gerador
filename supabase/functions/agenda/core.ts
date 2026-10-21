// Regras compartilhadas pela API e pelos testes. Datas sempre em Brasília.
export class AgendaError extends Error {
  code; status;
  constructor(message, code='VALIDATION', status=400){super(message);this.code=code;this.status=status;}
}
export const SUBJECTS=['Conhecer os serviços da Imperium','Portaria e controle de acesso','Limpeza e conservação','Proposta comercial','Atendimento de um contrato','Outro assunto'];
export const ZONE='America/Sao_Paulo';
const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
const instantFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function dateOnly(value){return dayFormatter.format(new Date(value));}
export function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;}
export function addDays(date,n){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function minutes(value){if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw new AgendaError('Informe um horário válido.');return Number(value.slice(0,2))*60+Number(value.slice(3));}
export function timeText(n){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
export function instant(date,time){
  if(!validDate(date))throw new AgendaError('Informe uma data válida.');minutes(time);
  const target=Date.parse(date+'T'+time+':00Z');let value=target;
  for(let i=0;i<3;i++){const p=Object.fromEntries(instantFormatter.formatToParts(new Date(value)).map(x=>[x.type,x.value]));const local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);if(local===target)return new Date(value).toISOString();value+=target-local;}
  throw new AgendaError('Esse horário não existe no fuso da agenda.');
}
export const overlap=(a,b)=>Date.parse(a.start_at||a.startAt)<Date.parse(b.end_at||b.endAt)&&Date.parse(b.start_at||b.startAt)<Date.parse(a.end_at||a.endAt);
// O período ocupado é separado do horário real da reunião.
export function occupation(row,mode=row.mode){
  const startAt=row.start_at||row.startAt,endAt=row.end_at||row.endAt;
  if(mode!=='presencial')return {startAt,endAt};
  const date=dateOnly(startAt),hour=Number(instantFormatter.formatToParts(new Date(startAt)).find(p=>p.type==='hour').value),morning=hour<12;
  return {startAt:instant(date,morning?'00:00':'12:00'),endAt:new Date(Math.max(Date.parse(endAt),Date.parse(instant(morning?date:addDays(date,1),morning?'12:00':'00:00')))).toISOString()};
}
export function modes(values){if(!Array.isArray(values)||!values.length||values.length>2||values.some(m=>!['online','presencial'].includes(m))||new Set(values).size!==values.length)throw new AgendaError('Escolha ao menos um formato válido.');return values;}
export function settings(raw,current,connected){
  const duration=Number(raw.duration),notice=Number(raw.noticeMinutes);
  if(![15,30,45,60,90].includes(duration)||![0,30,60,120,240,1440].includes(notice))throw new AgendaError('Confira a duração e a antecedência.');
  const hostName=clean(raw.hostName,2,100,'quem atende'),onlineLink=clean(raw.onlineLink||'',0,1000,'o link online'),presentialLocation=clean(raw.presentialLocation||'',0,300,'o local presencial');
  if(onlineLink){let u;try{u=new URL(onlineLink);}catch{throw new AgendaError('Use um link HTTPS para a reunião.');}if(u.protocol!=='https:'||u.username||u.password)throw new AgendaError('Use um link HTTPS para a reunião.');}
  if(raw.autoMeet&&!connected)throw new AgendaError('Conecte uma conta Google antes de ativar o Meet automático.');
  return {...current,enabled:raw.enabled===true,autoMeet:raw.autoMeet===true,duration,noticeMinutes:notice,hostName,onlineLink,presentialLocation};
}
export function weekly(raw,duration){
  if(![0,5,10,15,30].includes(Number(raw.gap))||!Array.isArray(raw.days)||raw.days.length!==7)throw new AgendaError('Confira os dias e o intervalo da rotina.');
  const days=raw.days.map(d=>({day:Number(d.day),enabled:d.enabled===true,ranges:(d.ranges||[]).map(r=>({from:r.from,until:r.until}))})).sort((a,b)=>a.day-b.day);
  let count=0;
  days.forEach((d,i)=>{
    if(d.day!==i||d.ranges.length>4)throw new AgendaError('Use os sete dias e até quatro faixas por dia.');
    const ranges=d.ranges.map(r=>({from:minutes(r.from),until:minutes(r.until)})).sort((a,b)=>a.from-b.from);
    if(d.enabled&&!ranges.length)throw new AgendaError('Defina uma faixa para cada dia ativo.');
    ranges.forEach((r,j)=>{if(r.until-r.from<duration||j&&r.from<ranges[j-1].until)throw new AgendaError('As faixas devem comportar a reunião e não podem se sobrepor.');if(d.enabled)count+=Math.floor((r.until-r.from-duration)/(duration+Number(raw.gap)))+1;});
  });
  if(count>320)throw new AgendaError('Use até 320 horários de atendimento por semana.');
  return {days,gap:Number(raw.gap),modes:modes(raw.modes)};
}
export function extra(raw,duration,today){
  if(!validDate(raw.date)||raw.date<today||raw.date>addDays(today,365))throw new AgendaError('Escolha uma data entre hoje e os próximos 365 dias.');
  const from=minutes(raw.from),until=minutes(raw.until),gap=Number(raw.gap);
  if(until-from<duration||![0,5,10,15,30].includes(gap))throw new AgendaError('Confira a faixa e o intervalo dos horários extras.');
  const result=[];for(let n=from;n+duration<=until;n+=duration+gap)result.push({id:crypto.randomUUID(),date:raw.date,time:timeText(n),duration,modes:modes(raw.modes),start_at:instant(raw.date,timeText(n)),end_at:instant(raw.date,timeText(n+duration))});
  return result;
}
export function slots(snapshot,from,until,now=new Date()){
  if(!validDate(from)||!validDate(until)||from>until||until>addDays(from,400))throw new AgendaError('Escolha um período válido.');
  const out=[],s=snapshot.settings,w=snapshot.weekly,extras=snapshot.extras||[],holds=snapshot.holds||[],bookings=(snapshot.bookings||[]).filter(b=>b.status!=='canceled'),blocked=new Set(snapshot.blocked||[]);
  const grouped=rows=>{const map=new Map();rows.forEach(r=>{const date=r.date||dateOnly(r.start_at);if(!map.has(date))map.set(date,[]);map.get(date).push(r);});return map;};
  const extrasByDay=grouped(extras),holdsByDay=grouped(holds),bookingsByDay=grouped(bookings),occupiedByDay=grouped(bookings.map(b=>({...occupation(b),date:b.date||dateOnly(b.start_at)})));
  for(let date=from;date<=until;date=addDays(date,1)){
    const day=w.days.find(d=>d.day===new Date(date+'T12:00:00Z').getUTCDay());
    if(day?.enabled)for(const range of day.ranges)for(let n=minutes(range.from);n+s.duration<=minutes(range.until);n+=s.duration+w.gap){
      const slot={id:'w:'+date+':'+timeText(n),date,time:timeText(n),duration:s.duration,modes:w.modes,startAt:instant(date,timeText(n)),endAt:instant(date,timeText(n+s.duration)),source:'weekly'};
      if(!(extrasByDay.get(date)||[]).some(e=>overlap(slot,e)))out.push(slot);
    }
  }
  extras.filter(e=>e.date>=from&&e.date<=until).forEach(e=>out.push({id:'e:'+e.id,date:e.date,time:e.time,duration:e.duration,modes:e.modes,startAt:e.start_at,endAt:e.end_at,source:'extra',revision:e.revision}));
  const limit=Date.parse(now)+s.noticeMinutes*60000;
  out.forEach(slot=>{
    const booking=(bookingsByDay.get(slot.date)||[]).find(b=>overlap(slot,b)),occupied=occupiedByDay.get(slot.date)||[],dayHolds=holdsByDay.get(slot.date)||[];
    slot.bookingId=booking?.id||null;slot.held=dayHolds.some(h=>overlap(slot,h));slot.periodReserved=!booking&&occupied.some(b=>overlap(slot,b));
    slot.availableModes=blocked.has(slot.date)||Date.parse(slot.startAt)<=limit?[]:slot.modes.filter(mode=>{const range=occupation(slot,mode);return !occupied.some(b=>overlap(range,b))&&!dayHolds.some(h=>overlap(range,h));});
    slot.available=slot.availableModes.length>0;
  });
  return out.sort((a,b)=>a.startAt.localeCompare(b.startAt)||a.id.localeCompare(b.id));
}
export function clean(value,min,max,label){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw new AgendaError('Confira '+label+'.');return value.trim();}
export function contact(raw){
  const name=clean(raw.name,2,120,'seu nome'),whatsapp=clean(raw.whatsapp,8,25,'o WhatsApp'),email=clean(raw.email,3,180,'o e-mail').toLowerCase(),company=clean(raw.company,2,180,'a empresa ou condomínio'),address=clean(raw.address||'',raw.mode==='presencial'?5:0,300,'o endereço'),notes=clean(raw.notes||'',0,500,'as observações');
  if(!/^[+\d\s().-]+$/.test(whatsapp)||!/^\d{10,15}$/.test(whatsapp.replace(/\D/g,''))||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!SUBJECTS.includes(raw.subject)||!['online','presencial'].includes(raw.mode)||raw.consent!==true||raw.website)throw new AgendaError('Confira seus dados e autorize o uso para organizar a reunião.');
  return {name,whatsapp,email,company,address,notes};
}
export function publicBooking(row,contact){
  return {id:row.id,protocol:row.protocol,date:dateOnly(row.start_at),time:String(row.time).slice(0,5),startAt:row.start_at,endAt:row.end_at,duration:row.duration,mode:row.mode,status:row.status,subject:row.subject,contact,hostName:row.host_name,location:row.location||contact.address||'',onlineLink:row.online_link||'',meetingStatus:row.google?.status||'manual',emailStatus:row.email_status||'not_configured',emailMeetStatus:row.email_meet_status||'not_requested'};
}
