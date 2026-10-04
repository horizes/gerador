/* Service worker da Plataforma Imperium.
   Objetivo: tornar o site instalável como aplicativo e abrir mais rápido.
   Estratégia "rede primeiro": sempre tenta buscar a versão nova no servidor (assim toda atualização
   que você publicar chega sozinha) e só usa a cópia guardada se estiver sem internet.
   NÃO mexe em nada de outro domínio — login, banco de dados (Supabase) e Open Finance passam direto. */
const VERSAO = "imperium-v21";

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
