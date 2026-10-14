(function(){'use strict';
const params=new URLSearchParams(location.search),state=params.get('state'),code=params.get('code');
history.replaceState(null,'',location.pathname);
const status=document.getElementById('google-status');
document.getElementById('google-close').addEventListener('click',()=>{if(window.opener)window.close();else location.href='index.html#/agenda_gestao';});
(async()=>{
 let result='failed';
 try{
  const browserSecret=sessionStorage.getItem('imperium-agenda-google-browser');
  if(params.has('error')||!state||!code||!browserSecret)throw new Error('A autorização não foi concluída. Inicie a conexão novamente pelo painel da Imperium.');
  await window.ImperiumAgendaAPI.call('googleCallback',{state,code,browserSecret});
  sessionStorage.removeItem('imperium-agenda-google-browser');status.textContent='Google Agenda conectado. As novas reuniões online terão um Meet exclusivo.';result='connected';
 }catch(e){status.textContent=e.message+' Confira também o resultado no painel da agenda.';}
 if(window.opener)window.opener.postMessage({type:'imperium-agenda-google-result',result},location.origin);
})();
})();
