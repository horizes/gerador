/* Aplicativo instalável (PWA): registra o service worker e mostra o botão "Instalar aplicativo"
   no menu lateral (no Android/Chrome instala direto; no iPhone mostra o passo a passo). */
(function(){
"use strict";

if("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

const jaInstalado = () =>
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const ehIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

let convite = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); convite = e; mostrar(); });
window.addEventListener("appinstalled", () => { convite = null; esconder(); });

function botao(){ return document.getElementById("instalarBtn"); }
function esconder(){ const b = botao(); if(b) b.hidden = true; }
function mostrar(){ const b = botao(); if(b && !jaInstalado()) b.hidden = false; }

document.addEventListener("DOMContentLoaded", () => {
  const b = botao(); if(!b) return;
  if(jaInstalado()){ b.hidden = true; return; }
  if(ehIOS()) b.hidden = false;                      // iPhone não avisa sozinho: mostra as instruções
  b.addEventListener("click", async () => {
    if(convite){
      convite.prompt();
      try{ await convite.userChoice; }catch(_){}
      convite = null; esconder();
    }else if(ehIOS()){
      alert("Para instalar no iPhone/iPad:\n\n1. Abra este site no Safari.\n2. Toque no botão Compartilhar (quadrado com a seta para cima).\n3. Escolha \"Adicionar à Tela de Início\".");
    }else{
      alert("Para instalar: abra o menu do navegador (⋮) e escolha \"Instalar aplicativo\" ou \"Adicionar à tela inicial\".");
    }
  });
});
})();
