/* Login da plataforma via Supabase Auth.
   O convite autoriza uma conta, mas não confirma seu e-mail. A pessoa informa o endereço,
   recebe um link de verificação e só depois escolhe a senha. O servidor nunca pré-confirma
   o endereço e nunca aceita a senha de alguém que apenas possui o link inicial. */
(function(){
"use strict";

const sb = window.Imperium.supabase;
const $ = id => document.getElementById(id);

const controlesSenha = [];
function ligarVisibilidadeSenhas(){
  const olho = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const olhoFechado = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 18 18M10.6 5.1A12 12 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 4.1M6.1 6.1A17 17 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.9-1.9M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  document.querySelectorAll('.login-box input[type="password"]').forEach(input => {
    if(input.closest('.password-field')) return;
    const campo = document.createElement('div');
    campo.className = 'password-field';
    input.before(campo);
    campo.append(input);
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'password-toggle';
    botao.setAttribute('aria-controls', input.id);
    const definir = visivel => {
      input.type = visivel ? 'text' : 'password';
      botao.setAttribute('aria-pressed', String(visivel));
      botao.setAttribute('aria-label', visivel ? 'Ocultar senha' : 'Mostrar senha');
      botao.title = visivel ? 'Ocultar senha' : 'Mostrar senha';
      botao.innerHTML = visivel ? olhoFechado : olho;
    };
    definir(false);
    botao.addEventListener('click', e => {
      const inicio = input.selectionStart, fim = input.selectionEnd;
      definir(input.type === 'password');
      if(e.detail > 0) input.focus({ preventScroll: true });
      if(inicio !== null) input.setSelectionRange(inicio, fim);
    });
    campo.append(botao);
    controlesSenha.push(definir);
  });
}

/* A confirmação nativa de convite e a recuperação autenticam a sessão no Supabase.
   O link de convite ainda exige a escolha da senha antes de abrir as ferramentas. */
const parametrosAuth = new URLSearchParams(location.hash.slice(1));
const tipoLinkAuth = parametrosAuth.get("type");
let senhaJaDefinida = !["invite","recovery"].includes(tipoLinkAuth);

/* Link de convite (só nome, gerado pela tela "Usuários"): #/completar-convite?token=...&nome=...
   Aqui ainda NÃO existe sessão da nova conta — a pessoa informa o e-mail para receber a confirmação. */
const paramsConvite = /^#\/completar-convite\?/.test(location.hash)
  ? new URLSearchParams(location.hash.split("?").slice(1).join("?"))
  : null;
let tokenConvite = paramsConvite ? paramsConvite.get("token") : null;
const nomeConvite = paramsConvite ? (paramsConvite.get("nome") || "") : "";

function mostrar(tela){
  controlesSenha.forEach(definir => definir(false));
  $("login").style.display = tela === "login" ? "flex" : "none";
  $("senha").style.display = tela === "senha" ? "flex" : "none";
  $("cadastro").style.display = tela === "cadastro" ? "flex" : "none";
  $("confirmacao").style.display = tela === "confirmacao" ? "flex" : "none";
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
      erro(error.code === "email_not_confirmed" || error.message === "Email not confirmed" ? "Confirme seu e-mail pelo link recebido antes de entrar." : error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message);
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
  let salvandoSenha = false;
  form.addEventListener("submit", async e=>{
    e.preventDefault();
    if(salvandoSenha) return;
    erroSenha("");
    const nova = $("senhaNova").value, confirma = $("senhaConfirma").value;
    if(nova.length < 6){ erroSenha("A senha precisa ter pelo menos 6 caracteres."); return; }
    if(nova !== confirma){ erroSenha("As duas senhas digitadas são diferentes."); return; }
    const btn = form.querySelector('button[type="submit"]'), txt = btn.textContent;
    salvandoSenha = true; btn.disabled = true; btn.textContent = "Salvando…";
    try{
      const { data, error: erroUsuario } = await sb.auth.getUser();
      if(erroUsuario || !data.user || !data.user.email_confirmed_at){
        erroSenha("Abra o link de confirmação recebido no seu e-mail para criar a senha."); return;
      }
      const { error } = await sb.auth.updateUser({ password: nova, data: { convite_senha_pendente: false } });
      if(error){ erroSenha(error.message); return; }
      history.replaceState(null, "", location.pathname + location.search);
      senhaJaDefinida = true;
      $("senhaNova").value = ""; $("senhaConfirma").value = "";
      const { data: { session } } = await sb.auth.getSession();
      await aplicarSessao(session);
    }catch(_){ erroSenha("Não foi possível salvar a senha. Confira sua conexão e tente novamente."); }
    finally{ salvandoSenha = false; btn.disabled = false; btn.textContent = txt; }
  });
}

/* O link inicial só pede o e-mail. Não faz login nem escolhe senha antes de provar
   que a pessoa tem acesso à caixa de entrada. */
function ligarFormularioCadastro(){
  const form = $("cadastroForm");
  if(form.dataset.ligado) return;
  form.dataset.ligado = "1";
  let cadastroEmAndamento = false;
  if(nomeConvite) $("cadastroTitulo").textContent = `Bem-vindo(a), ${nomeConvite}`;
  form.addEventListener("submit", async e=>{
    e.preventDefault();
    if(cadastroEmAndamento) return;
    erroCadastro("");
    const email = $("cadastroEmail").value.trim().toLowerCase();
    if(!tokenConvite){ erroCadastro("Abra um novo link de convite enviado pelo administrador."); return; }
    if(email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ erroCadastro("Digite um e-mail válido."); return; }
    const btn = form.querySelector('button[type="submit"]'), txt = btn.textContent;
    cadastroEmAndamento = true; btn.disabled = true; btn.textContent = "Enviando…";
    try{
      const { data, error } = await sb.functions.invoke("completar-convite", { body: { token: tokenConvite, email } });
      let falha = null;
      if(error){
        falha = error.message || "Não foi possível enviar a confirmação.";
        try{ const corpo = await error.context.json(); if(corpo && corpo.erro) falha = corpo.erro; }catch(_){}
      }else if(data && data.erro){ falha = data.erro; }
      if(falha){ erroCadastro(falha); return; }
      if(!data || data.ok !== true || data.confirmacao_pendente !== true){
        erroCadastro("O servidor precisa da atualização de confirmação por e-mail. Avise o administrador."); return;
      }
      history.replaceState(null, "", location.pathname + location.search);
      tokenConvite = null;
      $("confirmacaoEmail").textContent = email;
      $("loginEmail").value = email;
      mostrar("confirmacao");
    }catch(_){ erroCadastro("Não foi possível confirmar o envio. Confira sua conexão. Se recebeu o e-mail, use o link enviado."); }
    finally{ cadastroEmAndamento = false; btn.disabled = false; btn.textContent = txt; }
  });
  $("confirmacaoLogin").addEventListener("click", ()=>{
    mostrar("login");
    erro("Abra o link recebido no e-mail para confirmar seu endereço e escolher sua senha.",true);
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
let perfilValidado = false;
let validacaoSessao = 0;
let sessaoNormalIniciada = false;
async function aplicarSessao(sessao){
  const atual = ++validacaoSessao;
  if(sessao){
    if(perfilValidado && sessaoAtual && sessaoAtual.user.id === sessao.user.id && senhaJaDefinida){
      sessaoAtual = sessao; return;
    }
    try{
      // getUser consulta o servidor: não confia só na sessão guardada no navegador.
      const { data, error } = await sb.auth.getUser();
      if(atual !== validacaoSessao) return;
      if(error || !data.user || !data.user.email_confirmed_at){
        sessaoAtual = null; perfilValidado = false; window.Imperium.perfil = null;
        await sb.auth.signOut();
        mostrar("login");
        erro(error ? "Não foi possível validar seu acesso. Confira a conexão e entre novamente." : "Confirme seu e-mail pelo link recebido antes de entrar.");
        return;
      }
      if(!senhaJaDefinida || data.user.user_metadata?.convite_senha_pendente === true){
        sessaoAtual = sessao; perfilValidado = false;
        if(tipoLinkAuth === "invite" || data.user.user_metadata?.convite_senha_pendente === true){
          $("senhaSub").textContent = "E-mail confirmado. Crie sua senha para concluir seu acesso.";
        }
        mostrar("senha"); return;
      }
      const perfil = await window.Imperium.carregarPerfil();
      if(atual !== validacaoSessao) return;
      if(!perfil){
        sessaoAtual = null; perfilValidado = false;
        await sb.auth.signOut();
        mostrar("login"); erro("Seu acesso ainda não foi liberado, ou foi desativado. Fale com o administrador."); return;
      }
      sessaoAtual = sessao; perfilValidado = true; entrar();
    }catch(_){
      if(atual !== validacaoSessao) return;
      mostrar("login"); erro("Não foi possível validar seu acesso. Confira a conexão e tente novamente.");
    }
  }else if(sessaoAtual || perfilValidado){
    sessaoAtual = null; perfilValidado = false;
    location.reload();
  }else{
    mostrar("login");
    if(parametrosAuth.get("error")) erro("O link de confirmação ou recuperação expirou ou já foi usado. Peça outro ao administrador.");
  }
}

function iniciarSessaoNormal(){
  if(sessaoNormalIniciada) return;
  sessaoNormalIniciada = true;
  sb.auth.onAuthStateChange((evento, sessao)=>{
    if(evento === "PASSWORD_RECOVERY"){ senhaJaDefinida = false; perfilValidado = false; }
    // Não executar outras chamadas Auth dentro do callback: o SDK mantém um lock.
    setTimeout(()=> aplicarSessao(sessao),0);
  });
  sb.auth.getSession().then(({ data: { session } })=>aplicarSessao(session)).catch(()=>{
    mostrar("login");erro("Não foi possível verificar a sessão. Confira sua conexão.");
  });
}

async function iniciar(){
  ligarVisibilidadeSenhas();
  ligarFormulario();
  ligarFormularioSenha();
  ligarFormularioCadastro();
  // veio de um link de convite (só nome): mostra a tela de auto-cadastro e espera a pessoa
  // informar o e-mail. A sessão da nova conta só é criada pelo link de confirmação.
  if(tokenConvite){ mostrar("cadastro"); return; }
  iniciarSessaoNormal();
}

document.addEventListener("DOMContentLoaded", iniciar);

window.ImperiumAuth = { sair: async () => {
  try{ if(window.ImperiumPush) await window.ImperiumPush.desligarAparelho(true); }catch(_){}
  return sb.auth.signOut();
} };
})();
