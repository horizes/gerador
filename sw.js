/* Service worker da Plataforma Imperium.
   Objetivo: tornar o site instalável como aplicativo e abrir mais rápido.
   Estratégia "rede primeiro": sempre tenta buscar a versão nova no servidor (assim toda atualização
   que você publicar chega sozinha) e só usa a cópia guardada se estiver sem internet.
   NÃO mexe em nada de outro domínio — login, banco de dados (Supabase) e Open Finance passam direto. */
const VERSAO = "imperium-v44";

const BASICO = [
  "./",
  "index.html",
  "manifest.json",
  "assets/logo.jpg",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSAO).then(c => c.addAll(BASICO)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;      // Supabase, fontes, CDN: direto na rede

  // Links de confirmação contêm um segredo de uso único. Não guardar essa URL no cache.
  if(url.searchParams.has("token_hash")){
    e.respondWith(fetch(req, {cache:"no-store"}));
    return;
  }

  e.respondWith(
    fetch(req)
      .then(res => {
        if(res && res.ok){
          const copia = res.clone();
          caches.open(VERSAO).then(c => c.put(req, copia)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req, {ignoreSearch:false}).then(r =>
          r || (req.mode === "navigate" ? caches.match("index.html") : Response.error())
        )
      )
  );
});

/* Recebido pelo sistema mesmo sem nenhuma aba aberta. Links ficam dentro desta plataforma. */
const ROTAS_PUSH = new Set(['','uniforme_solicitar','uniforme_gestao']);
self.addEventListener('push', event => {
 let payload={};try{payload=event.data?.json()||{};}catch{}
 const route=ROTAS_PUSH.has(payload.route)?payload.route:'';
 event.waitUntil(self.registration.showNotification(String(payload.title||'Imperium — novo aviso').slice(0,120),{
  body:String(payload.body||'Acesse a plataforma para conferir.').slice(0,300),
  icon:new URL('assets/icons/icon-192.png',self.registration.scope).href,
  badge:new URL('assets/icons/icon-192.png',self.registration.scope).href,
  tag:String(payload.tag||'imperium-aviso').slice(0,80),
  data:{url:self.registration.scope+'#/'+route}
 }));
});
self.addEventListener('notificationclick', event => {
 event.notification.close();
 event.waitUntil((async()=>{
  const scope=self.registration.scope;let url=scope+'#/';
  try{const target=new URL(event.notification.data?.url||url);
   if(target.origin===new URL(scope).origin&&target.pathname===new URL(scope).pathname&&ROTAS_PUSH.has(target.hash.replace(/^#\//,'')))url=target.href;
  }catch{}
  const abertas=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const janela=abertas.find(c=>c.url.startsWith(scope));
  if(janela){const navegada=await janela.navigate(url);return (navegada||janela).focus();}
  return self.clients.openWindow(url);
 })());
});
