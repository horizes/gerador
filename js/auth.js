/* Login da plataforma — e-mail e senha via Supabase Auth.
   Não existe cadastro público aqui: as contas de acesso (uma por pessoa da equipe)
   são criadas no painel do Supabase, em Authentication > Users > Add user
   (marque "Auto Confirm User" para a pessoa já poder entrar sem confirmar e-mail). */
(function(){
"use strict";

const sb = window.Imperium.supabase;
const $ = id => document.getElementById(id);

function mostrar(tela){
  $("login").style.display = tela === "login" ? "flex" : "none";
  // Sem valor ("") o CSS decide: lado a lado no computador e em bloco no celular/tablet
  // (antes, o "flex" fixo aqui anulava o layout de celular e deixava a tela quebrada).
  $("shell").style.display = tela === "shell" ? "" : "none";
}

function erro(msg, info){
  const el = $("loginErro");
  el.textContent = msg || "";
  el.classList.toggle("info", !!info);
  el.hidden = !msg;
}

function ligarFormulario(){
  const form = $("loginForm");
  if(form.dataset.ligado) return;
  form.dataset.ligado = "1";

  // "Manter conectado": mostra a última escolha (padrão: ligado)
  $("loginManter").checked = window.Imperium.manterConectado.ler();

  form.addEventListener("submit", async e=>{
    e.preventDefault();
    erro("");
    const email = $("loginEmail").value.trim();
    const senha = $("loginSenha").value;
    const btn = form.querySelector('button[type="submit"]');
    const txt = btn.textContent;
    btn.disabled = true; btn.textContent = "Entrando…";
    // precisa ser gravado ANTES do login, para a sessão ir para o lugar certo
    window.Imperium.manterConectado.definir($("loginManter").checked);
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    btn.disabled = false; btn.textContent = txt;
    if(error){
      erro(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message);
    }
    // se der certo, onAuthStateChange troca a tela sozinho
  });

  $("loginEsqueci").addEventListener("click", async ()=>{
    const email = $("loginEmail").value.trim();
    if(!email){ erro("Digite seu e-mail acima e clique de novo para receber o link."); return; }
    erro("");
    const { error } = await sb.auth.resetPasswordForEmail(email);
    if(error) erro(error.message);
    else erro("Se esse e-mail tiver uma conta, enviamos um link para redefinir a senha.", true);
  });
}

let plataformaIniciada = false;
function entrar(){
  mostrar("shell");
  if(!plataformaIniciada){
    plataformaIniciada = true;
    window.Platform.iniciar();
  }
}

// Guarda se já tivemos uma sessão válida nesta aba. Isso evita que um evento inicial
// do Supabase com sessão ainda vazia (antes de carregar o que estava salvo) seja
// confundido com um logout de verdade e fique recarregando a página sem parar.
let sessaoAtual = null;
function aplicarSessao(sessao){
  if(sessao){
    sessaoAtual = sessao;
    entrar();
  }else if(sessaoAtual){
    sessaoAtual = null;
    location.reload(); // logout de verdade: recarrega para zerar o estado dos módulos
  }else{
    mostrar("login");
  }
}

async function iniciar(){
  ligarFormulario();
  sb.auth.onAuthStateChange((_evento, sessao)=> aplicarSessao(sessao));
  const { data: { session } } = await sb.auth.getSession();
  aplicarSessao(session);
}

document.addEventListener("DOMContentLoaded", iniciar);

window.ImperiumAuth = { sair: () => sb.auth.signOut() };
})();
