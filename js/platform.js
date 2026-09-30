/* Plataforma Imperium — registro de módulos, barra lateral, navegação e tela inicial.
   Cada ferramenta é um módulo em js/modules/ que se registra com Platform.register(...).
   A navegação usa o hash da URL (#/ e #/propostas), então funciona em qualquer hospedagem estática.
   A plataforma só é iniciada (Platform.iniciar) depois do login confirmado, por js/auth.js. */
(function(){
"use strict";

const modulos = [];
let atual = null;

const $ = id => document.getElementById(id);
const CHAVE_MENU = "imperium_menu";   // "open" | "closed" (preferência do menu lateral)

function register(m){ modulos.push(m); }

/* Classificação do menu lateral e da tela inicial. Cada ferramenta escolhe a sua com `categoria: "<id>"`
   no Platform.register. Para criar uma classificação nova, basta acrescentar uma linha aqui (a ordem desta
   lista é a ordem no menu). Ferramenta sem categoria, ou com uma que não existe, cai em "Outras ferramentas". */
const CATEGORIAS = [
  { id: "geradores",     nome: "Geradores" },
  { id: "financeiro",    nome: "Financeiro" },
  { id: "uniformes",     nome: "Uniformes e EPI" },
  { id: "configuracoes", nome: "Configurações" }
];
const CATEGORIA_OUTROS = { id: "outros", nome: "Outras ferramentas" };

const categoriaDe = m => CATEGORIAS.find(c => c.id === m.categoria) || CATEGORIA_OUTROS;

// [{cat, itens:[módulos]}] na ordem das categorias; categorias sem nenhuma ferramenta visível não aparecem
function agrupar(lista){
  return [...CATEGORIAS, CATEGORIA_OUTROS]
    .map(cat => ({ cat, itens: lista.filter(m => categoriaDe(m).id === cat.id) }))
    .filter(g => g.itens.length);
}

// Só mostra o módulo se: for admin (vê tudo), ou o cargo da pessoa liberar esse módulo,
// ou for uma ferramenta marcada soAdmin (ex.: "Usuários") — aí só admin mesmo vê.
function podeVer(m){
  const perfil = window.Imperium && window.Imperium.perfil;
  if(!perfil) return false;
  if(m.soAdmin) return perfil.admin;
  return perfil.podeVer(m.id);
}
function modulosVisiveis(){ return modulos.filter(podeVer); }

function rotaAtual(){
  return location.hash.replace(/^#\/?/, "").split("/")[0];
}

const icone = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICO_INICIO = '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h4v-6h4v6h4V10"/>';

/* ---------- avisos: número no menu e mensagem que aparece por cima da tela ---------- */
const badges = {};   // { idDoModulo: quantidade } — o módulo chama Platform.setBadge(id, n)
const textoBadge = n => n > 99 ? "99+" : String(n);

function setBadge(id, n){
  badges[id] = n > 0 ? n : 0;
  atualizarHomePendencias();
  const a = document.querySelector(`.sd-item[data-mod="${id}"]`);
  if(a){
    let b = a.querySelector(".sd-badge");
    if(!badges[id]){ if(b) b.remove(); a.removeAttribute("data-badge"); }
    else{
      if(!b){ b = document.createElement("span"); b.className = "sd-badge"; a.appendChild(b); }
      b.textContent = textoBadge(badges[id]);
      a.setAttribute("data-badge", "1");
    }
  }
  const mb = $("menu");
  if(mb) mb.classList.toggle("has-badge", Object.values(badges).some(v => v > 0));
}

// Mensagem rápida no canto da tela. Com `href`, vira um link (ex.: "#/uniforme_gestao"). Some sozinha em 8 s.
function toast(texto, href){
  let box = $("toasts");
  if(!box){
    box = document.createElement("div");
    box.id = "toasts"; box.className = "toasts";
    box.setAttribute("aria-live", "polite");
    document.body.appendChild(box);
  }
  const t = document.createElement(href ? "a" : "div");
  t.className = "toast";
  if(href) t.href = href;
  t.textContent = texto;
  box.appendChild(t);
  const sumir = () => { t.classList.add("out"); setTimeout(() => t.remove(), 300); };
  const timer = setTimeout(sumir, 8000);
  t.addEventListener("click", () => { clearTimeout(timer); t.remove(); });
}

/* ---------- barra lateral ---------- */
function renderNav(id){
  const item = (rota, paths, rotulo, ativo) => {
    const n = badges[rota] || 0;
    return `<a class="sd-item" href="#/${rota}" data-mod="${rota}"${n ? ' data-badge="1"' : ""}${ativo ? ' aria-current="page"' : ""}>` +
      `<span class="sd-ico">${icone(paths)}</span><span class="sd-lbl">${rotulo}</span>` +
      (n ? `<span class="sd-badge">${textoBadge(n)}</span>` : "") + `</a>`;
  };
  const grupos = agrupar(modulosVisiveis());
  $("nav").innerHTML =
    item("", ICO_INICIO, "Início", id === "") +
    grupos.map(g => `
    <div class="sd-group" role="group" aria-labelledby="cat-${g.cat.id}">
      <div class="sd-cat" id="cat-${g.cat.id}"><span class="sd-cat-lbl">${g.cat.nome}</span></div>
      ${g.itens.map(m => item(m.id, m.icone, m.menu, id === m.id)).join("")}
    </div>`).join("");
}

function lerPreferencia(){
  try{ return localStorage.getItem(CHAVE_MENU) !== "closed"; }catch(e){ return true; }
}
function aplicarMenu(aberto){
  $("shell").classList.toggle("is-open", aberto);
  const b = $("sidetoggle");
  b.setAttribute("aria-pressed", String(aberto));
  b.querySelector(".sd-lbl").textContent = aberto ? "Recolher menu" : "Fixar menu aberto";
}
function alternarMenu(){
  const aberto = !$("shell").classList.contains("is-open");
  aplicarMenu(aberto);
  try{ localStorage.setItem(CHAVE_MENU, aberto ? "open" : "closed"); }catch(e){}
}

/* gaveta (celular e tablet) */
function gaveta(abrir){
  $("shell").classList.toggle("drawer-open", abrir);
  document.body.classList.toggle("no-scroll", abrir);
  $("menu").setAttribute("aria-expanded", String(abrir));
  if(abrir){ const a = document.querySelector(".sd-item[aria-current]") || document.querySelector(".sd-item"); if(a) a.focus(); }
}

/* ---------- tela inicial ---------- */
const escHome = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const HOME_ACOES = {
  propostas: { titulo:"Preparar proposta", texto:"Monte e exporte uma proposta comercial.", acao:"Criar proposta" },
  fluxo: { titulo:"Acompanhar o caixa", texto:"Consulte lançamentos, saldos e movimentações.", acao:"Abrir financeiro" },
  uniforme_solicitar: { titulo:"Meus uniformes e EPIs", texto:"Solicite seu kit e confirme o recebimento.", acao:"Ver meus pedidos" },
  uniforme_gestao: { titulo:"Gerenciar solicitações", texto:"Atenda pedidos e organize os kits da equipe.", acao:"Ver solicitações" },
  usuarios: { titulo:"Acessos da equipe", texto:"Gerencie pessoas, cargos e permissões.", acao:"Gerenciar acessos" }
};
function homeFerramentas(){
  const lista = modulosVisiveis();
  if(!lista.length) return `<p class="home-vazio">Você ainda não tem ferramentas liberadas. Fale com o administrador para pedir acesso.</p>`;
  return `<div class="home-section-head"><div><span class="home-eyebrow">Acesso rápido</span><h2>O que você precisa fazer?</h2></div><span class="home-count">${lista.length} ${lista.length === 1 ? "ferramenta disponível" : "ferramentas disponíveis"}</span></div>
    <ul class="home-tools">${lista.map(m => {
      const info = HOME_ACOES[m.id] || { titulo:m.nome, texto:m.descricao, acao:"Abrir ferramenta" };
      return `<li><a class="home-tool" href="#/${m.id}">
        <div class="home-tool-top"><span class="mod-ico">${icone(m.icone)}</span><span class="home-tool-category">${escHome(categoriaDe(m).nome)}</span></div>
        <h3>${escHome(info.titulo)}</h3><p>${escHome(info.texto)}</p>
        <span class="home-tool-action">${escHome(info.acao)} <span aria-hidden="true">↗</span></span>
      </a></li>`;
    }).join("")}</ul>`;
}
function homePendencias(){
  const itens = modulosVisiveis().filter(m => m.id === 'uniforme_solicitar' || m.id === 'uniforme_gestao');
  if(!itens.length) return '';
  const conhecidas = itens.every(m => Object.prototype.hasOwnProperty.call(badges, m.id));
  const pendentes = itens.filter(m => badges[m.id] > 0);
  return `<div class="home-attention-head"><span class="home-attention-dot" aria-hidden="true"></span><h2>Precisa da sua atenção</h2></div>
    ${pendentes.length ? `<div class="home-attention-list">${pendentes.map(m => `<a href="#/${m.id}" class="home-attention-item"><span><b>${badges[m.id]} ${m.id === 'uniforme_gestao' ? 'pedido(s) aguardando atendimento' : 'pedido(s) disponível(is) para recebimento'}</b><small>${m.id === 'uniforme_gestao' ? 'Confira as solicitações de uniforme e EPI da equipe.' : 'Confira os itens liberados e registre o recebimento.'}</small></span><span aria-hidden="true">→</span></a>`).join('')}</div>` : `<p class="home-attention-empty">${conhecidas ? 'Nenhuma pendência de uniformes e EPI neste momento.' : 'Abra suas solicitações para conferir o andamento dos pedidos.'}</p>`}`;
}
function atualizarHomePendencias(){
  const el = $('homePendencias');
  if(el) el.innerHTML = homePendencias();
}
function telaInicial(){
  const perfil = window.Imperium.perfil;
  const nome = String(perfil.nome || '').trim().split(/\s+/)[0];
  const d = new Date();
  const saudacao = d.getHours() < 12 ? 'Bom dia' : d.getHours() < 18 ? 'Boa tarde' : 'Boa noite';
  const data = d.toLocaleDateString('pt-BR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const acessos = modulosVisiveis();
  const ordem = acessos.some(m => m.id === 'uniforme_gestao') ? ['uniforme_gestao','fluxo','propostas','uniforme_solicitar','usuarios'] : ['uniforme_solicitar','fluxo','propostas','usuarios'];
  const destaques = ordem.map(id => acessos.find(m => m.id === id)).filter(Boolean).slice(0,2);
  return `<main class="home">
    <header class="home-header"><div><span class="home-eyebrow">Imperium · Seu espaço de trabalho</span>
      <h1>${saudacao}${nome ? ', ' + escHome(nome) : ''}.</h1>
      <p>Suas ferramentas e informações importantes, em um só lugar.</p></div>
      <div class="home-date"><span>Hoje</span><time datetime="${window.Imperium.hojeLocal()}">${escHome(data)}</time></div>
    </header>
    ${destaques.length ? `<div class="home-shortcuts" aria-label="Atalhos principais">${destaques.map((m,i) => `<a class="btn ${i ? 'ghost' : ''}" href="#/${m.id}">${escHome(HOME_ACOES[m.id].acao)}</a>`).join('')}</div>` : ''}
    ${acessos.some(m => m.id === 'uniforme_solicitar' || m.id === 'uniforme_gestao') ? `<section id="homePendencias" class="home-attention" aria-live="polite" aria-atomic="true">${homePendencias()}</section>` : ''}
    <section class="home-tools-section" aria-label="Ferramentas disponíveis">${homeFerramentas()}</section>
    ${window.ImperiumDashboard ? window.ImperiumDashboard.html() : ''}
    <footer class="home-footer">Imperium Terceirização e Serviços <span>A pessoa certa no lugar certo faz a diferença.</span></footer>
  </main>`;
}

/* ---------- rotas ---------- */
function ir(){
  const id = rotaAtual();
  const m = modulosVisiveis().find(x => x.id === id) || null; // também barra acesso direto pela URL
  if(id && !m) history.replaceState(null, "", "#/");

  if(atual && atual.unmount) atual.unmount();
  atual = m;
  gaveta(false);

  const view = $("view");
  view.innerHTML = "";
  if(m){
    document.title = m.nome + " — Imperium";
    const raiz = document.createElement("div");
    view.appendChild(raiz);
    m.mount(raiz);
  }else{
    document.title = "Imperium — Plataforma";
    view.innerHTML = telaInicial();
    if(window.ImperiumDashboard) window.ImperiumDashboard.montar();
  }
  $("shell").classList.toggle("in-module", !!m);
  // Tela inicial: o menu fica sempre aberto (recolher não ajuda ali). Dentro das ferramentas vale a
  // preferência salva da pessoa. No celular/tablet o menu é a gaveta, que não depende disso.
  aplicarMenu(m ? lerPreferencia() : true);
  renderNav(m ? m.id : "");

  view.classList.remove("enter"); void view.offsetWidth; view.classList.add("enter");
  window.scrollTo(0, 0);
}

let iniciado = false;
function iniciar(){
  if(iniciado) return; // evita reiniciar se o login disparar mais de uma vez
  iniciado = true;
  aplicarMenu(lerPreferencia());
  $("sidetoggle").addEventListener("click", alternarMenu);
  $("menu").addEventListener("click", () => gaveta(!$("shell").classList.contains("drawer-open")));
  $("scrim").addEventListener("click", () => gaveta(false));
  const sair = $("sairBtn");
  if(sair) sair.addEventListener("click", () => window.ImperiumAuth && window.ImperiumAuth.sair());
  document.addEventListener("keydown", e => {
    if(e.key === "Escape" && $("shell").classList.contains("drawer-open")){ gaveta(false); $("menu").focus(); }
  });
  window.addEventListener("hashchange", ir);
  // módulos que precisam de algo assim que a pessoa entra (ex.: contar pedidos novos para o número do menu)
  modulosVisiveis().forEach(m => { if(m.aoIniciar){ try{ m.aoIniciar(); }catch(e){} } });
  ir();
}

// para a tela "Usuários" montar as checkboxes de cada cargo (só as ferramentas de verdade,
// não a própria tela de admin)
function modulosConfiguraveis(){
  return agrupar(modulos.filter(m => !m.soAdmin))
    .flatMap(g => g.itens.map(m => ({ id: m.id, nome: m.nome, categoria: g.cat.nome })));
}

window.Platform = { register, iniciar, modulosConfiguraveis, setBadge, toast };
})();
