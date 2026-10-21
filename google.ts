import {AgendaError,ZONE} from './core.ts';
export const CALENDAR_SCOPE='https://www.googleapis.com/auth/calendar.events.owned';
const bytes=s=>new TextEncoder().encode(s);
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export const randomSecret=()=>b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function hash(s){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function seal(value,key){
 const k=unb64(key||'');if(k.length!==32)throw new AgendaError('Configure a chave de proteção da agenda no servidor.','CONFIGURATION',503);
 const imported=await crypto.subtle.importKey('raw',k,'AES-GCM',false,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
 return b64(iv)+'.'+b64(await crypto.subtle.encrypt({name:'AES-GCM',iv},imported,bytes(JSON.stringify(value))));
}
export async function unseal(cipher,key){
 const [iv,data]=cipher.split('.'),k=await crypto.subtle.importKey('raw',unb64(key||''),'AES-GCM',false,['decrypt']);
 return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},k,unb64(data))));
}
export class GoogleAgenda {
 db;env;transport;rpc;
 constructor(db,env,rpc,transport=fetch){this.db=db;this.env=env;this.rpc=rpc;this.transport=transport;}
 redirect(){const u=new URL('agenda-google-callback.html',this.env.SITE_URL.endsWith('/')?this.env.SITE_URL:this.env.SITE_URL+'/');if(u.protocol!=='https:')throw new AgendaError('Configure o endereço HTTPS da Imperium no servidor.','CONFIGURATION',503);return u.href;}
 async row(table,id=true){const r=await this.db.from(table).select('*').eq('id',id).maybeSingle();if(r.error)throw new AgendaError('Não foi possível consultar a conexão Google.','UNAVAILABLE',503);return r.data;}
 async status(calendarId=null){
  calendarId||=await this.rpc('agenda_profile_legacy_id');
  const client=await this.row('agenda_google_client'),config=await this.row('agenda_calendars',calendarId),connection=config?.google_connection_id?await this.row('agenda_google_connections',config.google_connection_id):null;
  return {configured:!!client,connected:!!(connection?.cipher&&!connection.authorization_required),email:connection?.email||null,redirectUri:this.env.SITE_URL?this.redirect():'Configure SITE_URL na função agenda',connectionId:connection?.id||null};
 }
 async configure(web,calendarId=null){
  const redirect=this.redirect();
  if(!web||typeof web.client_id!=='string'||!/^[-\w.]+\.apps\.googleusercontent\.com$/.test(web.client_id)||typeof web.client_secret!=='string'||!web.client_secret||web.client_secret.length>250||!Array.isArray(web.redirect_uris)||!web.redirect_uris.includes(redirect))throw new AgendaError('Importe a credencial Web com a URL de retorno exibida neste painel.');
  const r=await this.db.from('agenda_google_client').upsert({id:true,revision:crypto.randomUUID(),cipher:await seal({id:web.client_id,secret:web.client_secret},this.env.DATA_KEY)});if(r.error)throw new AgendaError('Não foi possível proteger a credencial Google.','UNAVAILABLE',503);
  return this.status(calendarId);
 }
 async request(method,url,headers={},body=null){
  let res;try{res=await this.transport(url,{method,headers,body,signal:AbortSignal.timeout(12000)});}catch{throw new AgendaError('O Google não respondeu. Tente verificar novamente.','GOOGLE_FAILED',503);}
  let data={};if(res.status!==204){try{data=await res.json();}catch{}}
  return {status:res.status,data};
 }
 async start(actor,calendarId){
  await this.db.from('agenda_google_oauth').delete().lt('expires_at',new Date().toISOString());
  const record=await this.row('agenda_google_client');if(!record)throw new AgendaError('Importe a credencial Google antes de conectar.');
  const client=await unseal(record.cipher,this.env.DATA_KEY),state=randomSecret(),browserSecret=randomSecret(),verifier=randomSecret()+randomSecret();
  const r=await this.db.from('agenda_google_oauth').insert({calendar_id:calendarId,state_hash:await hash(state),browser_hash:await hash(browserSecret),actor,client_revision:record.revision,verifier_cipher:await seal(verifier,this.env.DATA_KEY),expires_at:new Date(Date.now()+600000).toISOString()});
  if(r.error)throw new AgendaError('Não foi possível iniciar a conexão.','UNAVAILABLE',503);
  const challenge=b64(await crypto.subtle.digest('SHA-256',bytes(verifier))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');u.search=new URLSearchParams({client_id:client.id,redirect_uri:this.redirect(),response_type:'code',scope:'openid email '+CALENDAR_SCOPE,access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
  return {url:u.href,browserSecret};
 }
 async finish(data){
  if(typeof data.state!=='string'||data.state.length>200||typeof data.browserSecret!=='string'||data.browserSecret.length>200||typeof data.code!=='string'||data.code.length>3000)throw new AgendaError('A conexão expirou. Inicie novamente pelo painel.','UNAUTHORIZED',401);
  const pending=await this.rpc('agenda_profile_consume_oauth',{p_state:await hash(data.state),p_browser:await hash(data.browserSecret)}),record=await this.row('agenda_google_client');
  if(!record||pending.client_revision!==record.revision)throw new AgendaError('A credencial mudou. Inicie a conexão novamente.','CONFLICT',409);
  const client=await unseal(record.cipher,this.env.DATA_KEY),verifier=await unseal(pending.verifier_cipher,this.env.DATA_KEY);
  const token=await this.request('POST','https://oauth2.googleapis.com/token',{'Content-Type':'application/x-www-form-urlencoded'},new URLSearchParams({code:data.code,client_id:client.id,client_secret:client.secret,redirect_uri:this.redirect(),grant_type:'authorization_code',code_verifier:verifier}).toString());
  if(token.status!==200||typeof token.data.access_token!=='string'||typeof token.data.refresh_token!=='string'||!String(token.data.scope||'').split(' ').includes(CALENDAR_SCOPE))throw new AgendaError('Autorize a gestão dos eventos e tente conectar novamente.','GOOGLE_FAILED',400);
  const profile=await this.request('GET','https://openidconnect.googleapis.com/v1/userinfo',{Authorization:'Bearer '+token.data.access_token});
  if(profile.status!==200||typeof profile.data.sub!=='string'||typeof profile.data.email!=='string'||profile.data.email_verified!==true)throw new AgendaError('Não foi possível confirmar a conta Google.','GOOGLE_FAILED',400);
  const id=crypto.randomUUID(),connection={client,access:token.data.access_token,refresh:token.data.refresh_token,expires:Date.now()+Math.min(86400,Number(token.data.expires_in)||3600)*1000},cipher=await seal(connection,this.env.DATA_KEY);
  // Renovar a mesma conta também recupera eventos antigos ligados à sua autorização anterior.
  const renewed=await this.db.from('agenda_google_connections').update({cipher,authorization_required:false,email:profile.data.email}).eq('subject',profile.data.sub).eq('calendar_id',pending.calendar_id);
  if(renewed.error)throw new AgendaError('Não foi possível renovar a conexão anterior.','UNAVAILABLE',503);
  const r=await this.db.from('agenda_google_connections').insert({id,calendar_id:pending.calendar_id,email:profile.data.email,subject:profile.data.sub,cipher,created_by:pending.actor});
  if(r.error)throw new AgendaError('Não foi possível guardar a conexão.','UNAVAILABLE',503);
  await this.rpc('agenda_profile_connect_google',{p_actor:pending.actor,p_calendar:pending.calendar_id,p_connection:id});return {connected:true};
 }
 async access(id,force=false){
  const row=await this.row('agenda_google_connections',id);
  if(!row?.cipher||row.authorization_required)throw new AgendaError('Reconecte a conta Google.','AUTHORIZATION_REQUIRED',401);
  const c=await unseal(row.cipher,this.env.DATA_KEY);if(!force&&c.expires>Date.now()+60000)return c.access;
  const r=await this.request('POST','https://oauth2.googleapis.com/token',{'Content-Type':'application/x-www-form-urlencoded'},new URLSearchParams({grant_type:'refresh_token',refresh_token:c.refresh,client_id:c.client.id,client_secret:c.client.secret}).toString());
  if(r.status!==200||typeof r.data.access_token!=='string'){
   if(r.status===400||r.status===401){await this.db.from('agenda_google_connections').update({authorization_required:true}).eq('id',id);throw new AgendaError('Reconecte a conta Google.','AUTHORIZATION_REQUIRED',401);}
   throw new AgendaError('Não foi possível atualizar a autorização Google.','GOOGLE_FAILED',503);
  }
  c.access=r.data.access_token;c.expires=Date.now()+(Number(r.data.expires_in)||3600)*1000;if(r.data.refresh_token)c.refresh=r.data.refresh_token;
  const saved=await this.db.from('agenda_google_connections').update({cipher:await seal(c,this.env.DATA_KEY)}).eq('id',id);if(saved.error)throw new AgendaError('Não foi possível proteger a autorização.','UNAVAILABLE',503);return c.access;
 }
 async calendar(id,method,path,body=null){
  const call=async force=>this.request(method,'https://www.googleapis.com/calendar/v3/calendars/primary/events'+path,{Authorization:'Bearer '+await this.access(id,force),'Content-Type':'application/json'},body?JSON.stringify(body):null);
  let r=await call(false);if(r.status===401)r=await call(true);return r;
 }
 check(event,booking){if(event.id!==booking.google.eventId||event.extendedProperties?.private?.imperium_booking!==booking.id)throw new AgendaError('O evento encontrado não corresponde ao agendamento.','GOOGLE_FAILED',409);}
 async synchronize(booking,contact){
  const g=booking.google,path='/'+encodeURIComponent(g.eventId),connection=await this.row('agenda_google_connections',g.connectionId);
  if(!connection||connection.calendar_id!==booking.calendar_id)throw new AgendaError('A conexão Google não pertence a esta agenda.','AUTHORIZATION_REQUIRED',401);
  const details={summary:'Imperium · '+contact.name+' · '+contact.company+' · '+booking.subject,description:'Participante: '+contact.name+'\nEmpresa/condomínio: '+contact.company+'\nAssunto: '+booking.subject+'\nResponsável: '+booking.host_name+'\nProtocolo: '+booking.protocol+'\nAgendamento: '+booking.id};
  let r=await this.calendar(g.connectionId,'GET',path);
  if(booking.status==='canceled'){
   if(r.status===404||r.status===410)return {status:'canceled',onlineLink:''};
   if(r.status!==200)throw new AgendaError('Confira o cancelamento no Google Agenda.','GOOGLE_FAILED',503);this.check(r.data,booking);
   const removed=await this.calendar(g.connectionId,'DELETE',path+'?sendUpdates=none');if(![204,404,410].includes(removed.status))throw new AgendaError('Confira o cancelamento no Google Agenda.','GOOGLE_FAILED',503);return {status:'canceled',onlineLink:''};
  }
  if(r.status===404){
   const body={id:g.eventId,...details,
    start:{dateTime:booking.start_at,timeZone:ZONE},end:{dateTime:booking.end_at,timeZone:ZONE},attendees:[{email:contact.email}],extendedProperties:{private:{imperium_booking:booking.id}},
    conferenceData:{createRequest:{requestId:g.conferenceRequestId,conferenceSolutionKey:{type:'hangoutsMeet'}}}};
   r=await this.calendar(g.connectionId,'POST','?conferenceDataVersion=1&sendUpdates=none',body);
   if(r.status===409)r=await this.calendar(g.connectionId,'GET',path);
  }
  if(r.status!==200&&r.status!==201)throw new AgendaError('Não foi possível confirmar o evento Google.','GOOGLE_FAILED',503);
  this.check(r.data,booking);
  if(r.data.summary!==details.summary||r.data.description!==details.description){
   r=await this.calendar(g.connectionId,'PATCH',path+'?sendUpdates=none',details);
   if(r.status!==200)throw new AgendaError('Não foi possível atualizar os detalhes no Google Agenda.','GOOGLE_FAILED',503);this.check(r.data,booking);
  }
  if(r.data.conferenceData?.createRequest?.status?.statusCode==='failure'){
   if(r.data.conferenceData.createRequest.requestId!==g.conferenceRequestId){
    r=await this.calendar(g.connectionId,'PATCH',path+'?conferenceDataVersion=1&sendUpdates=none',{conferenceData:{createRequest:{requestId:g.conferenceRequestId,conferenceSolutionKey:{type:'hangoutsMeet'}}}});
    if(r.status!==200)throw new AgendaError('Não foi possível solicitar o Meet novamente.','GOOGLE_FAILED',503);this.check(r.data,booking);
   }else throw new AgendaError('O Google não criou o Meet. Use Verificar Google Meet no painel.','CONFERENCE_FAILED',503);
  }
  const link=r.data.hangoutLink||r.data.conferenceData?.entryPoints?.find(e=>e.entryPointType==='video')?.uri;
  if(typeof link!=='string'||!/^https:\/\/meet\.google\.com\/[a-z0-9-]+$/i.test(link))throw new AgendaError('O Google ainda está preparando o Meet.','CONFERENCE_PENDING',503);
  return {status:'ready',onlineLink:link};
 }
}
