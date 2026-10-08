/* Instalação da plataforma no computador e no celular.
   A confirmação nativa depende do navegador; sem ela, mostra o passo a passo. */
(function(){
"use strict";

const $ = id => document.getElementById(id);
let convite = null;
let instalando = false;
let instaladoNestaPagina = false;
let instrucoesAbertas = false;
const modoApp = window.matchMedia("(display-mode: standalone)");
const jaInstalado = () => instaladoNestaPagina || modoApp.matches || navigator.standalone === true;
const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

if("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

function orientacoes(){
  const ua = navigator.userAgent;
  if(ehIOS()) return { titulo: "No iPhone ou iPad", passos: [
    "Abra esta plataforma no Safari.",
    "Abra o menu Compartilhar e escolha Adicionar à Tela de Início.",
    "Se aparecer Abrir como App, mantenha essa opção ativada. Toque em Adicionar e abra pelo ícone Imperium."
  ] };
  if(/android/i.test(ua)) return { titulo: "No seu celular Android", passos: [
    "Abra esta plataforma no Chrome.",
    "Abra o menu de três pontos e escolha Instalar aplicativo ou Adicionar à tela inicial.",
    "Confirme a instalação e abra pelo ícone Imperium."
  ] };
  if(/Macintosh|Mac OS X/i.test(ua) && /Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua)){
    return { titulo: "No Mac com Safari", passos: [
      "No Safari, abra o menu Arquivo ou Compartilhar.",
      "Escolha Adicionar ao Dock, se essa opção estiver disponível.",
      "Confirme o nome Imperium e abra o aplicativo pelo Dock."
    ] };
  }
  return { titulo: "No seu computador", passos: [
    "Abra esta plataforma no Chrome ou no Microsoft Edge.",
    "Clique no ícone de instalação na barra de endereço ou procure Instalar aplicativo no menu do navegador.",
    "Confirme a instalação e abra a Imperium pelo menu de aplicativos ou pelo atalho criado."
  ] };
}

function mensagem(texto){
  const el = $("instalacaoStatus");
  if(!el) return;
  el.textContent = texto || "";
  el.hidden = !texto;
}

function atualizar(){
  const instalado = jaInstalado();
  const menu = $("instalarBtn");
  if(menu) menu.hidden = instalado;
  const btn = $("instalacaoInstalar");
  if(!btn) return;
  const guia = orientacoes();
  $("instalacaoTitulo").textContent = instalado ? "Aplicativo instalado" : "Instale o aplicativo";
  $("instalacaoDescricao").textContent = instalado
    ? "A Imperium já está disponível como aplicativo. Continue para acessar suas ferramentas."
    : "Acesse a Imperium direto pelo ícone no seu dispositivo.";
  $("instalacaoInstrucoesTitulo").textContent = guia.titulo;
  const lista = $("instalacaoPassos");
  lista.replaceChildren();
  guia.passos.forEach(texto => {
    const li = document.createElement("li");
    li.textContent = texto;
    lista.append(li);
  });
  $("instalacaoOrientacoes").hidden = instalado || !!convite || instalando || !instrucoesAbertas;
  btn.hidden = instalado || (!convite && instrucoesAbertas && !instalando);
  btn.disabled = instalando;
  btn.textContent = instalando ? "Aguardando confirmação…" : convite ? "Instalar aplicativo" : "Ver instruções de instalação";
  $("instalacaoContinuar").textContent = instalado ? "Entrar na plataforma" : "Continuar no navegador";
  if(instalado && document.activeElement === btn) $("instalacaoContinuar").focus();
}

async function instalar(){
  if(instalando || jaInstalado()) return;
  if(!convite){
    instrucoesAbertas = true;
    atualizar();
    $("instalacaoOrientacoes").focus();
    return;
  }
  const pedido = convite;
  convite = null; // Cada evento só permite uma chamada a prompt().
  instalando = true;
  mensagem("");
  atualizar();
  try{
    await pedido.prompt();
    const escolha = await pedido.userChoice;
    if(escolha?.outcome !== "accepted") instrucoesAbertas = true;
    if(!jaInstalado()) mensagem(escolha?.outcome === "accepted"
      ? "Finalize a instalação na janela do navegador. Depois, abra a Imperium pelo ícone do aplicativo."
      : "Você pode instalar depois. Para acessar agora, continue no navegador.");
  }catch(_){
    instrucoesAbertas = true;
    if(!jaInstalado()) mensagem("A instalação direta não ficou disponível. Siga as instruções da tela ou continue no navegador.");
  }finally{
    instalando = false;
    atualizar();
  }
}

window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  convite = e;
  atualizar();
});
window.addEventListener("appinstalled", () => {
  convite = null;
  instaladoNestaPagina = true;
  mensagem("Aplicativo instalado. Você já pode abrir a Imperium pelo novo ícone.");
  atualizar();
});
modoApp.addEventListener?.("change", atualizar);

document.addEventListener("DOMContentLoaded", () => {
  $("instalacaoInstalar")?.addEventListener("click", instalar);
  $("instalarBtn")?.addEventListener("click", () => window.ImperiumAuth?.abrirInstalacao());
  atualizar();
});
window.ImperiumPWA = { atualizar };
})();
