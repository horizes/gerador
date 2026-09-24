/* Login da plataforma — e-mail e senha via Supabase Auth.
   Não existe cadastro público aberto: as contas só nascem de um convite. Na tela "Usuários", o
   admin digita apenas o NOME da pessoa e gera um link (sem e-mail nenhum); a pessoa abre o link,
   escolhe o PRÓPRIO e-mail e senha na tela "cadastro" abaixo, e só então a conta é criada — ela
   aparece para o admin na hora, na tela "Usuários" (ver completar-convite e supabase-schema-
   convites.sql). Também dá para criar contas à moda antiga, direto no painel do Supabase em
   Authentication > Users > Add user (marque "Auto Confirm User" nesse caso). */
(function(){
"use strict";

const sb = window.Imperium.supabase;
const $ = id => document.getElementById(id);

/* Redefinição de senha ("Esqueci minha senha"): o Supabase autentica a sessão sozinho e manda de
   volta para o site com #access_token=...&type=recovery na URL. Detectamos isso já na carga da
   página para mostrar a tela "Defina sua senha" em vez de abrir a plataforma direto — só depois
   de ela salvar a nova senha é que a sessão passa a valer de verdade. */
const viaConvite = /type=recovery/.test(location.hash);
let senhaJaDefinida = !viaConvite;

/* Link de convite (só nome, gerado pela tela "Usuários"): #/completar-convite?token=...&nome=...
   Aqui ainda NÃO existe sessão nem conta — é a pessoa quem vai escolher e-mail e senha agora. */
const paramsConvite = /^#\/completar-convite\?/.test(location.hash)
  ? new URLSearchParams(location.hash.split("?").slice(1).join("?"))
  : null;
let tokenConvite = paramsConvite ? paramsConvite.get("token") : null;
const nomeConvite = paramsConvite ? (paramsConvite.get("nome") || "") : "";

function mostrar(tela){
  $("login").style.display = tela === "login" ? "flex" : "none";
  $("senha").style.display = tela === "senha" ? "flex" : "none";
  $("cadastro").style.display = tela === "cadastro" ? "flex" : "none";
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

function erroCadastro(msg){
  const el = $("cadastroErro");
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

/* Tela de auto-cadastro: a pessoa chegou por um link de convite (só o nome, sem e-mail) e agora
   escolhe o próprio e-mail e senha. Como ela ainda não tem conta nem sessão, quem cria a conta de
   verdade é a Edge Function completar-convite (roda com a service role key, no servidor) — aqui só
   chamamos ela e, se der certo, fazemos o login normal com o e-mail/senha que a pessoa escolheu. */
function ligarFormularioCadastro(){
  const form = $("cadastroForm");
  if(form.dataset.ligado) return;
  form.dataset.ligado = "1";

  if(nomeConvite) $("cadastroTitulo").textContent = `Bem-vindo(a), ${nomeConvite}`;

  form.addEventListener("submit", async e=>{
    e.preventDefault();
    erroCadastro("");
    const email = $("cadastroEmail").value.trim();
    const senha = $("cadastroSenha").value;
    const confirma = $("cadastroConfirma").value;
    if(senha.length < 6){ erroCadastro("A senha precisa ter pelo menos 6 caracteres."); return; }
    if(senha !== confirma){ erroCadastro("As duas senhas digitadas são diferentes."); return; }

    const btn = form.querySelector('button[type="submit"]');
    const txt = btn.textContent;
    btn.disabled = true; btn.textContent = "Criando acesso…";

    const { data, error } = await sb.functions.invoke("completar-convite", { body: { token: tokenConvite, email, senha } });

    // mesmo caso de sempre: erro 4xx/5xx não vem pronto em error.message, precisa ler o corpo
    let falha = null;
    if(error){
      falha = error.message || "Não foi possível criar o acesso.";
      try{ const corpo = await error.context.json(); if(corpo && corpo.erro) falha = corpo.erro; }catch(_){}
    }else if(data && data.erro){ falha = data.erro; }
    if(falha){
      btn.disabled = false; btn.textContent = txt;
      erroCadastro(falha);
      return;
    }

    // conta criada — agora entra de verdade, com o e-mail/senha que a pessoa acabou de escolher
    const { error: erroLogin } = await sb.auth.signInWithPassword({ email, password: senha });
    btn.disabled = false; btn.textContent = txt;
    if(erroLogin){
      erroCadastro("Acesso criado! Mas não deu para entrar sozinho agora — vá para a tela de login e entre com o e-mail e a senha que você acabou de escolher.");
      return;
    }

    history.replaceState(null, "", location.pathname + location.search);
    tokenConvite = null;
    iniciarSessaoNormal();
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

function iniciarSessaoNormal(){
  sb.auth.onAuthStateChange((_evento, sessao)=> aplicarSessao(sessao));
  sb.auth.getSession().then(({ data: { session } }) => aplicarSessao(session));
}

async function iniciar(){
  ligarFormulario();
  ligarFormularioSenha();
  ligarFormularioCadastro();
  // veio de um link de convite (só nome): mostra a tela de auto-cadastro e espera a pessoa
  // preencher e-mail/senha — só depois disso é que faz sentido checar sessão do Supabase.
  if(tokenConvite){ mostrar("cadastro"); return; }
  iniciarSessaoNormal();
}

document.addEventListener("DOMContentLoaded", iniciar);

window.ImperiumAuth = { sair: () => sb.auth.signOut() };
})();
