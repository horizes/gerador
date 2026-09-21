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

// Só mostra o módulo se: for admin (vê tudo), ou o nível da pessoa liberar esse módulo,
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

/* ---------- barra lateral ---------- */
function renderNav(id){
  const item = (rota, paths, rotulo, ativo) =>
    `<a class="sd-item" href="#/${rota}"${ativo ? ' aria-current="page"' : ""}>` +
    `<span class="sd-ico">${icone(paths)}</span><span class="sd-lbl">${rotulo}</span></a>`;
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
function homeFerramentas(){
  const grupos = agrupar(modulosVisiveis());
  if(!grupos.length){
    return `<p class="home-vazio">Você ainda não tem ferramentas liberadas. Fale com o administrador para pedir acesso.</p>`;
  }
  return grupos.map(g => `
    <h2 class="home-h">${g.cat.nome}</h2>
    <ul class="home-list">
      ${g.itens.map(m => `
      <li>
        <a class="mod-row" href="#/${m.id}">
          <span class="mod-ico">${icone(m.icone)}</span>
          <span class="mod-txt"><b>${m.nome}</b><small>${m.descricao}</small></span>
          <span class="btn ghost mod-go">Abrir</span>
        </a>
      </li>`).join("")}
    </ul>`).join("");
}

function telaInicial(){
  return `
  <section class="home">
    <h1 class="home-motto">A pessoa certa no lugar certo faz a diferença</h1>
    <p class="home-sub">Ferramentas internas da Imperium Terceirização e Serviços.</p>
    ${window.ImperiumDashboard ? window.ImperiumDashboard.html() : ""}
    ${homeFerramentas()}
  </section>`;
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
  ir();
}

// para a tela "Usuários" montar as checkboxes de cada nível (só as ferramentas de verdade,
// não a própria tela de admin)
function modulosConfiguraveis(){
  return agrupar(modulos.filter(m => !m.soAdmin))
    .flatMap(g => g.itens.map(m => ({ id: m.id, nome: m.nome, categoria: g.cat.nome })));
}

window.Platform = { register, iniciar, modulosConfiguraveis };
})();
