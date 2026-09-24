/* Usuários — módulo de administração (só aparece para quem é "admin").
   Duas partes:
   - Pessoas: lista todas as contas que existem no Supabase (Authentication > Users), mostra se cada
     uma PODE LOGAR de fato (conta ativa no site, e-mail confirmado, não suspensa) e permite, ali mesmo,
     trocar o papel (admin/usuário), o CARGO, ligar/desligar cada ferramenta só para aquela pessoa e
     ativar/bloquear. Toda alteração é salva na hora (sem botão "Salvar").
   - Cargos: cada cargo reúne no mesmo lugar as FERRAMENTAS que libera (o que antes era o "nível") e o
     KIT de uniformes e EPIs (editado em Uniformes e EPIs > Cargos e kits). Mudar as ferramentas de um
     cargo vale para todo mundo que tem aquele cargo.
   Acesso final de uma pessoa a uma ferramenta = admin OU cargo libera OU permissão direta.
   O cartão "Criar acesso" já deixa escolher o papel e o cargo no momento do convite (ver criarConvite
   e supabase/functions/completar-convite), para a pessoa nascer com o acesso certo — mas nada impede
   de ajustar mais tarde na lista "Pessoas", como sempre.
   Veja supabase-schema-cargos-unificados.sql (cargos e ferramentas) e supabase-schema-usuarios.sql. */
(function(){
"use strict";

const sb = () => window.Imperium.supabase;
const MODULOS = () => window.Platform.modulosConfiguraveis(); // [{id,nome}]
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const semAcento = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

let root = null;
let cargos = [];        // [{id,nome,ativo}] — cargos (ferramentas liberadas + kit de uniforme/EPI)
let cargoModulos = {};  // { cargo_id: Set(modulo_id) } — ferramentas que cada cargo libera
let kitQtd = {};        // { cargo_id: nº de itens no kit de uniforme/EPI } (só para o resumo)
let pessoas = [];       // [{id,email,nome,papel,cargo_id,ativo,criado_em,ultimo_acesso,email_confirmado_em,suspenso_ate,diretos:Set}]
let convites = [];      // [{token,nome,criado_em}] — convites (só nome) ainda não usados
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

// Como a pessoa recebe cada ferramenta: por ser admin, pelo cargo ou por permissão direta.
function acesso(p, moduloId){
  if(p.papel === "admin") return { tem:true, origem:"admin" };
  if(p.cargo_id && cargoModulos[p.cargo_id] && cargoModulos[p.cargo_id].has(moduloId)) return { tem:true, origem:"cargo" };
  if(p.diretos.has(moduloId)) return { tem:true, origem:"direto" };
  return { tem:false, origem:null };
}

const nomeCargo = id => { const c = cargos.find(x => x.id === id); return c ? c.nome : ""; };
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
      <h2 class="usr-h">Criar acesso</h2>
      <p class="usr-hint">Informe o nome da pessoa e já escolha o papel e o cargo dela (os mesmos que dá pra mudar
        depois em "Pessoas"). O cargo libera as ferramentas e define o kit de uniforme e EPI. Vamos gerar um link
        único — copie e envie por WhatsApp, e-mail, o que for mais fácil. Ao abrir o link, a própria pessoa
        escolhe o e-mail e a senha dela e já entra direto com o acesso escolhido — sem precisar voltar aqui
        depois para liberar nada. Se preferir decidir mais tarde, deixe o cargo em "— sem cargo —".</p>
      <form id="usrNovoConvite" class="usr-novo-nivel">
        <input type="text" id="usrConviteNome" placeholder="Nome da pessoa" maxlength="80" required autocomplete="off">
        <select id="usrConvitePapel" aria-label="Papel da pessoa convidada">
          <option value="usuario">Usuário</option>
          <option value="admin">Admin</option>
        </select>
        <select id="usrConviteCargo" aria-label="Cargo da pessoa convidada"></select>
        <button class="btn wide" type="submit">Gerar link de convite</button>
      </form>
      <div id="usrConviteResultado"></div>
      <div id="usrConvitesPendentes"></div>
    </div>

    <div class="usr-card">
      <h2 class="usr-h">Pessoas</h2>
      <p class="usr-hint">Contas criadas pelo cartão "Criar acesso" acima (ou, à moda antiga, direto no painel do Supabase em Authentication &gt; Users) aparecem aqui sozinhas. Quem entrou pelo convite já chega com o papel/cargo escolhido lá; quem foi criado à moda antiga não tem acesso a nenhuma ferramenta até você liberar aqui.</p>
      <div class="usr-tools">
        <input type="search" id="usrBusca" placeholder="Buscar por nome ou e-mail…" autocomplete="off">
      </div>
      <div id="usrLista" class="usr-lista"><p class="usr-hint">Carregando…</p></div>
    </div>

    <div class="usr-card">
      <h2 class="usr-h">Cargos</h2>
      <p class="usr-hint">Cada cargo junta, num lugar só, as <b>ferramentas</b> que libera e o <b>kit de uniformes e EPIs</b> de quem o tem. Marque as ferramentas de cada cargo aqui; mudar vale para todo mundo que tem aquele cargo. O kit de cada cargo é editado em <b>Uniformes e EPIs › Cargos e kits</b>. Admin vê tudo, com ou sem cargo.</p>
      <div id="usrCargos"></div>
      <form id="usrNovoCargo" class="usr-novo-nivel">
        <input type="text" id="usrNomeCargo" placeholder="Nome do novo cargo (ex.: Porteiro, Financeiro)" required maxlength="60">
        <button class="btn ghost" type="submit">+ Criar cargo</button>
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

function copiarTexto(inputEl, msgOk){
  if(!inputEl) return;
  inputEl.select();
  const feito = () => aviso(msgOk);
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inputEl.value).then(feito, feito);
  else { document.execCommand("copy"); feito(); }
}

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

/* ---------- criar acesso (convite só com o nome — a pessoa escolhe o próprio e-mail depois) ---------- */
// O link não guarda e-mail nenhum, só um token aleatório (gerado pelo banco). Quando a pessoa abre
// o link, ela mesma escolhe e-mail e senha, e é a Edge Function completar-convite (com a service
// role key, que não pode ficar no código do site) quem de fato cria a conta nesse momento — ver
// supabase/functions/completar-convite e supabase-schema-convites.sql.
function linkConvite(token, nome){
  return `${location.origin}${location.pathname}#/completar-convite?token=${encodeURIComponent(token)}&nome=${encodeURIComponent(nome || "")}`;
}

// Chamado sempre que a lista de cargos é (re)carregada, para o select do convite acompanhar sem
// perder o que o admin já tinha escolhido (caso esteja no meio de preencher o formulário).
function renderCargoConvite(){
  const sel = q("#usrConviteCargo"); if(!sel) return;
  const atual = sel.value;
  sel.innerHTML = optsCargos(atual);
}

// Nome do que a pessoa vai receber ao completar o convite, só para mensagens (papel Admin e/ou cargo).
function nomeAcessoConvite(papel, cargoId){
  const cargo = cargoId ? nomeCargo(cargoId) : "";
  if(papel === "admin") return cargo ? `Admin · ${cargo}` : "Admin";
  return cargo;
}

async function criarConvite(nome, papel, cargoIdBruto){
  const form = q("#usrNovoConvite");
  const btn = form.querySelector('button[type="submit"]');
  const txt = btn.textContent;
  const resEl = q("#usrConviteResultado");
  btn.disabled = true; btn.textContent = "Gerando…";
  resEl.innerHTML = "";

  const cargoId = cargoIdBruto || null;

  const { data, error } = await sb()
    .from("convites_pendentes")
    .insert({ nome, papel, cargo_id: cargoId, criado_por: window.Imperium.perfil.id })
    .select("token")
    .single();

  btn.disabled = false; btn.textContent = txt;

  if(error){
    resEl.innerHTML = `<div class="usr-alerta">Não foi possível gerar o link: ${esc(erroTxt(error))}</div>`;
    return;
  }

  const acesso = nomeAcessoConvite(papel, cargoId);
  resEl.innerHTML = `
    <div class="usr-convite-ok">
      <p>Copie o link abaixo e envie para ${esc(nome)} — ela abre, escolhe o próprio e-mail e senha, e já
        entra ${acesso ? `como <b>${esc(acesso)}</b>` : "sem cargo definido (ajuste depois na lista abaixo)"},
        aparecendo pra você na lista "Pessoas" assim que terminar. O link vale por 7 dias.</p>
      <div class="usr-link-row">
        <input type="text" readonly id="usrLinkGerado" value="${esc(linkConvite(data.token, nome))}" onfocus="this.select()">
        <button type="button" class="btn ghost" id="usrCopiarLink">Copiar link</button>
      </div>
    </div>`;

  form.reset();
  renderCargoConvite();
  await carregarConvitesPendentes();
}

/* ---------- convites pendentes (nome já digitado, mas a pessoa ainda não completou o cadastro) ---------- */
async function carregarConvitesPendentes(){
  const { data, error } = await sb()
    .from("convites_pendentes")
    .select("token,nome,papel,cargo_id,criado_em")
    .is("usado_em", null)
    .order("criado_em", { ascending: false });
  if(!root) return;
  if(error){ convites = []; renderConvitesPendentes(); return; } // provável: supabase-schema-convites.sql ainda não rodou
  convites = data || [];
  renderConvitesPendentes();
}

function renderConvitesPendentes(){
  const el = q("#usrConvitesPendentes"); if(!el) return;
  if(!convites.length){ el.innerHTML = ""; return; }
  el.innerHTML = `
    <div class="usr-convite-ok">
      <p class="usr-hint" style="margin-bottom:10px">Aguardando a pessoa completar o cadastro:</p>
      ${convites.map(c => {
        const acesso = nomeAcessoConvite(c.papel, c.cargo_id);
        return `
        <div class="usr-convite-pendente" data-token="${esc(c.token)}">
          <span class="usr-convite-pendente-nome">${esc(c.nome)}
            <em class="usr-qtd">${acesso ? esc(acesso) : "sem cargo definido"}</em></span>
          <div class="usr-link-row">
            <input type="text" readonly value="${esc(linkConvite(c.token, c.nome))}" onfocus="this.select()">
            <button type="button" class="btn ghost usr-copiar-pendente">Copiar link</button>
            <button type="button" class="btn ghost usr-cancelar-convite">Cancelar</button>
          </div>
        </div>`;
      }).join("")}
    </div>`;
}

async function cancelarConvite(token){
  const c = convites.find(x => x.token === token);
  if(!confirm(`Cancelar o convite de "${c ? c.nome : ""}"?\n\nO link parar de funcionar na hora.`)) return;
  const { error } = await sb().from("convites_pendentes").delete().eq("token", token);
  if(!root) return;
  if(error){ aviso("Não foi possível cancelar: " + erroTxt(error), "erro"); return; }
  await carregarConvitesPendentes();
  aviso("Convite cancelado");
}

/* ---------- pessoas ---------- */
// só cargos ativos, mais o cargo atual da pessoa/convite (mesmo desativado, para não parecer que ficou sem cargo)
function optsCargos(selecionado){
  return `<option value="">— sem cargo —</option>` +
    cargos.filter(c => c.ativo || c.id === selecionado)
      .map(c => `<option value="${c.id}" ${c.id === selecionado ? "selected" : ""}>${esc(c.nome)}${c.ativo ? "" : " (desativado)"}</option>`).join("");
}

function htmlFerramenta(p, m){
  const a = acesso(p, m.id);
  const trava = a.origem === "admin" || a.origem === "cargo";
  const nota = a.origem === "admin" ? "Admin acessa tudo"
             : a.origem === "cargo" ? `Pelo cargo ${esc(nomeCargo(p.cargo_id))}`
             : "";
  return `
  <label class="usr-sw usr-sis ${trava ? "is-lock" : ""}" ${trava ? `title="${nota}. Para tirar, mude o papel/cargo da pessoa."` : ""}>
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

    <div class="usr-p-body">
      <div class="usr-campo">
        <label for="papel-${p.id}">Papel</label>
        <select id="papel-${p.id}" data-f="papel"${lockSelf}>
          <option value="usuario" ${p.papel === "usuario" ? "selected" : ""}>Usuário</option>
          <option value="admin" ${p.papel === "admin" ? "selected" : ""}>Admin</option>
        </select>
      </div>
      <div class="usr-campo">
        <label for="cargo-${p.id}">Cargo</label>
        <select id="cargo-${p.id}" data-f="cargo_id" title="Libera as ferramentas do cargo e define o kit de uniforme e EPI que a pessoa pode solicitar">${optsCargos(p.cargo_id)}</select>
      </div>
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
      ${eu ? "" : `<button class="btn ghost usr-excluir" type="button" title="Apaga o login dela de vez — diferente de desligar &quot;Acesso ao site&quot;, não tem como desfazer">Excluir conta</button>`}
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
  if(data && data.length && !("cargo_id" in data[0])){
    av.innerHTML = `<div class="usr-alerta">Falta rodar o arquivo <code>supabase-schema-cargos-unificados.sql</code> no SQL Editor do Supabase. Ele junta o antigo "nível" com o cargo — até rodar, o cargo das pessoas não aparece aqui.</div>`;
  }else if(data && data.length && !("modulos" in data[0])){
    av.innerHTML = `<div class="usr-alerta">Falta rodar o arquivo <code>supabase-schema-usuarios.sql</code> no SQL Editor do Supabase. Sem ele, a lista funciona pela metade (sem último acesso e sem permissões por pessoa).</div>`;
  }else{
    av.innerHTML = "";
  }
  pessoas = (data || []).map(r => ({ ...r, diretos: new Set(r.modulos || []) }));
  renderPessoas();
  renderCargos();   // atualiza a contagem "N pessoas" de cada cargo
}

// Cargos, as ferramentas que cada um libera (cargo_modulos) e quantos itens tem o kit de uniforme/EPI de cada um.
// (o cargo de cada pessoa já vem junto com a lista de pessoas, em admin_listar_perfis)
async function carregarCargos(){
  const [c, cm, ki] = await Promise.all([
    sb().from("cargos").select("id,nome,ativo").order("nome"),
    sb().from("cargo_modulos").select("cargo_id,modulo_id"),
    sb().from("cargo_itens").select("cargo_id")
  ]);
  if(!root) return;
  if(c.error || cm.error){
    aviso("Não foi possível carregar os cargos: " + erroTxt(c.error || cm.error) + ". Confira se rodou o supabase-schema-cargos-unificados.sql.", "erro");
  }
  cargos = c.data || [];
  cargoModulos = {};
  (cm.data || []).forEach(r => { (cargoModulos[r.cargo_id] ||= new Set()).add(r.modulo_id); });
  kitQtd = {};
  (ki.data || []).forEach(r => { kitQtd[r.cargo_id] = (kitQtd[r.cargo_id] || 0) + 1; });
  renderCargos();
  renderCargoConvite();
  if(pessoas.length) renderPessoas();   // o select de cargo e as ferramentas de cada pessoa dependem disso
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

// ---------- excluir conta (diferente de "Bloquear": aqui o login some do Supabase de vez) ----------
// Só admin chama, e a Edge Function confere isso de novo (com a service role key) antes de excluir —
// ver supabase/functions/excluir-usuario. O que a pessoa já lançou no Fluxo de Caixa ou pediu no
// Uniformes/EPI continua no histórico (supabase-schema-excluir-usuario.sql cuida disso).
async function excluirPessoa(p){
  const quem = p.nome || p.email;
  const avisoAdmin = p.papel === "admin" ? "\n\nEla é ADMIN — depois de excluída, essa conta não gerencia mais nada por aqui." : "";
  if(!confirm(`Excluir de vez a conta de ${quem}?\n\nIsso apaga o login dela do Supabase — diferente de "Bloquear", NÃO tem como desfazer. O que ela já lançou no Fluxo de Caixa ou pediu no Uniformes/EPI continua no histórico, só sem o vínculo com a conta.${avisoAdmin}`)) return;

  const card = root.querySelector(`.usr-pessoa[data-id="${p.id}"]`);
  if(card) card.classList.add("is-busy");

  const { data, error } = await sb().functions.invoke("excluir-usuario", { body: { userId: p.id } });

  // mesmo caso de sempre: erro 4xx/5xx não vem pronto em error.message, precisa ler o corpo
  let falha = null;
  if(error){
    falha = error.message || "Não foi possível excluir.";
    try{ const corpo = await error.context.json(); if(corpo && corpo.erro) falha = corpo.erro; }catch(_){}
  }else if(data && data.erro){ falha = data.erro; }

  if(!root) return;
  if(falha){
    if(card) card.classList.remove("is-busy");
    aviso(falha, "erro");
    return;
  }

  pessoas = pessoas.filter(x => x.id !== p.id);
  renderPessoas();
  renderCargos();
  aviso(`Conta de ${quem} excluída`);
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
    const ok = await atualizarPerfil(p, { cargo_id: el.value || null }, "Cargo atualizado");
    if(ok) renderCargos();   // muda a contagem de pessoas de cada cargo
    return;
  }
  if(f === "ativo"){
    if(!el.checked && !confirm(`Bloquear o acesso de ${p.nome || p.email}?\n\nA pessoa deixa de conseguir entrar e de ver os dados na hora. A conta no Supabase continua existindo, e você pode liberar de novo quando quiser.`)){
      el.checked = true; return;
    }
    return atualizarPerfil(p, { ativo: el.checked }, el.checked ? "Acesso liberado" : "Acesso bloqueado");
  }
}

/* ---------- cargos (ferramentas liberadas + kit de uniforme/EPI) ---------- */
function htmlCargo(c){
  const mods = MODULOS();
  const marcados = cargoModulos[c.id] || new Set();
  const gente = pessoas.filter(p => p.cargo_id === c.id).length;
  const nFerr = mods.filter(m => marcados.has(m.id)).length;
  const kit = kitQtd[c.id] || 0;
  return `
  <details class="fx-det usr-nivel" data-cg="${c.id}">
    <summary><span>${esc(c.nome)}
      <em class="usr-qtd">${gente} ${gente === 1 ? "pessoa" : "pessoas"}</em>
      <em class="usr-qtd">${nFerr} ${nFerr === 1 ? "ferramenta" : "ferramentas"} · kit: ${kit} ${kit === 1 ? "item" : "itens"}${c.ativo ? "" : " · desativado"}</em></span><span class="chev">▸</span></summary>
    <div class="body">
      <p class="usr-kit-tit">Ferramentas que este cargo libera</p>
      ${mods.length ? mods.map(m => `
        <label class="tg"><input type="checkbox" data-cgmod="${esc(m.id)}" ${marcados.has(m.id) ? "checked" : ""}><span>${esc(m.nome)}</span></label>
      `).join("") : `<p class="usr-hint">Nenhuma ferramenta registrada ainda.</p>`}
      <p class="usr-kit-tit">Kit de uniforme e EPI</p>
      <p class="usr-hint" style="margin:0">${kit ? `${kit} ${kit === 1 ? "item cadastrado" : "itens cadastrados"} no kit deste cargo.` : "Kit ainda vazio."} Para editar os itens e as quantidades, abra <b>Uniformes e EPIs › Cargos e kits</b>.</p>
      <button class="btn ghost usr-del-nivel" type="button" data-cg="${c.id}">Apagar cargo "${esc(c.nome)}"</button>
    </div>
  </details>`;
}

function renderCargos(){
  const el = q("#usrCargos"); if(!el) return;
  // mantém abertos os cargos que já estavam abertos
  const abertos = new Set([...el.querySelectorAll("details[open]")].map(d => d.dataset.cg));
  el.innerHTML = cargos.length
    ? cargos.map(htmlCargo).join("")
    : `<p class="usr-hint">Nenhum cargo criado ainda — crie um abaixo (ou use só as permissões por pessoa).</p>`;
  el.querySelectorAll("details").forEach(d => { if(abertos.has(d.dataset.cg)) d.open = true; });
}

async function alternarModuloCargo(chk){
  const cargoId = chk.closest("[data-cg]").dataset.cg, moduloId = chk.dataset.cgmod, ligar = chk.checked;
  chk.disabled = true;
  const t = sb().from("cargo_modulos");
  const { error } = ligar
    ? await t.upsert({ cargo_id: cargoId, modulo_id: moduloId }, { onConflict: "cargo_id,modulo_id", ignoreDuplicates: true })
    : await t.delete().eq("cargo_id", cargoId).eq("modulo_id", moduloId);
  if(!root) return;
  chk.disabled = false;
  if(error){ chk.checked = !ligar; aviso("Não foi possível salvar: " + erroTxt(error), "erro"); return; }
  const set = (cargoModulos[cargoId] ||= new Set());
  if(ligar) set.add(moduloId); else set.delete(moduloId);
  renderPessoas();                       // as pessoas desse cargo mudam de ferramentas
  renderCargos();                        // atualiza o "N ferramentas" do resumo
  aviso("Cargo atualizado");
}

async function criarCargo(nome){
  const { error } = await sb().from("cargos").insert({ nome });
  if(!root) return;
  if(error){ aviso(/duplicate|unique/i.test(error.message) ? "Já existe um cargo com esse nome." : "Não foi possível criar: " + error.message, "erro"); return; }
  await carregarCargos();
  aviso("Cargo criado");
}

async function apagarCargo(id){
  const c = cargos.find(x => x.id === id);
  const gente = pessoas.filter(p => p.cargo_id === id).length;
  const aviso1 = gente ? `\n\n${gente} ${gente === 1 ? "pessoa tem" : "pessoas têm"} esse cargo e ${gente === 1 ? "fica" : "ficam"} sem cargo: ${gente === 1 ? "perde" : "perdem"} as ferramentas que vinham só dele (as permissões diretas continuam) e o kit de uniforme/EPI.` : "";
  if(!confirm(`Apagar o cargo "${c ? c.nome : ""}"?${aviso1}\n\nO kit deste cargo também é apagado. Se só quer parar de usar, prefira desativar em Uniformes e EPIs › Cargos e kits.`)) return;
  const { error } = await sb().from("cargos").delete().eq("id", id);
  if(!root) return;
  if(error){ aviso("Não foi possível apagar: " + erroTxt(error), "erro"); return; }
  await Promise.all([carregarCargos(), carregarPessoas()]);
  aviso("Cargo apagado");
}

/* ---------- montagem ---------- */
function ligar(){
  root.addEventListener("change", e => {
    if(e.target.matches('input[data-cgmod]')){ alternarModuloCargo(e.target); return; }
    if(e.target.closest(".usr-pessoa")) aoMudarPessoa(e.target);
  });
  root.addEventListener("click", e => {
    const stat = e.target.closest(".usr-stat");
    if(stat){ filtro = stat.dataset.filtro; renderPessoas(); return; }
    const del = e.target.closest(".usr-del-nivel");
    if(del){ apagarCargo(del.dataset.cg); return; }
    if(e.target.closest("#usrAtualizar")){ Promise.all([carregarCargos(), carregarPessoas(), carregarConvitesPendentes()]).then(() => aviso("Lista atualizada")); return; }
    if(e.target.closest("#usrCopiarLink")){
      const inp = q("#usrLinkGerado"); if(!inp) return;
      copiarTexto(inp, "Link copiado");
      return;
    }
    const copiarPendente = e.target.closest(".usr-copiar-pendente");
    if(copiarPendente){
      const inp = copiarPendente.closest(".usr-link-row").querySelector("input");
      copiarTexto(inp, "Link copiado");
      return;
    }
    const cancelarBtn = e.target.closest(".usr-cancelar-convite");
    if(cancelarBtn){
      cancelarConvite(cancelarBtn.closest(".usr-convite-pendente").dataset.token);
      return;
    }
    const excluirBtn = e.target.closest(".usr-excluir");
    if(excluirBtn){
      const card = excluirBtn.closest(".usr-pessoa");
      const p = pessoas.find(x => x.id === card.dataset.id);
      if(p) excluirPessoa(p);
      return;
    }
  });
  q("#usrBusca").addEventListener("input", e => { busca = e.target.value; renderPessoas(); });
  q("#usrNovoCargo").addEventListener("submit", e => {
    e.preventDefault();
    const input = q("#usrNomeCargo");
    const nome = input.value.trim();
    if(!nome) return;
    input.value = "";
    criarCargo(nome);
  });
  q("#usrNovoConvite").addEventListener("submit", e => {
    e.preventDefault();
    const nome = q("#usrConviteNome").value.trim();
    if(!nome) return;
    criarConvite(nome, q("#usrConvitePapel").value, q("#usrConviteCargo").value);
  });
}

async function mount(el){
  root = el;
  filtro = "todos"; busca = "";
  root.classList.add("mod-usuarios");
  root.innerHTML = skel();
  ligar();
  // cargos primeiro: o cartão de cada pessoa precisa saber o que o cargo dela libera
  await carregarCargos();
  await Promise.all([carregarPessoas(), carregarConvitesPendentes()]);
}
function unmount(){ clearTimeout(toastTimer); root = null; }

window.Platform.register({
  id: "usuarios",
  categoria: "configuracoes",
  menu: "Usuários",
  nome: "Usuários",
  descricao: "Veja quem tem acesso à plataforma, defina o cargo de cada pessoa e libere ou bloqueie ferramentas.",
  soAdmin: true,
  icone: '<path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  mount, unmount
});

})();
