/* Ativação por aparelho, mediante toque do usuário. Nunca guarda senha/token no service worker. */
(function(){'use strict';
const donoKey='imperium-push-usuario';
let reg=null,publicKey='',subscription=null,aparelhoId=null,erro='',dialog=null,iniciado=false,ocupado=false;
const ios=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const instalado=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const suportado=()=>isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
const perfil=()=>window.Imperium?.perfil;
function dono(){try{return localStorage.getItem(donoKey);}catch{return null;}}
function guardarDono(id){try{id?localStorage.setItem(donoKey,id):localStorage.removeItem(donoKey);}catch{}}
function bytes(s){const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
function mesmasChaves(a,b){return a&&a.byteLength===b.byteLength&&new Uint8Array(a).every((v,i)=>v===b[i]);}
async function api(acao,dados={}){
 const {data,error}=await window.Imperium.supabase.functions.invoke('push-notificacoes',{body:{acao,...dados}});
 if(error){let mensagem='Não foi possível configurar as notificações. Confira sua conexão e a instalação do push.';
  try{const resposta=await error.context?.json();if(resposta?.erro)mensagem=resposta.erro;}catch{}
  throw Error(mensagem);
 }
 if(data?.erro)throw Error(data.erro);return data;
}
function render(){
 const botao=document.getElementById('notificacoesBtn');if(botao)botao.classList.toggle('push-ativo',!!subscription&&!!aparelhoId);
 if(!dialog)return;
 const ativo=!!subscription&&!!aparelhoId,ajuda=dialog.querySelector('[data-push-status]');
 let mensagem=erro||(ativo?'Notificações ativadas neste aparelho.':'Ative os avisos que precisam da sua atenção, mesmo com o site fechado.');
 if(ios()&&!instalado())mensagem='No iPhone/iPad, abra no Safari, toque em Compartilhar → Adicionar à Tela de Início. Depois abra pelo ícone instalado e ative aqui (iOS 16.4 ou posterior).';
 else if(!suportado())mensagem='Este navegador não permite notificações push. Abra a plataforma em um navegador atualizado, usando HTTPS.';
 else if(Notification.permission==='denied')mensagem='As notificações estão bloqueadas. Libere nas configurações deste site/navegador ou nas notificações do aplicativo e volte aqui.';
 ajuda.textContent=mensagem;
 const ativar=dialog.querySelector('[data-push-ativar]');ativar.textContent=ocupado?'Aguarde…':ativo?'Desativar neste aparelho':'Ativar notificações';
 ativar.disabled=ocupado||(!ativo&&(!reg||!publicKey||!suportado()||(ios()&&!instalado())||Notification.permission==='denied'));
 dialog.querySelector('[data-push-teste]').hidden=!ativo;dialog.querySelector('[data-push-teste]').disabled=ocupado;
 dialog.querySelector('[data-push-recarregar]').disabled=ocupado;
}
async function preparar(){
 if(!suportado()||(ios()&&!instalado())){render();return;}
 try{
  erro='Carregando configuração…';render();
  await navigator.serviceWorker.register('sw.js');reg=await navigator.serviceWorker.ready;
  subscription=await reg.pushManager.getSubscription();
  if(subscription&&dono()!==perfil()?.id){await subscription.unsubscribe();subscription=null;aparelhoId=null;guardarDono(null);}
  const config=await api('config');publicKey=config.publicKey;
  if(subscription&&!mesmasChaves(subscription.options.applicationServerKey,bytes(publicKey))){await subscription.unsubscribe();subscription=null;aparelhoId=null;guardarDono(null);}
  if(subscription){const r=await api('ativar',{subscription:subscription.toJSON(),publicKey});aparelhoId=r.id;guardarDono(perfil().id);}
  erro='';
 }catch(e){erro=e.message;publicKey='';}
 render();
}
async function desligarAparelho(silencioso=false){
 let falhou=false;
 try{
  const registro=reg||await navigator.serviceWorker.getRegistration();
  const sub=subscription||await registro?.pushManager.getSubscription();
  if(sub){const endpoint=sub.endpoint;await sub.unsubscribe();
   try{await Promise.race([api('desativar',{endpoint}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Tempo excedido.')),5000))]);}catch{falhou=true;}
  }
 }finally{subscription=null;aparelhoId=null;guardarDono(null);erro=falhou?'Desativado no aparelho. O servidor removerá automaticamente a inscrição expirada.':'';render();}
 if(!silencioso&&falhou)window.Platform.toast(erro);
}
async function ativar(){
 if(ocupado)return;
 if(subscription&&aparelhoId){ocupado=true;render();try{await desligarAparelho();}catch(e){erro=e.message;}finally{ocupado=false;render();}return;}
 if(!reg||!publicKey)return;
 // subscribe inicia dentro do gesto, com a configuração já carregada (necessário no Safari).
 ocupado=true;erro='';
 let nova;
 try{nova=reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(publicKey)});render();subscription=await nova;
  const r=await api('ativar',{subscription:subscription.toJSON(),publicKey});aparelhoId=r.id;guardarDono(perfil().id);
 }catch(e){if(subscription&&!aparelhoId){try{await subscription.unsubscribe();}catch{}subscription=null;}
  erro=e.name==='NotAllowedError'?'Permissão não concedida. Você pode liberar as notificações nas configurações e tentar novamente.':e.message;
 }finally{ocupado=false;render();}
}
function abrir(){
 if(!dialog){dialog=document.createElement('dialog');dialog.className='push-dialog';dialog.setAttribute('aria-labelledby','pushTitulo');
  dialog.innerHTML='<div class="push-head"><h2 id="pushTitulo">Notificações no aparelho</h2><button class="btn ghost" data-push-fechar type="button" aria-label="Fechar notificações">×</button></div><p>Receba avisos mesmo quando a plataforma estiver fechada.</p><ul><li>Novos pedidos, retirada, recusa, cancelamento e recebimento de uniforme/EPI.</li></ul><p>Você recebe apenas os avisos pessoais e das ferramentas às quais tem acesso.</p><p class="push-status" data-push-status role="status" aria-live="polite"></p><div class="push-acoes"><button class="btn" type="button" data-push-ativar>Ativar notificações</button><button class="btn ghost" type="button" data-push-teste hidden>Testar notificação</button><button class="btn ghost" type="button" data-push-recarregar>Atualizar configuração</button></div>';
  document.body.appendChild(dialog);
  dialog.querySelector('[data-push-fechar]').addEventListener('click',()=>dialog.close());
  dialog.querySelector('[data-push-ativar]').addEventListener('click',ativar);
  dialog.querySelector('[data-push-recarregar]').addEventListener('click',async()=>{ocupado=true;render();await preparar();ocupado=false;render();});
  dialog.querySelector('[data-push-teste]').addEventListener('click',async()=>{ocupado=true;render();try{await api('testar',{id:aparelhoId});erro='';window.Platform.toast('Teste enviado. Confira as notificações deste aparelho.');}catch(e){erro=e.message;window.Platform.toast(erro);}finally{ocupado=false;render();}});
 }
 render();dialog.showModal();
}
function iniciar(){if(iniciado)return;iniciado=true;const b=document.getElementById('notificacoesBtn');
 const temAcesso=perfil()?.podeVer('uniforme_solicitar')||perfil()?.podeVer('uniforme_gestao');
 if(b)b.hidden=!temAcesso;if(!temAcesso)return;b?.addEventListener('click',abrir);preparar();
}
window.ImperiumPush={iniciar,desligarAparelho};
})();
