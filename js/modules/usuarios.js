/* Usuários — módulo de administração (só aparece para quem é "admin").
   Duas partes:
   - Pessoas: lista todas as contas que existem no Supabase (Authentication > Users), mostra se cada
     uma PODE LOGAR de fato (conta ativa no site, e-mail confirmado, não suspensa) e permite, ali mesmo,
     ligar/desligar cada ferramenta para a pessoa, trocar papel (admin/usuário), nível e ativar/bloquear.
     Toda alteração é salva na hora (sem botão "Salvar").
   - Níveis de permissão: grupos opcionais (ex.: "Financeiro", "Comercial") que liberam um conjunto de
     ferramentas de uma vez para todo mundo que estiver naquele nível.
   Acesso final de uma pessoa a uma ferramenta = admin OU nível libera OU permissão direta.
   Veja supabase-schema-permissoes.sql e supabase-schema-usuarios.sql para o que precisa existir no banco. */
(function(){
"use strict";

const sb = () => window.Imperium.supabase;
const MODULOS = () => window.Platform.modulosConfiguraveis(); // [{id,nome}]
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const semAcento = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

let root = null;
let niveis = [];        // [{id,nome}]
let nivelModulos = {};  // { nivel_id: Set(modulo_id) }
let pessoas = [];       // [{id,email,nome,papel,nivel_id,ativo,criado_em,ultimo_acesso,email_confirmado_em,suspenso_ate,diretos:Set}]
let cargos = [];        // [{id,nome,ativo}] — cargos do módulo de uniformes/EPI (vazio até rodar supabase-schema-uniformes.sql)
let cargosOk = false;   // a tabela de cargos existe e pôde ser lida?
let filtro = "todos";   // todos | logam | bloqueados | admins
let busca = "";
let toastTimer = null;

const q = sel => root && root.querySelector(sel);

/* ---------- formatação ---------- */
const fmtData = new Intl.DateTimeFormat("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric" });
const fmtDataHora = new Intl.DateTimeFormat("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });

function quandoAcessou(iso){
  if(!iso) return "Nunca entrou";
  const d = new Date(iso), min = Math.floor((Date.now() - d.getTime()) / 60000);
  if(min < 2) return "Agora há pouco";
  if(min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if(h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  if(dias < 30) return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
  return fmtData.format(d);
}

/* ---------- regras de exibição ---------- */
// A pessoa consegue mesmo entrar no site? Três coisas precisam estar certas:
// e-mail confirmado e conta não suspensa (isso é do Supabase Auth) e "ativo" ligado aqui no site.
function statusLogin(p){
  if(p.suspenso_ate && new Date(p.suspenso_ate) > new Date()) return { k:"bad",  t:"Suspensa no Supabase", pode:false };
  if(!p.email_confirmado_em)                                   return { k:"warn", t:"E-mail não confirmado", pode:false };
  if(!p.ativo)                                                 return { k:"bad",  t:"Bloqueada no site", pode:false };
  return { k:"ok", t:"Pode logar", pode:true };
}

// Como a pessoa recebe cada ferramenta: por ser admin, pelo nível ou por permissão direta.
function acesso(p, moduloId){
  if(p.papel === "admin") return { tem:true, origem:"admin" };
  if(p.nivel_id && nivelModulos[p.nivel_id] && nivelModulos[p.nivel_id].has(moduloId)) return { tem:true, origem:"nivel" };
  if(p.diretos.has(moduloId)) return { tem:true, origem:"direto" };
  return { tem:false, origem:null };
}

const nomeNivel = id => { const n = niveis.find(x => x.id === id); return n ? n.nome : ""; };
const souEu = p => p.id === window.Imperium.perfil.id;

/* ---------- esqueleto ---------- */
function skel(){
  return `
  <section class="usr-wrap">
    <div class="usr-top">
      <div>
        <h1 class="mod-h">Usuários</h1>
        <p class="mod-sub">Veja quem tem conta na plataforma, quem consegue entrar e o que cada pessoa pode usar. As alterações são salvas na hora.</p>
      </div>
      <button class="btn ghost" type="button" id="usrAtualizar">Atualizar lista</button>
    </div>

    <div id="usrAviso"></div>
    <div class="usr-resumo" id="usrResumo"></div>

    <div class="usr-card">
      <h2 class="usr-h">Pessoas</h2>
      <p class="usr-hint">Contas novas são criadas no painel do Supabase (Authentication &gt; Users) e aparecem aqui sozinhas. Quem acabou de ser criado não tem acesso a nenhuma ferramenta até você liberar.</p>
      <div class="usr-tools">
        <input type="search" id="usrBusca" placeholder="Buscar por nome ou e-mail…" autocomplete="off">
      </div>
      <div id="usrLista" class="usr-lista"><p class="usr-hint">Carregando…</p></div>
    </div>

    <div class="usr-card">
      <h2 class="usr-h">Níveis de permissão</h2>
      <p class="usr-hint">Opcional. Um nível é um grupo: quem estiver nele recebe todas as ferramentas marcadas, e mudar o nível vale para todos de uma vez. Admin vê tudo, sem precisar de nível.</p>
      <div id="usrNiveis"></div>
      <form id="usrNovoNivel" class="usr-novo-nivel">
        <input type="text" id="usrNomeNivel" placeholder="Nome do novo nível (ex.: Financeiro)" required maxlength="60">
        <button class="btn ghost" type="submit">+ Criar nível</button>
      </form>
    </div>

    <div class="usr-toast" id="usrToast" role="status" aria-live="polite"></div>
  </section>`;
}

function aviso(msg, tipo){
  const el = q("#usrToast"); if(!el) return;
  el.textContent = msg;
  el.className = "usr-toast show " + (tipo || "ok");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if(el) el.classList.remove("show"); }, tipo === "erro" ? 6000 : 2600);
}
const erroTxt = e => (e && e.message) ? e.message : "erro desconhecido";

/* ---------- resumo (também funciona como filtro) ---------- */
function contagens(){
  const c = { todos: pessoas.length, logam: 0, bloqueados: 0, admins: 0 };
  pessoas.forEach(p => {
    if(statusLogin(p).pode) c.logam++; else c.bloqueados++;
    if(p.papel === "admin") c.admins++;
  });
  return c;
}

function renderResumo(){
  const c = contagens();
  const item = (k, n, rotulo) =>
    `<button type="button" class="usr-stat ${filtro === k ? "on" : ""}" data-filtro="${k}" aria-pressed="${filtro === k}">` +
    `<b>${n}</b><span>${rotulo}</span></button>`;
  q("#usrResumo").innerHTML =
    item("todos", c.todos, "Contas") +
    item("logam", c.logam, "Podem logar") +
    item("bloqueados", c.bloqueados, "Sem acesso ao site") +
    item("admins", c.admins, "Admins");
}

/* ---------- pessoas ---------- */
function optsNiveis(selecionado){
  return `<option value="">— sem nível —</option>` +
    niveis.map(n => `<option value="${n.id}" ${n.id === selecionado ? "selected" : ""}>${esc(n.nome)}</option>`).join("");
}

// só cargos ativos, mais o cargo atual da pessoa (mesmo desativado, para não parecer que ela ficou sem cargo)
function optsCargos(selecionado){
  return `<option value="">— sem cargo —</option>` +
    cargos.filter(c => c.ativo || c.id === selecionado)
      .map(c => `<option value="${c.id}" ${c.id === selecionado ? "selected" : ""}>${esc(c.nome)}${c.ativo ? "" : " (desativado)"}</option>`).join("");
}

function htmlFerramenta(p, m){
  const a = acesso(p, m.id);
  const trava = a.origem === "admin" || a.origem === "nivel";
  const nota = a.origem === "admin" ? "Admin acessa tudo"
             : a.origem === "nivel" ? `Pelo nível ${esc(nomeNivel(p.nivel_id))}`
             : "";
  return `
  <label class="usr-sw usr-sis ${trava ? "is-lock" : ""}" ${trava ? `title="${nota}. Para tirar, mude o papel/nível da pessoa."` : ""}>
    <input type="checkbox" data-mod="${esc(m.id)}" ${a.tem ? "checked" : ""} ${trava ? "disabled" : ""}>
    <span class="usr-sw-track" aria-hidden="true"></span>
    <span class="usr-sw-txt">${esc(m.nome)}${nota ? `<small>${nota}</small>` : ""}</span>
  </label>`;
}

function htmlPessoa(p){
  const eu = souEu(p);
  const st = statusLogin(p);
  const mods = MODULOS();
  const liberadas = mods.filter(m => acesso(p, m.id).tem).length;
  const semFerramenta = p.papel !== "admin" && liberadas === 0;
  const inicial = (p.nome || p.email || "?").trim().charAt(0).toUpperCase();
  const lockSelf = eu ? ` disabled title="Você não pode alterar o próprio papel"` : ` title="Admin vê todas as ferramentas e gerencia os usuários"`;

  return `
  <article class="usr-pessoa ${st.pode ? "" : "sem-acesso"}" data-id="${p.id}">
    <header class="usr-p-head">
      <span class="usr-avatar" aria-hidden="true">${esc(inicial)}</span>
      <div class="usr-p-id">
        <input type="text" class="usr-nome" data-f="nome" value="${esc(p.nome)}" placeholder="Nome" maxlength="80" aria-label="Nome de ${esc(p.email)}">
        <span class="usr-email">${esc(p.email)}</span>
      </div>
      <div class="usr-badges">
        <span class="usr-badge ${st.k}">${st.t}</span>
        ${p.papel === "admin" ? `<span class="usr-badge gold">Admin</span>` : ""}
        ${eu ? `<span class="usr-badge neutro">Você</span>` : ""}
        ${semFerramenta && st.pode ? `<span class="usr-badge warn">Sem ferramentas liberadas</span>` : ""}
      </div>
      <label class="usr-sw usr-ativo" ${eu ? `title="Você não pode desativar a si mesmo"` : `title="Desligado = a pessoa não consegue mais entrar nem ver dados"`}>
        <input type="checkbox" data-f="ativo" ${p.ativo ? "checked" : ""} ${eu ? "disabled" : ""}>
        <span class="usr-sw-track" aria-hidden="true"></span>
        <span class="usr-sw-txt">Acesso ao site</span>
      </label>
    </header>

    <div class="usr-p-body ${cargosOk ? "com-cargo" : ""}">
      <div class="usr-campo">
        <label for="papel-${p.id}">Papel</label>
        <select id="papel-${p.id}" data-f="papel"${lockSelf}>
          <option value="usuario" ${p.papel === "usuario" ? "selected" : ""}>Usuário</option>
          <option value="admin" ${p.papel === "admin" ? "selected" : ""}>Admin</option>
        </select>
      </div>
      <div class="usr-campo">
        <label for="nivel-${p.id}">Nível</label>
        <select id="nivel-${p.id}" data-f="nivel_id" ${p.papel === "admin" ? "disabled title='Admin já vê tudo'" : ""}>${optsNiveis(p.nivel_id)}</select>
      </div>
      ${cargosOk ? `<div class="usr-campo">
        <label for="cargo-${p.id}">Cargo</label>
        <select id="cargo-${p.id}" data-f="cargo_id" title="Define o kit de uniforme e EPI que a pessoa pode solicitar">${optsCargos(p.cargo_id)}</select>
      </div>` : ""}
      <div class="usr-campo usr-ferr">
        <label>Ferramentas que ela pode usar</label>
        <div class="usr-ferr-lista">
          ${mods.length ? mods.map(m => htmlFerramenta(p, m)).join("") : `<p class="usr-hint">Nenhuma ferramenta registrada ainda.</p>`}
        </div>
      </div>
    </div>

    <footer class="usr-p-meta">
      <span title="${p.ultimo_acesso ? fmtDataHora.format(new Date(p.ultimo_acesso)) : ""}">Último acesso: <b>${quandoAcessou(p.ultimo_acesso)}</b></span>
      <span>Conta criada em ${fmtData.format(new Date(p.criado_em))}</span>
    </footer>
  </article>`;
}

function pessoasFiltradas(){
  const termo = semAcento(busca.trim());
  return pessoas.filter(p => {
    if(filtro === "logam" && !statusLogin(p).pode) return false;
    if(filtro === "bloqueados" && statusLogin(p).pode) return false;
    if(filtro === "admins" && p.papel !== "admin") return false;
    if(termo && !(semAcento(p.nome).includes(termo) || semAcento(p.email).includes(termo))) return false;
    return true;
  });
}

function renderPessoas(){
  const lista = q("#usrLista"); if(!lista) return;
  renderResumo();
  const v = pessoasFiltradas();
  lista.innerHTML = v.length
    ? v.map(htmlPessoa).join("")
    : `<p class="usr-vazio">${pessoas.length ? "Ninguém corresponde a esse filtro." : "Nenhuma conta ainda. Crie em Authentication &gt; Users no Supabase e clique em “Atualizar lista”."}</p>`;
}

// atualiza só o cartão de uma pessoa (não perde o foco da busca nem a posição da rolagem)
function renderCartao(id){
  const p = pessoas.find(x => x.id === id);
  const el = root && root.querySelector(`.usr-pessoa[data-id="${id}"]`);
  if(!p || !el) return;
  el.outerHTML = htmlPessoa(p);
  renderResumo();
}

async function carregarPessoas(){
  const { data, error } = await sb().rpc("admin_listar_perfis");
  if(!root) return;
  const av = q("#usrAviso");
  if(error){
    av.innerHTML = `<div class="usr-alerta">Não consegui carregar as pessoas (${esc(erroTxt(error))}). Confira se você rodou os dois scripts SQL do README, incluindo <code>supabase-schema-usuarios.sql</code>.</div>`;
    q("#usrLista").innerHTML = "";
    return;
  }
  if(data && data.length && !("modulos" in data[0])){
    av.innerHTML = `<div class="usr-alerta">Falta rodar o arquivo <code>supabase-schema-usuarios.sql</code> no SQL Editor do Supabase. Sem ele, a lista funciona pela metade (sem último acesso e sem permissões por pessoa).</div>`;
  }else{
    av.innerHTML = "";
  }
  pessoas = (data || []).map(r => ({ ...r, diretos: new Set(r.modulos || []) }));
  await carregarCargos();
  if(!root) return;
  renderPessoas();
}

// Cargo de cada pessoa (módulo de uniformes e EPI). Se o SQL dos uniformes ainda não foi rodado, o campo
// "Cargo" simplesmente não aparece e o resto da tela funciona igual.
async function carregarCargos(){
  cargosOk = false; cargos = [];
  const [c, pf] = await Promise.all([
    sb().from("cargos").select("id,nome,ativo").order("nome"),
    sb().from("perfis").select("id,cargo_id")
  ]);
  if(c.error || pf.error) return;
  cargosOk = true; cargos = c.data || [];
  const mapa = {}; (pf.data || []).forEach(r => { mapa[r.id] = r.cargo_id; });
  pessoas.forEach(p => { p.cargo_id = mapa[p.id] || null; });
}

/* ---------- ações sobre uma pessoa (todas salvam na hora) ---------- */
async function atualizarPerfil(p, campos, msgOk){
  const card = root.querySelector(`.usr-pessoa[data-id="${p.id}"]`);
  if(card) card.classList.add("is-busy");
  const { error } = await sb().from("perfis").update(campos).eq("id", p.id);
  if(!root) return false;
  if(error){
    aviso("Não foi possível salvar: " + erroTxt(error), "erro");
    renderCartao(p.id);           // volta o cartão ao que está de fato salvo
    return false;
  }
  Object.assign(p, campos);
  renderCartao(p.id);
  aviso(msgOk || "Salvo");
  return true;
}

async function alternarFerramenta(p, moduloId, ligar){
  const card = root.querySelector(`.usr-pessoa[data-id="${p.id}"]`);
  if(card) card.classList.add("is-busy");
  const t = sb().from("perfil_modulos");
  const { error } = ligar
    ? await t.upsert({ perfil_id: p.id, modulo_id: moduloId }, { onConflict: "perfil_id,modulo_id", ignoreDuplicates: true })
    : await t.delete().eq("perfil_id", p.id).eq("modulo_id", moduloId);
  if(!root) return;
  if(error){
    aviso("Não foi possível salvar: " + erroTxt(error), "erro");
    renderCartao(p.id);
    return;
  }
  if(ligar) p.diretos.add(moduloId); else p.diretos.delete(moduloId);
  renderCartao(p.id);
  const m = MODULOS().find(x => x.id === moduloId);
  const quem = p.nome || p.email;
  aviso(`${m ? m.nome : moduloId} ${ligar ? "liberado para" : "removido de"} ${quem}`);
}

async function aoMudarPessoa(el){
  const card = el.closest(".usr-pessoa");
  const p = pessoas.find(x => x.id === card.dataset.id);
  if(!p) return;

  if(el.dataset.mod){ return alternarFerramenta(p, el.dataset.mod, el.checked); }

  const f = el.dataset.f;
  if(f === "nome"){
    const nome = el.value.trim();
    if(nome === (p.nome || "")) return;
    return atualizarPerfil(p, { nome }, "Nome salvo");
  }
  if(f === "papel"){
    if(el.value === "admin" && !confirm(`Tornar ${p.nome || p.email} administrador?\n\nAdmin vê todas as ferramentas e pode alterar as permissões de todo mundo.`)){
      el.value = p.papel; return;
    }
    return atualizarPerfil(p, { papel: el.value }, el.value === "admin" ? "Agora é admin" : "Agora é usuário comum");
  }
  if(f === "cargo_id"){
    return atualizarPerfil(p, { cargo_id: el.value || null }, "Cargo atualizado");
  }
  if(f === "nivel_id"){
    return atualizarPerfil(p, { nivel_id: el.value || null }, "Nível atualizado");
  }
  if(f === "ativo"){
    if(!el.checked && !confirm(`Bloquear o acesso de ${p.nome || p.email}?\n\nA pessoa deixa de conseguir entrar e de ver os dados na hora. A conta no Supabase continua existindo, e você pode liberar de novo quando quiser.`)){
      el.checked = true; return;
    }
    return atualizarPerfil(p, { ativo: el.checked }, el.checked ? "Acesso liberado" : "Acesso bloqueado");
  }
}

/* ---------- níveis ---------- */
function htmlNivel(nv){
  const mods = MODULOS();
  const marcados = nivelModulos[nv.id] || new Set();
  const gente = pessoas.filter(p => p.nivel_id === nv.id).length;
  return `
  <details class="fx-det usr-nivel">
    <summary><span>${esc(nv.nome)} <em class="usr-qtd">${gente} ${gente === 1 ? "pessoa" : "pessoas"}</em></span><span class="chev">▸</span></summary>
    <div class="body">
      ${mods.length ? mods.map(m => `
        <label class="tg"><input type="checkbox" data-nivel="${nv.id}" data-mod="${esc(m.id)}" ${marcados.has(m.id) ? "checked" : ""}><span>${esc(m.nome)}</span></label>
      `).join("") : `<p class="usr-hint">Nenhuma ferramenta registrada ainda.</p>`}
      <button class="btn ghost usr-del-nivel" type="button" data-nivel="${nv.id}">Apagar nível "${esc(nv.nome)}"</button>
    </div>
  </details>`;
}

function renderNiveis(){
  const el = q("#usrNiveis"); if(!el) return;
  // mantém abertos os níveis que já estavam abertos
  const abertos = new Set([...el.querySelectorAll("details[open]")].map(d => d.querySelector(".usr-del-nivel").dataset.nivel));
  el.innerHTML = niveis.length
    ? niveis.map(htmlNivel).join("")
    : `<p class="usr-hint">Nenhum nível criado ainda — crie um abaixo (ou use só as permissões por pessoa).</p>`;
  el.querySelectorAll("details").forEach(d => { if(abertos.has(d.querySelector(".usr-del-nivel").dataset.nivel)) d.open = true; });
}

async function carregarNiveis(){
  const r1 = await sb().from("niveis").select("id,nome").order("nome");
  const r2 = await sb().from("nivel_modulos").select("nivel_id,modulo_id");
  if(!root) return;
  if(r1.error || r2.error){ aviso("Não foi possível carregar os níveis: " + erroTxt(r1.error || r2.error), "erro"); }
  niveis = r1.data || [];
  nivelModulos = {};
  (r2.data || []).forEach(r => { (nivelModulos[r.nivel_id] ||= new Set()).add(r.modulo_id); });
  renderNiveis();
}

async function alternarModuloNivel(chk){
  const nivelId = chk.dataset.nivel, moduloId = chk.dataset.mod, ligar = chk.checked;
  chk.disabled = true;
  const t = sb().from("nivel_modulos");
  const { error } = ligar
    ? await t.upsert({ nivel_id: nivelId, modulo_id: moduloId }, { onConflict: "nivel_id,modulo_id", ignoreDuplicates: true })
    : await t.delete().eq("nivel_id", nivelId).eq("modulo_id", moduloId);
  if(!root) return;
  chk.disabled = false;
  if(error){ chk.checked = !ligar; aviso("Não foi possível salvar: " + erroTxt(error), "erro"); return; }
  const set = (nivelModulos[nivelId] ||= new Set());
  if(ligar) set.add(moduloId); else set.delete(moduloId);
  renderPessoas();                       // as pessoas desse nível mudam de ferramentas
  aviso("Nível atualizado");
}

async function criarNivel(nome){
  const { error } = await sb().from("niveis").insert({ nome });
  if(!root) return;
  if(error){ aviso(error.message.includes("duplicate") ? "Já existe um nível com esse nome." : "Não foi possível criar: " + error.message, "erro"); return; }
  await carregarNiveis();
  aviso("Nível criado");
}

async function apagarNivel(id){
  const nv = niveis.find(n => n.id === id);
  const gente = pessoas.filter(p => p.nivel_id === id).length;
  const aviso1 = gente ? `\n\n${gente} ${gente === 1 ? "pessoa está" : "pessoas estão"} nele e ${gente === 1 ? "perde" : "perdem"} as ferramentas que vinham só do nível (as permissões diretas continuam).` : "";
  if(!confirm(`Apagar o nível "${nv ? nv.nome : ""}"?${aviso1}`)) return;
  const { error } = await sb().from("niveis").delete().eq("id", id);
  if(!root) return;
  if(error){ aviso("Não foi possível apagar: " + erroTxt(error), "erro"); return; }
  await Promise.all([carregarNiveis(), carregarPessoas()]);
  aviso("Nível apagado");
}

/* ---------- montagem ---------- */
function ligar(){
  root.addEventListener("change", e => {
    if(e.target.closest("[data-nivel]") && e.target.matches('input[type="checkbox"]')){ alternarModuloNivel(e.target); return; }
    if(e.target.closest(".usr-pessoa")) aoMudarPessoa(e.target);
  });
  root.addEventListener("click", e => {
    const stat = e.target.closest(".usr-stat");
    if(stat){ filtro = stat.dataset.filtro; renderPessoas(); return; }
    const del = e.target.closest(".usr-del-nivel");
    if(del){ apagarNivel(del.dataset.nivel); return; }
    if(e.target.closest("#usrAtualizar")){ Promise.all([carregarNiveis(), carregarPessoas()]).then(() => aviso("Lista atualizada")); }
  });
  q("#usrBusca").addEventListener("input", e => { busca = e.target.value; renderPessoas(); });
  q("#usrNovoNivel").addEventListener("submit", e => {
    e.preventDefault();
    const input = q("#usrNomeNivel");
    const nome = input.value.trim();
    if(!nome) return;
    input.value = "";
    criarNivel(nome);
  });
}

async function mount(el){
  root = el;
  filtro = "todos"; busca = "";
  root.classList.add("mod-usuarios");
  root.innerHTML = skel();
  ligar();
  // níveis primeiro: o cartão de cada pessoa precisa saber o que o nível dela libera
  await carregarNiveis();
  await carregarPessoas();
  renderNiveis(); // atualiza a contagem "N pessoas" de cada nível
}
function unmount(){ clearTimeout(toastTimer); root = null; }

window.Platform.register({
  id: "usuarios",
  categoria: "configuracoes",
  menu: "Usuários",
  nome: "Usuários",
  descricao: "Veja quem tem acesso à plataforma e libere ou bloqueie cada ferramenta por pessoa.",
  soAdmin: true,
  icone: '<path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  mount, unmount
});

})();
