/* Login da plataforma via Supabase Auth.
   O convite autoriza uma conta, mas não confirma seu e-mail. A pessoa informa o endereço,
   recebe um código de verificação e só depois escolhe a senha. O servidor nunca pré-confirma
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

/* O código numérico completo é validado nesta plataforma. Links de e-mail antigos
   abrem a tela de código; nunca são trocados por uma sessão automaticamente. */
const parametrosAuth = new URLSearchParams(location.hash.slice(1));
const retornoAuth = new URLSearchParams(location.search);
const retornoPorLink = ["token_hash", "code", "error"].some(k => retornoAuth.has(k)) ||
  ["access_token", "refresh_token", "error"].some(k => parametrosAuth.has(k)) ||
  ["invite", "recovery"].includes(retornoAuth.get("type") || parametrosAuth.get("type"));
let senhaJaDefinida = true;
let verificacaoAtiva = false;
let verificacaoEmAndamento = false;
let codigoValidadoPara = null;
let criandoSenha = false;
const CHAVE_ETAPA_SENHA = "imperium_senha_token_pendente";
const CHAVE_INSTALACAO = "imperium_instalacao_pendente";
let instalacaoPendente = lerInstalacao();
const CHAVE_VERIFICACAO = "imperium_verificacao_pendente";
const INTERVALO_REENVIO = 60 * 1000;
const emailValido = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
let verificacaoPendente = lerVerificacao();
let temporizadorReenvio = null;

function lerInstalacao(){
  try{ return sessionStorage.getItem(CHAVE_INSTALACAO); }catch(_){ return null; }
}
function marcarInstalacao(id){
  instalacaoPendente = id;
  try{ sessionStorage.setItem(CHAVE_INSTALACAO, id); }catch(_){}
}
function limparInstalacao(){
  instalacaoPendente = null;
  try{ sessionStorage.removeItem(CHAVE_INSTALACAO); }catch(_){}
}

function lerVerificacao(){
  try{
    const etapa = JSON.parse(sessionStorage.getItem(CHAVE_VERIFICACAO));
    if(etapa && emailValido(etapa.email || "") && ["invite", "recovery", "email"].includes(etapa.tipo) &&
      Number.isFinite(etapa.criadaEm) && Date.now() - etapa.criadaEm < 24 * 60 * 60 * 1000){
      etapa.reenviarEm = Math.min(Number(etapa.reenviarEm) || 0, Date.now() + INTERVALO_REENVIO);
      return etapa;
    }
  }catch(_){}
  return null;
}
function guardarVerificacao(email, tipo, enviada = false){
  verificacaoPendente = { email, tipo, criadaEm: Date.now(),
    reenviarEm: enviada ? Date.now() + INTERVALO_REENVIO : 0 };
  try{ sessionStorage.setItem(CHAVE_VERIFICACAO, JSON.stringify(verificacaoPendente)); }catch(_){}
  atualizarReenvio();
}
function limparVerificacao(){
  verificacaoPendente = null;
  try{ sessionStorage.removeItem(CHAVE_VERIFICACAO); }catch(_){}
  if(temporizadorReenvio) clearTimeout(temporizadorReenvio);
  temporizadorReenvio = null;
}
function atualizarReenvio(){
  if(temporizadorReenvio) clearTimeout(temporizadorReenvio);
  temporizadorReenvio = null;
  const segundos = Math.max(0, Math.ceil(((verificacaoPendente?.reenviarEm || 0) - Date.now()) / 1000));
  $("verificacaoReenviar").disabled = verificacaoEmAndamento || segundos > 0;
  if(!verificacaoEmAndamento){
    $("verificacaoReenviar").textContent = segundos ? `Reenviar em ${segundos}s` : "Receber novo código";
  }
  if(segundos) temporizadorReenvio = setTimeout(atualizarReenvio, 1000);
}

function etapaSenhaSalva(){
  try{ return sessionStorage.getItem(CHAVE_ETAPA_SENHA); }catch(_){ return null; }
}
function marcarCodigoValidado(id){
  codigoValidadoPara = id;
  try{ sessionStorage.setItem(CHAVE_ETAPA_SENHA, id); }catch(_){}
}
function limparEtapaSenha(){
  codigoValidadoPara = null;
  try{ sessionStorage.removeItem(CHAVE_ETAPA_SENHA); }catch(_){}
}
function codigoConfirmadoPara(id){
  return codigoValidadoPara === id || etapaSenhaSalva() === id;
}

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
  $("verificacao").style.display = tela === "verificacao" ? "flex" : "none";
  $("instalacao").style.display = tela === "instalacao" ? "flex" : "none";
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

function limparRetornoAuth(){
  const params = new URLSearchParams(location.search);
  ["token_hash", "type", "code", "error", "error_code", "error_description"].forEach(k => params.delete(k));
  const busca = params.toString();
  history.replaceState(null, "", location.pathname + (busca ? "?" + busca : ""));
}

function erroVerificacao(msg, info){
  const el = $("verificacaoErro");
  el.textContent = msg || "";
  el.classList.toggle("info", !!info);
  el.hidden = !msg;
}

function abrirVerificacao(email, tipo, enviada = false){
  if(verificacaoEmAndamento) return;
  const endereco = (email || "").trim().toLowerCase();
  if(tipo && emailValido(endereco)) guardarVerificacao(endereco, tipo, enviada);
  else if(verificacaoPendente && endereco && endereco !== verificacaoPendente.email) limparVerificacao();
  verificacaoAtiva = true;
  ++validacaoSessao;
  $("verificacaoEmail").value = verificacaoPendente?.email || endereco;
  $("verificacaoEmail").readOnly = !!verificacaoPendente;
  $("verificacaoToken").value = "";
  $("verificacaoEtapa").textContent = verificacaoPendente?.tipo === "invite" ? "Etapa 2 de 3 · Confirme seu e-mail" : "Confirme seu e-mail";
  $("verificacaoSub").textContent = "Digite o código completo recebido. Confira também a pasta de spam.";
  erroVerificacao("");
  mostrar("verificacao");
  atualizarReenvio();
  (emailValido($("verificacaoEmail").value) ? $("verificacaoToken") : $("verificacaoEmail")).focus();
}

function bloquearVerificacao(bloqueado){
  ["verificacaoConfirmar", "verificacaoReenviar", "verificacaoVoltar"].forEach(id => {
    $(id).disabled = bloqueado;
  });
  $("verificacaoEmail").disabled = bloqueado;
  $("verificacaoToken").disabled = bloqueado;
  if(!bloqueado) atualizarReenvio();
}

function mensagemVerificacao(error){
  if(error?.status === 429 || error?.code === "over_email_send_rate_limit" || error?.code === "over_request_rate_limit"){
    return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  }
  if(error?.code === "otp_expired" || error?.code === "validation_failed"){
    return "Código incorreto, expirado ou já utilizado. Confira o código completo do último e-mail ou peça um novo.";
  }
  return "Não foi possível confirmar o acesso. Confira a conexão e tente novamente. Se o código já foi usado, solicite outro.";
}

function ligarFormularioVerificacao(){
  const form = $("verificacaoForm");
  if(form.dataset.ligado) return;
  form.dataset.ligado = "1";
  // Preserva zeros iniciais e aceita códigos colados com espaços ou hífens.
  $("verificacaoToken").addEventListener("input", () => {
    $("verificacaoToken").value = $("verificacaoToken").value.replace(/[\s\u200B-\u200D\uFEFF-]/g, "");
  });
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if(verificacaoEmAndamento) return;
    erroVerificacao("");
    const email = $("verificacaoEmail").value.trim().toLowerCase();
    const token = $("verificacaoToken").value.replace(/[\s\u200B-\u200D\uFEFF-]/g, "");
    if(!emailValido(email)){
      erroVerificacao("Digite o e-mail que recebeu o código."); return;
    }
    if(!/^\d{6,10}$/.test(token)){
      erroVerificacao("Digite o código completo recebido por e-mail, com 6 a 10 números."); return;
    }
    // O tipo acompanha o envio. "email" mantém compatibilidade com códigos antigos
    // ou digitados em outro navegador, onde o contexto do pedido não está salvo.
    const tipo = verificacaoPendente?.email === email ? verificacaoPendente.tipo : "email";
    const dados = { email, token, type: tipo };
    verificacaoEmAndamento = true;
    bloquearVerificacao(true);
    const btn = $("verificacaoConfirmar"), txt = btn.textContent;
    btn.textContent = "Confirmando…";
    try{
      const { data, error } = await sb.auth.verifyOtp(dados);
      if(error){ erroVerificacao(mensagemVerificacao(error)); return; }
      // Exige uma sessão produzida por este código; nunca reaproveita uma sessão antiga.
      if(!data?.session?.user?.id){
        erroVerificacao("Não foi possível concluir a confirmação. Solicite um novo código."); return;
      }
      const confirmado = data.session.user;
      if(!confirmado.email_confirmed_at || confirmado.email?.toLowerCase() !== email){
        erroVerificacao("Não foi possível validar a confirmação. Solicite um novo código."); return;
      }
      // O OTP já foi consumido. Registra a etapa antes de novas consultas de rede,
      // para não pedir de novo um código válido se a conexão falhar depois daqui.
      marcarCodigoValidado(confirmado.id);
      limparVerificacao();
      limparRetornoAuth();
      $("verificacaoToken").value = "";
      senhaJaDefinida = false;
      perfilValidado = false;
      verificacaoAtiva = false;
      iniciarSessaoNormal();
      await aplicarSessao(data.session);
    }catch(_){ erroVerificacao("Não foi possível confirmar o acesso. Confira a conexão e tente novamente."); }
    finally{
      verificacaoEmAndamento = false;
      bloquearVerificacao(false);
      btn.textContent = txt;
    }
  });
  $("verificacaoReenviar").addEventListener("click", async () => {
    if(verificacaoEmAndamento || Date.now() < (verificacaoPendente?.reenviarEm || 0)) return;
    const email = $("verificacaoEmail").value.trim().toLowerCase();
    if(!emailValido(email)){
      erroVerificacao("Digite seu e-mail para receber um novo código."); return;
    }
    verificacaoEmAndamento = true;
    bloquearVerificacao(true);
    const btn = $("verificacaoReenviar");
    btn.textContent = "Enviando…";
    erroVerificacao("");
    try{
      const { error } = await sb.auth.resetPasswordForEmail(email);
      if(error){
        if(error.status === 429 || ["over_email_send_rate_limit", "over_request_rate_limit"].includes(error.code)){
          guardarVerificacao(email, verificacaoPendente?.tipo || "email", true);
        }
        erroVerificacao(mensagemVerificacao(error)); return;
      }
      // resetPasswordForEmail gera RECOVERY, inclusive para uma conta de convite.
      guardarVerificacao(email, "recovery", true);
      $("verificacaoEmail").readOnly = true;
      $("verificacaoToken").value = "";
      erroVerificacao("Se esse e-mail tiver uma conta, enviamos um novo código. Use o último e-mail recebido.", true);
    }catch(_){ erroVerificacao("Não foi possível solicitar o código. Confira sua conexão e tente novamente."); }
    finally{
      verificacaoEmAndamento = false;
      bloquearVerificacao(false);
    }
  });
  $("verificacaoVoltar").addEventListener("click", () => {
    if(verificacaoEmAndamento) return;
    limparRetornoAuth();
    verificacaoAtiva = false;
    $("verificacaoToken").value = "";
    $("loginEmail").value = $("verificacaoEmail").value;
    mostrar("login");
    iniciarSessaoNormal();
  });
  $("loginCodigo").addEventListener("click", () => abrirVerificacao($("loginEmail").value));
}

function ligarFormulario(){
  const form = $("loginForm");
  if(form.dataset.ligado) return;
  form.dataset.ligado = "1";
  let recuperacaoEmAndamento = false;

  // "Manter conectado": mostra a última escolha (padrão: ligado)
  $("loginManter").checked = window.Imperium.manterConectado.ler();

  form.addEventListener("submit", async e=>{
    e.preventDefault();
    erro("");
    const email = $("loginEmail").value.trim().toLowerCase();
    const senha = $("loginSenha").value;
    const btn = form.querySelector('button[type="submit"]');
    const txt = btn.textContent;
    btn.disabled = true; btn.textContent = "Entrando…";
    // precisa ser gravado ANTES do login, para a sessão ir para o lugar certo
    window.Imperium.manterConectado.definir($("loginManter").checked);
    const { error } = await sb.auth.signInWithPassword({ email, password: senha });
    btn.disabled = false; btn.textContent = txt;
    if(error){
      erro(error.code === "email_not_confirmed" || error.message === "Email not confirmed" ? "Confirme seu e-mail com o código recebido antes de entrar." : error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message);
    }
    // se der certo, onAuthStateChange troca a tela sozinho
  });

  $("loginEsqueci").addEventListener("click", async ()=>{
    if(recuperacaoEmAndamento) return;
    const email = $("loginEmail").value.trim().toLowerCase();
    if(!emailValido(email)){ erro("Digite um e-mail válido acima para receber o código."); return; }
    if(verificacaoPendente?.email === email && Date.now() < verificacaoPendente.reenviarEm){
      abrirVerificacao(email);
      erroVerificacao("Já solicitamos um código. Confira seu e-mail ou aguarde para reenviar.", true);
      return;
    }
    erro("");
    const btn = $("loginEsqueci"), txt = btn.textContent;
    recuperacaoEmAndamento = true;
    btn.disabled = true; btn.textContent = "Enviando…";
    $("loginCodigo").disabled = true;
    try{
      const { error } = await sb.auth.resetPasswordForEmail(email);
      if(error){ erro(mensagemVerificacao(error)); return; }
      abrirVerificacao(email, "recovery", true);
      erroVerificacao("Se esse e-mail tiver uma conta, enviamos um código para redefinir a senha.", true);
    }catch(_){ erro("Não foi possível enviar o código. Confira sua conexão e tente novamente."); }
    finally{
      recuperacaoEmAndamento = false;
      btn.disabled = false; btn.textContent = txt;
      $("loginCodigo").disabled = false;
    }
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
      if(erroUsuario){ erroSenha("Não foi possível validar sua sessão. Confira a conexão e tente salvar novamente."); return; }
      if(!data.user || !data.user.email_confirmed_at || !codigoConfirmadoPara(data.user.id)){
        erroSenha("Confirme o código recebido no seu e-mail para criar a senha."); return;
      }
      const primeiroAcesso = criandoSenha || data.user.user_metadata?.convite_senha_pendente === true;
      const { error } = await sb.auth.updateUser({ password: nova, data: { convite_senha_pendente: false } });
      if(error){ erroSenha(error.message); return; }
      if(primeiroAcesso) marcarInstalacao(data.user.id);
      criandoSenha = false;
      limparRetornoAuth();
      senhaJaDefinida = true;
      limparEtapaSenha();
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
  $("cadastroTenhoCodigo").addEventListener("click", () => {
    if(cadastroEmAndamento) return;
    const email = $("cadastroEmail").value.trim().toLowerCase();
    if(!emailValido(email)){ erroCadastro("Informe o e-mail que recebeu o código."); return; }
    // Também permite continuar se o e-mail chegou, mas a resposta do envio se perdeu.
    limparRetornoAuth();
    tokenConvite = null;
    abrirVerificacao(email);
  });
  form.addEventListener("submit", async e=>{
    e.preventDefault();
    if(cadastroEmAndamento) return;
    erroCadastro("");
    const email = $("cadastroEmail").value.trim().toLowerCase();
    if(!tokenConvite){ erroCadastro("Abra um novo link de convite enviado pelo administrador."); return; }
    if(email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ erroCadastro("Digite um e-mail válido."); return; }
    const btn = form.querySelector('button[type="submit"]'), txt = btn.textContent;
    cadastroEmAndamento = true; btn.disabled = true; btn.textContent = "Enviando…";
    $("cadastroTenhoCodigo").disabled = true;
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
      $("loginEmail").value = email;
      abrirVerificacao(email, data.tipo_verificacao === "recovery" ? "recovery" : "invite", true);
      erroVerificacao("Enviamos seu código. Digite-o abaixo para continuar.", true);
    }catch(_){ erroCadastro("Não foi possível confirmar o envio. Confira sua conexão. Se recebeu o e-mail, use o código enviado."); }
    finally{
      cadastroEmAndamento = false; btn.disabled = false; btn.textContent = txt;
      $("cadastroTenhoCodigo").disabled = false;
    }
  });
}

let plataformaIniciada = false;
function abrirInstalacao(){
  if(!sessaoAtual || !perfilValidado) return;
  mostrar("instalacao");
  $("instalacaoEtapa").textContent = instalacaoPendente === sessaoAtual.user.id ? "Cadastro concluído" : "Aplicativo Imperium";
  window.ImperiumPWA?.atualizar();
  ($("instalacaoInstalar").hidden ? $("instalacaoContinuar") : $("instalacaoInstalar")).focus();
}
function ligarInstalacao(){
  $("instalacaoContinuar").addEventListener("click", () => {
    if(!sessaoAtual || !perfilValidado) return;
    limparInstalacao();
    entrar();
  });
}
function entrar(){
  if(sessaoAtual && instalacaoPendente === sessaoAtual.user.id){
    abrirInstalacao();
    return;
  }
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
function abrirSenha(primeiroAcesso){
  criandoSenha = primeiroAcesso;
  $("senhaForm").querySelector('button[type="submit"]').textContent = primeiroAcesso ? "Salvar e continuar" : "Salvar e entrar";
  $("senhaEtapa").textContent = primeiroAcesso ? "Etapa 3 de 3 · Crie sua senha" : "Escolha sua nova senha";
  $("senhaTitulo").textContent = primeiroAcesso ? "Crie sua senha" : "Redefina sua senha";
  $("senhaNovaRotulo").textContent = primeiroAcesso ? "Crie sua senha" : "Nova senha";
  $("senhaConfirmaRotulo").textContent = primeiroAcesso ? "Confirme sua senha" : "Confirmar nova senha";
  $("senhaSub").textContent = primeiroAcesso
    ? "E-mail confirmado. Crie sua senha para concluir seu acesso."
    : "Escolha uma nova senha para acessar a plataforma.";
  mostrar("senha");
  $("senhaNova").focus();
}
async function aplicarSessao(sessao){
  // Enquanto a pessoa confirma o código, eventos de uma conta salva não abrem o site.
  if(verificacaoAtiva) return;
  const atual = ++validacaoSessao;
  if(sessao){
    if(perfilValidado && sessaoAtual && sessaoAtual.user.id === sessao.user.id && senhaJaDefinida){
      sessaoAtual = sessao; return;
    }
    try{
      // getUser consulta o servidor: não confia só na sessão guardada no navegador.
      const { data, error } = await sb.auth.getUser();
      if(atual !== validacaoSessao) return;
      if(error && codigoConfirmadoPara(sessao.user.id)){
        abrirSenha(sessao.user.user_metadata?.convite_senha_pendente === true);
        erroSenha("Seu código foi confirmado. Confira a conexão e tente salvar a senha novamente.");
        return;
      }
      if(error || !data.user || !data.user.email_confirmed_at){
        sessaoAtual = null; perfilValidado = false; window.Imperium.perfil = null;
        await sb.auth.signOut();
        mostrar("login");
        erro(error ? "Não foi possível validar seu acesso. Confira a conexão e entre novamente." : "Confirme seu e-mail com o código recebido antes de entrar.");
        return;
      }
      // O código já comprovou este usuário. Pode escolher a senha sem uma consulta
      // extra; o estado real da senha continua obrigatório antes de abrir ferramentas.
      if(codigoConfirmadoPara(data.user.id)){
        sessaoAtual = sessao; perfilValidado = false;
        abrirSenha(data.user.user_metadata?.convite_senha_pendente === true);
        return;
      }
      // A presença real de senha vem do banco, mesmo que o celular perca o tipo do link
      // ou o marcador de primeiro acesso. A função só devolve um booleano para esta conta.
      const { data: senhaDefinida, error: erroEstadoSenha } = await sb.rpc("minha_senha_definida");
      if(atual !== validacaoSessao) return;
      if(erroEstadoSenha || typeof senhaDefinida !== "boolean"){
        sessaoAtual = null; perfilValidado = false; window.Imperium.perfil = null;
        mostrar("login");
        erro("Não foi possível conferir a etapa da senha. Tente novamente. Se continuar, peça ao administrador para instalar a atualização de confirmação de e-mail.");
        return;
      }
      if(!senhaDefinida || !senhaJaDefinida || etapaSenhaSalva() === data.user.id || data.user.user_metadata?.convite_senha_pendente === true){
        sessaoAtual = sessao; perfilValidado = false;
        if(!codigoConfirmadoPara(data.user.id)){
          abrirVerificacao(data.user.email);
          erroVerificacao("Digite o código do e-mail para concluir sua senha. Se ele já foi usado, toque em Receber novo código.", true);
          return;
        }
        abrirSenha(!senhaDefinida || data.user.user_metadata?.convite_senha_pendente === true);
        return;
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
  }
}

function iniciarSessaoNormal(){
  if(sessaoNormalIniciada) return;
  sessaoNormalIniciada = true;
  sb.auth.onAuthStateChange((evento, sessao)=>{
    if(evento === "SIGNED_OUT"){ limparEtapaSenha(); limparInstalacao(); }
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
  ligarFormularioVerificacao();
  ligarInstalacao();
  if(retornoPorLink){
    limparRetornoAuth();
    const email = verificacaoPendente?.email || "";
    // Um link antigo não troca o tipo nem reinicia a espera do último código pedido.
    abrirVerificacao(email);
    erroVerificacao("A confirmação agora é feita pelo código do e-mail. Digite-o abaixo ou solicite um novo código.", true);
    return;
  }
  // veio de um link de convite (só nome): mostra a tela de auto-cadastro e espera a pessoa
  // informar o e-mail. A sessão da nova conta só é criada pela validação do código.
  if(tokenConvite){ mostrar("cadastro"); return; }
  if(verificacaoPendente){
    abrirVerificacao(verificacaoPendente.email);
    erroVerificacao("Continue com o código recebido por e-mail. Se precisar, peça um novo.", true);
    return;
  }
  iniciarSessaoNormal();
}

document.addEventListener("DOMContentLoaded", iniciar);

window.ImperiumAuth = { abrirInstalacao, sair: async () => {
  limparEtapaSenha();
  limparVerificacao();
  limparInstalacao();
  try{ if(window.ImperiumPush) await window.ImperiumPush.desligarAparelho(true); }catch(_){}
  return sb.auth.signOut();
} };
})();
