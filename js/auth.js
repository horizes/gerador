/* Login da plataforma — e-mail e senha via Supabase Auth.
   Não existe cadastro público aqui: as contas são criadas pela tela "Usuários" (que gera um
   link de "definir senha" para cada pessoa) ou, à moda antiga, no painel do Supabase em
   Authentication > Users > Add user (marque "Auto Confirm User" nesse caso). */
(function(){
"use strict";

const sb = window.Imperium.supabase;
const $ = id => document.getElementById(id);

/* Convite / redefinição de senha: quando a pessoa clica no link gerado (seja o convite da tela
   "Usuários", seja "Esqueci minha senha"), o Supabase já autentica a sessão sozinho e manda de
   volta para o site com #access_token=...&type=invite (ou type=recovery) na URL. Detectamos isso
   já na carga da página para mostrar a tela "Defina sua senha" em vez de abrir a plataforma
   direto — só depois de ela salvar a senha é que a sessão passa a valer de verdade. */
const viaConvite = /type=(invite|recovery)/.test(location.hash);
let senhaJaDefinida = !viaConvite;

function mostrar(tela){
  $("login").style.display = tela === "login" ? "flex" : "none";
  $("senha").style.display = tela === "senha" ? "flex" : "none";
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

function erroSenha(msg){
  const el = $("senhaErro");
  el.textContent = msg || "";
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

function ligarFormularioSenha(){
  const form = $("senhaForm");
  if(form.dataset.ligado) return;
  form.dataset.ligado = "1";

  form.addEventListener("submit", async e=>{
    e.preventDefault();
    erroSenha("");
    const nova = $("senhaNova").value;
    const confirma = $("senhaConfirma").value;
    if(nova.length < 6){ erroSenha("A senha precisa ter pelo menos 6 caracteres."); return; }
    if(nova !== confirma){ erroSenha("As duas senhas digitadas são diferentes."); return; }

    const btn = form.querySelector('button[type="submit"]');
    const txt = btn.textContent;
    btn.disabled = true; btn.textContent = "Salvando…";
    const { error } = await sb.auth.updateUser({ password: nova });
    btn.disabled = false; btn.textContent = txt;
    if(error){ erroSenha(error.message); return; }

    // limpa o #access_token=...&type=invite da URL, para não reaparecer num recarregamento
    history.replaceState(null, "", location.pathname + location.search);
    senhaJaDefinida = true;
    const { data: { session } } = await sb.auth.getSession();
    aplicarSessao(session);
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
let perfilValidado = false; // já conferimos o perfil (papel/nível) desta sessão?
async function aplicarSessao(sessao){
  if(sessao){
    sessaoAtual = sessao;
    // sessão veio de um link de convite/redefinição e a pessoa ainda não escolheu a senha
    // nova: mostra essa tela em vez de entrar direto na plataforma com a senha temporária.
    if(!senhaJaDefinida){ mostrar("senha"); return; }
    if(perfilValidado){ return; } // sessão já validada e plataforma já aberta
    const perfil = await window.Imperium.carregarPerfil();
    if(!perfil){
      // login certo, mas sem permissão configurada (ou conta desativada): não deixa entrar
      sessaoAtual = null;
      await sb.auth.signOut();
      erro("Seu acesso ainda não foi liberado, ou foi desativado. Fale com o administrador.");
      return;
    }
    perfilValidado = true;
    entrar();
  }else if(sessaoAtual || perfilValidado){
    sessaoAtual = null; perfilValidado = false;
    location.reload(); // logout de verdade: recarrega para zerar o estado dos módulos
  }else{
    mostrar("login");
  }
}

async function iniciar(){
  ligarFormulario();
  ligarFormularioSenha();
  sb.auth.onAuthStateChange((_evento, sessao)=> aplicarSessao(sessao));
  const { data: { session } } = await sb.auth.getSession();
  aplicarSessao(session);
}

document.addEventListener("DOMContentLoaded", iniciar);

window.ImperiumAuth = { sair: () => sb.auth.signOut() };
})();
