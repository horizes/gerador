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
const retornoAuth = new URLSearchParams(location.search);
let tipoLinkAuth = retornoAuth.get("type") || parametrosAuth.get("type");
const linkConfirmacaoPresente = retornoAuth.has("token_hash");
let tokenConfirmacao = retornoAuth.get("token_hash");
let senhaJaDefinida = !["invite","recovery"].includes(tipoLinkAuth);
let verificacaoAtiva = false;
let verificacaoEmAndamento = false;
let modoVerificacao = "codigo";

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
  $("verificacao").style.display = tela === "verificacao" ? "flex" : "none";
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

function abrirVerificacao(modo, email){
  if(verificacaoEmAndamento) return;
  verificacaoAtiva = true;
  ++validacaoSessao;
  modoVerificacao = modo;
  const codigo = modo === "codigo";
  $("verificacaoCampos").hidden = !codigo;
  $("verificacaoEmail").disabled = $("verificacaoToken").disabled = !codigo;
  $("verificacaoEmail").required = $("verificacaoToken").required = codigo;
  $("verificacaoCodigo").hidden = codigo;
  $("verificacaoReenviar").hidden = !codigo;
  $("verificacaoTitulo").textContent = codigo ? "Código do e-mail" : "Confirme seu e-mail";
  $("verificacaoSub").textContent = codigo
    ? "Digite o código recebido para confirmar seu e-mail e escolher sua senha."
    : "Toque abaixo para confirmar seu e-mail e escolher sua senha.";
  $("verificacaoConfirmar").textContent = codigo ? "Confirmar código" : "Confirmar e criar senha";
  if(email) $("verificacaoEmail").value = email;
  erroVerificacao("");
  mostrar("verificacao");
}

function bloquearVerificacao(bloqueado){
  ["verificacaoConfirmar", "verificacaoCodigo", "verificacaoReenviar", "verificacaoVoltar"].forEach(id => {
    $(id).disabled = bloqueado;
  });
}

function mensagemVerificacao(error){
  if(error?.status === 429 || error?.code === "over_email_send_rate_limit" || error?.code === "over_request_rate_limit"){
    return "Muitas tentativas. Aguarde um pouco e tente novamente.";
  }
  if(error?.code === "otp_expired" || error?.code === "validation_failed"){
    return "Este link ou código expirou ou já foi usado. Use o último e-mail recebido ou solicite um novo código.";
  }
  return "Não foi possível confirmar o acesso. Confira a conexão e tente novamente. Se o link já foi usado, solicite um novo código.";
}

function ligarFormularioVerificacao(){
  const form = $("verificacaoForm");
  if(form.dataset.ligado) return;
  form.dataset.ligado = "1";
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if(verificacaoEmAndamento) return;
    erroVerificacao("");
    let dados;
    if(modoVerificacao === "link"){
      if(!["invite", "recovery"].includes(tipoLinkAuth) || !tokenConfirmacao ||
        tokenConfirmacao.length > 512 || !/^[a-z0-9_-]+$/i.test(tokenConfirmacao)){
        erroVerificacao("Link incompleto. Use o código do e-mail ou solicite um novo código."); return;
      }
      dados = { token_hash: tokenConfirmacao, type: tipoLinkAuth };
    }else{
      const email = $("verificacaoEmail").value.trim().toLowerCase();
      const token = $("verificacaoToken").value.trim();
      if(email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
        erroVerificacao("Digite o e-mail que recebeu o código."); return;
      }
      if(!/^\d{6}$/.test(token)){
        erroVerificacao("Digite os 6 números do código recebido."); return;
      }
      // "email" aceita o código nativo de convite ou recuperação; não cria contas.
      dados = { email, token, type: "email" };
    }
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
      const { data: confirmado, error: erroUsuario } = await sb.auth.getUser();
      if(erroUsuario || !confirmado?.user?.email_confirmed_at || confirmado.user.id !== data.session.user.id){
        erroVerificacao("Não foi possível validar a confirmação. Confira a conexão e tente novamente."); return;
      }
      tokenConfirmacao = null;
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
  $("verificacaoCodigo").addEventListener("click", () => abrirVerificacao("codigo", $("loginEmail").value));
  $("verificacaoReenviar").addEventListener("click", async () => {
    if(verificacaoEmAndamento) return;
    const email = $("verificacaoEmail").value.trim().toLowerCase();
    if(email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      erroVerificacao("Digite seu e-mail para receber um novo código."); return;
    }
    verificacaoEmAndamento = true;
    bloquearVerificacao(true);
    const btn = $("verificacaoReenviar"), txt = btn.textContent;
    btn.textContent = "Enviando…";
    erroVerificacao("");
    try{
      const { error } = await sb.auth.resetPasswordForEmail(email);
      if(error){ erroVerificacao(mensagemVerificacao(error)); return; }
      $("verificacaoToken").value = "";
      erroVerificacao("Se esse e-mail tiver uma conta, enviamos um novo código. Use o último e-mail recebido.", true);
    }catch(_){ erroVerificacao("Não foi possível solicitar o código. Confira sua conexão e tente novamente."); }
    finally{
      verificacaoEmAndamento = false;
      bloquearVerificacao(false);
      btn.textContent = txt;
    }
  });
  $("verificacaoVoltar").addEventListener("click", () => {
    if(verificacaoEmAndamento) return;
    tokenConfirmacao = null;
    limparRetornoAuth();
    verificacaoAtiva = false;
    mostrar("login");
    iniciarSessaoNormal();
  });
  $("loginCodigo").addEventListener("click", () => abrirVerificacao("codigo", $("loginEmail").value));
  $("confirmacaoCodigo").addEventListener("click", () => abrirVerificacao("codigo", $("confirmacaoEmail").textContent));
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
    else{
      abrirVerificacao("codigo", email);
      erroVerificacao("Se esse e-mail tiver uma conta, enviamos um link e um código para redefinir a senha.", true);
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
      if(erroUsuario || !data.user || !data.user.email_confirmed_at){
        erroSenha("Abra o link de confirmação recebido no seu e-mail para criar a senha."); return;
      }
      const { error } = await sb.auth.updateUser({ password: nova, data: { convite_senha_pendente: false } });
      if(error){ erroSenha(error.message); return; }
      limparRetornoAuth();
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
  // Enquanto a pessoa confirma um link/código, eventos de uma conta salva não abrem o site.
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
      if(error || !data.user || !data.user.email_confirmed_at){
        sessaoAtual = null; perfilValidado = false; window.Imperium.perfil = null;
        await sb.auth.signOut();
        mostrar("login");
        erro(error ? "Não foi possível validar seu acesso. Confira a conexão e entre novamente." : "Confirme seu e-mail pelo link recebido antes de entrar.");
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
      if(!senhaDefinida || !senhaJaDefinida || data.user.user_metadata?.convite_senha_pendente === true){
        sessaoAtual = sessao; perfilValidado = false;
        const primeiroAcesso = !senhaDefinida || tipoLinkAuth === "invite" || data.user.user_metadata?.convite_senha_pendente === true;
        $("senhaTitulo").textContent = primeiroAcesso ? "Crie sua senha" : "Redefina sua senha";
        $("senhaNovaRotulo").textContent = primeiroAcesso ? "Crie sua senha" : "Nova senha";
        $("senhaConfirmaRotulo").textContent = primeiroAcesso ? "Confirme sua senha" : "Confirmar nova senha";
        $("senhaSub").textContent = primeiroAcesso
          ? "E-mail confirmado. Crie sua senha para concluir seu acesso."
          : "Escolha uma nova senha para acessar a plataforma.";
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
  ligarFormularioVerificacao();
  if(linkConfirmacaoPresente){
    // Guardar apenas na memória da aba e retirar o segredo da barra de endereço.
    limparRetornoAuth();
    abrirVerificacao("link");
    return;
  }
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
