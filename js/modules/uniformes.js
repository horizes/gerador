/* Uniformes e EPI — duas ferramentas ligadas pelo mesmo banco (Supabase):

   "Solicitar uniforme e EPI"       (id uniforme_solicitar) — cada pessoa tem um CARGO no perfil (definido na tela
                                    "Usuários") e cada cargo tem um KIT de uniformes e EPIs disponíveis. Quem pede
                                    escolhe, item por item, o tamanho (quando houver) e a quantidade que precisa —
                                    até o máximo definido no kit do cargo; item deixado em branco não entra no
                                    pedido. Quando o pedido fica pronto, confirma o recebimento com uma foto do
                                    rosto carimbada com local, data e hora (assinatura digital).
   "Solicitações de uniforme e EPI" (id uniforme_gestao)   — o responsável vê os pedidos, marca como pronto ou recusa,
                                    confere as assinaturas e edita os itens, os cargos e o kit de cada cargo. O cargo também é o que libera as ferramentas
                                    de cada pessoa (antigo "nível"): o administrador marca as ferramentas de cada cargo no mesmo cartão do kit.

   Quem vê cada uma é definido na tela "Usuários". Tabelas, regras de segurança e funções:
   supabase-schema-uniformes.sql. As fotos ficam num bucket PRIVADO ("uniforme-assinaturas") e são abertas
   por links temporários. (Os ids das ferramentas não mudam para não perder as permissões já liberadas.) */
(function(){
"use strict";

const sb = () => window.Imperium.supabase;
const perfil = () => window.Imperium.perfil;
const BUCKET = "uniforme-assinaturas";
const MOD_SOL = "uniforme_solicitar";
const MOD_GES = "uniforme_gestao";

/* ---------- helpers ---------- */
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const dh = iso => iso ? new Date(iso).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "";
const curto = id => String(id||"").replace(/-/g,"").slice(0,4).toUpperCase();
const cmp = (a,b) => String(a).localeCompare(String(b),"pt-BR",{numeric:true});

const CATS = { uniforme: "Uniforme", epi: "EPI" };
const catDe = x => (x && x.categoria) === "epi" ? "epi" : "uniforme";
const ordemCat = c => c === "epi" ? 1 : 0;
const ordemItens = (a,b) => ordemCat(catDe(a)) - ordemCat(catDe(b)) || cmp(a.tipo_nome, b.tipo_nome) || cmp(a.tamanho, b.tamanho);
const ordemTipos = (a,b) => ordemCat(catDe(a)) - ordemCat(catDe(b)) || (a.ordem||0) - (b.ordem||0) || cmp(a.nome, b.nome);
const tagEpi = t => catDe(t) === "epi" ? `<span class="uni-tag epi">EPI</span>` : "";

function msgErro(e){
  const m = (e && e.message) || String(e);
  if(/schema cache|does not exist|Could not find|relation .* does not exist/i.test(m)){
    return "O banco ainda não está com as tabelas de uniformes e EPI atualizadas. Rode o arquivo supabase-schema-uniformes.sql no SQL Editor do Supabase (veja o README).";
  }
  if(/row-level security|violates row/i.test(m)) return "Sem permissão para essa ação.";
  return m;
}

const STATUS = {
  pendente:  { rotulo:"Aguardando",           cls:"warn" },
  pronto:    { rotulo:"Pronto para retirada", cls:"gold" },
  parcial:   { rotulo:"Entrega parcial",      cls:"gold" },
  concluido: { rotulo:"Concluído",            cls:"ok"   },
  recusado:  { rotulo:"Recusado",             cls:"bad"  },
  cancelado: { rotulo:"Cancelado",            cls:""     }
};

/* ---------- dados ---------- */
async function lerTipos(somenteAtivos){
  let q = sb().from("uniforme_tipos").select("*").order("ordem").order("nome");
  if(somenteAtivos) q = q.eq("ativo", true);
  const { data, error } = await q;
  if(error) throw error;
  return data || [];
}

async function lerPedidos(apenasMeus){
  let q = sb().from("uniforme_pedidos")
    .select("*, itens:uniforme_itens(*), recebimentos:uniforme_recebimentos(*)")
    .order("criado_em", { ascending:false }).limit(300);
  if(apenasMeus) q = q.eq("solicitante_id", perfil().id);
  const { data, error } = await q;
  if(error) throw error;
  (data||[]).forEach(p => { p.itens = (p.itens||[]).sort(ordemItens); p.recebimentos = p.recebimentos||[]; });
  return data || [];
}

// cargo da pessoa logada + kit desse cargo (itens ativos, com quantidade e tamanhos possíveis)
async function lerMeuKit(){
  const { data: pf, error: e1 } = await sb().from("perfis").select("cargo_id").eq("id", perfil().id).maybeSingle();
  if(e1) throw e1;
  if(!pf || !pf.cargo_id) return { cargo: null, itens: [] };
  const [c, k] = await Promise.all([
    sb().from("cargos").select("id,nome,ativo").eq("id", pf.cargo_id).maybeSingle(),
    sb().from("cargo_itens").select("quantidade, tipo:uniforme_tipos(*)").eq("cargo_id", pf.cargo_id)
  ]);
  if(c.error) throw c.error;
  if(k.error) throw k.error;
  const itens = (k.data||[]).filter(r => r.tipo && r.tipo.ativo)
    .map(r => ({ tipo: { ...r.tipo, tamanhos: r.tipo.tamanhos || [] }, quantidade: r.quantidade }))
    .sort((a,b) => ordemTipos(a.tipo, b.tipo));
  return { cargo: c.data || null, itens };
}

async function lerCargos(){
  const [c, k, m] = await Promise.all([
    sb().from("cargos").select("*").order("nome"),
    sb().from("cargo_itens").select("*"),
    sb().from("cargo_modulos").select("cargo_id,modulo_id")   // ferramentas que cada cargo libera
  ]);
  if(c.error) throw c.error;
  if(k.error) throw k.error;
  const kits = {};
  (k.data||[]).forEach(r => { (kits[r.cargo_id] = kits[r.cargo_id] || []).push(r); });
  // se o SQL de cargos unificados ainda não foi rodado, a tabela não existe: só o bloco de ferramentas some
  const ferr = {}; let ferrOk = !m.error;
  (m.data||[]).forEach(r => { (ferr[r.cargo_id] = ferr[r.cargo_id] || new Set()).add(r.modulo_id); });
  return { cargos: c.data || [], kits, ferr, ferrOk };
}

// as fotos são privadas: cada uma é aberta por um link temporário (1 hora)
async function assinarFotos(pedidos){
  const paths = [...new Set(pedidos.flatMap(p => p.recebimentos.map(r => r.foto_path)))];
  const mapa = {};
  if(!paths.length) return mapa;
  const { data } = await sb().storage.from(BUCKET).createSignedUrls(paths, 3600);
  (data||[]).forEach(d => { if(d && d.signedUrl) mapa[d.path] = d.signedUrl; });
  return mapa;
}

/* ---------- avisos: número no menu + mensagem quando chega pedido novo ---------- */
const escutas = new Set();   // telas abertas que querem recarregar quando algo muda
function emitirMudanca(){ escutas.forEach(fn => { try{ fn(); }catch(e){} }); }

async function contar(q){ const { count, error } = await q; return error ? null : count; }
async function atualizarBadges(){
  const P = perfil(); if(!P) return;
  if(P.podeVer(MOD_GES)){
    const n = await contar(sb().from("uniforme_pedidos").select("id",{count:"exact",head:true}).eq("status","pendente"));
    if(n !== null) window.Platform.setBadge(MOD_GES, n);
  }
  if(P.podeVer(MOD_SOL)){
    const n = await contar(sb().from("uniforme_pedidos").select("id",{count:"exact",head:true})
      .eq("solicitante_id", P.id).in("status",["pronto","parcial"]));
    if(n !== null) window.Platform.setBadge(MOD_SOL, n);
  }
}

let avisosIniciados = false;
function iniciarAvisos(){
  if(avisosIniciados) return;
  avisosIniciados = true;
  atualizarBadges();
  const P = perfil();
  try{
    sb().channel("uniformes-avisos")
      .on("postgres_changes", { event:"*", schema:"public", table:"uniforme_pedidos" }, payload => {
        const n = payload.new || {};
        if(payload.eventType === "INSERT" && n.solicitante_id !== P.id && P.podeVer(MOD_GES)){
          window.Platform.toast(`Nova solicitação de uniforme e EPI de ${n.solicitante_nome || "um colaborador"}.`, "#/" + MOD_GES);
        }
        if(payload.eventType === "UPDATE" && n.solicitante_id === P.id && n.status === "pronto"){
          window.Platform.toast("Seu pedido está pronto para retirada. Depois de retirar, confirme o recebimento.", "#/" + MOD_SOL);
        }
        atualizarBadges();
        emitirMudanca();
      })
      .subscribe();
  }catch(e){ /* sem Realtime: o número do menu ainda atualiza pelos avisos abaixo */ }
  setInterval(atualizarBadges, 120000);
  document.addEventListener("visibilitychange", () => { if(!document.hidden) atualizarBadges(); });
}

/* ---------- janela (modal) ---------- */
let modal = null;
function abrirModal(html, opcoes){
  fecharModal();
  const el = document.createElement("div");
  el.className = "uni-modal";
  el.innerHTML = `<div class="uni-modal-bg" data-fechar></div>
    <div class="uni-modal-box" role="dialog" aria-modal="true" aria-label="${esc((opcoes&&opcoes.titulo)||"")}">${html}</div>`;
  document.body.appendChild(el);
  document.body.classList.add("no-scroll");
  const onKey = e => { if(e.key === "Escape") fecharModal(); };
  document.addEventListener("keydown", onKey);
  el.addEventListener("click", e => { if(e.target.closest("[data-fechar]")) fecharModal(); });
  modal = { el, onKey, aoFechar: opcoes && opcoes.aoFechar };
  const foco = el.querySelector("[data-foco]");
  if(foco) foco.focus();
  return el;
}
function fecharModal(){
  if(!modal) return;
  const m = modal; modal = null;
  document.removeEventListener("keydown", m.onKey);
  if(m.aoFechar){ try{ m.aoFechar(); }catch(e){} }
  m.el.remove();
  document.body.classList.remove("no-scroll");
}

/* ---------- peças de tela compartilhadas ---------- */
function itemHtml(it){
  const ok = !!it.recebimento_id;
  const tam = it.tamanho && it.tamanho !== "Único" ? `<span class="uni-tag">${esc(it.tamanho)}</span>` : "";
  return `<li class="${ok?"rec":""}">
    <span class="uni-chk" aria-label="${ok?"Recebido":"Ainda não recebido"}">${ok?"✓":""}</span>
    <span class="uni-it-nome"><b>${esc(it.tipo_nome)}</b>${tam}${it.observacao?`<em>${esc(it.observacao)}</em>`:""}</span>
    <span class="uni-it-qtd">× ${it.quantidade}</span>
  </li>`;
}

// itens do pedido; quando há uniforme E EPI, cada grupo ganha seu título
function itensHtml(itens){
  const cats = [...new Set(itens.map(catDe))].sort((a,b) => ordemCat(a) - ordemCat(b));
  if(cats.length < 2) return `<ul class="uni-itens">${itens.map(itemHtml).join("")}</ul>`;
  return cats.map(c => `<div class="uni-grupo">${CATS[c]}</div>
    <ul class="uni-itens">${itens.filter(i => catDe(i) === c).map(itemHtml).join("")}</ul>`).join("");
}

function rotuloItem(i){
  return `${esc(i.tipo_nome)}${i.tamanho && i.tamanho !== "Único" ? " " + esc(i.tamanho) : ""} × ${i.quantidade}`;
}

function recebimentosHtml(p, urls){
  const recs = p.recebimentos.slice().sort((a,b) => String(a.criado_em).localeCompare(String(b.criado_em)));
  if(!recs.length) return "";
  return `<div class="uni-recs"><div class="mini">Assinaturas de recebimento</div>` + recs.map(r => {
    const its = p.itens.filter(i => i.recebimento_id === r.id).map(rotuloItem).join(", ");
    const url = urls[r.foto_path];
    const mapa = r.latitude != null ? `https://www.google.com/maps?q=${r.latitude},${r.longitude}` : "";
    return `<div class="uni-rec">
      ${url
        ? `<a class="uni-rec-foto" href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="Foto da assinatura" loading="lazy"></a>`
        : `<span class="uni-rec-foto vazio">Foto indisponível</span>`}
      <div class="uni-rec-txt">
        <b>Recebimento confirmado em ${dh(r.criado_em)}</b>
        <span>${its}</span>
        ${r.local_texto ? `<span>${esc(r.local_texto)}</span>` : ""}
        ${mapa ? `<a href="${mapa}" target="_blank" rel="noopener">Ver local no mapa</a>` : ""}
        ${r.metodo === "arquivo" ? `<small class="uni-atencao">Foto enviada pelo seletor de arquivos do aparelho, não pela câmera ao vivo.</small>` : ""}
      </div>
    </div>`;
  }).join("") + `</div>`;
}

/* modo "meu" = tela do solicitante; modo "gestao" = tela do responsável */
function pedidoHtml(p, modo, urls){
  const st = STATUS[p.status] || STATUS.pendente;
  const pendentes = p.itens.filter(i => !i.recebimento_id);
  const titulo = modo === "gestao" ? esc(p.solicitante_nome || "Sem nome") : `Pedido #${curto(p.id)}`;
  const sub = modo === "gestao"
    ? `${p.cargo_nome ? esc(p.cargo_nome) + " · " : ""}Pedido #${curto(p.id)} · ${dh(p.criado_em)}`
    : `${p.cargo_nome ? esc(p.cargo_nome) + " · " : ""}${dh(p.criado_em)}`;

  let acoes = "";
  if(modo === "meu"){
    if((p.status === "pronto" || p.status === "parcial") && pendentes.length){
      acoes += `<button class="btn" type="button" data-receber="${p.id}">Recebi uniforme e EPI</button>`;
    }
    if(p.status === "pendente") acoes += `<button class="btn ghost" type="button" data-cancelar="${p.id}">Cancelar pedido</button>`;
  }else{
    if(p.status === "pendente"){
      acoes += `<button class="btn" type="button" data-pronto="${p.id}">Marcar como pronto para retirada</button>
                <button class="btn ghost" type="button" data-recusar="${p.id}">Recusar</button>`;
    }
    if(p.status === "pronto") acoes += `<button class="btn ghost" type="button" data-voltar="${p.id}">Voltar para aguardando</button>`;
    if(p.status === "recusado") acoes += `<button class="btn ghost" type="button" data-voltar="${p.id}">Reabrir pedido</button>`;
  }

  let situacao = "";
  if(p.status === "pronto" || p.status === "parcial"){
    situacao = modo === "gestao"
      ? `<p class="uni-nota">Aguardando ${esc(p.solicitante_nome || "o solicitante")} confirmar o recebimento${p.status === "parcial" ? " dos itens restantes" : ""}.</p>`
      : `<p class="uni-nota">Retire seus itens e toque em <b>Recebi uniforme e EPI</b> para confirmar${p.status === "parcial" ? " o que faltava" : ""}.</p>`;
  }

  return `<article class="uni-ped st-${p.status}" data-ped="${p.id}">
    <header class="uni-ped-h">
      <div><b>${titulo}</b><small>${sub}</small></div>
      <span class="uni-badge ${st.cls}">${st.rotulo}</span>
    </header>
    ${itensHtml(p.itens)}
    ${p.observacao ? `<p class="uni-obs"><span>Observação${modo === "gestao" ? " do solicitante" : ""}:</span> ${esc(p.observacao)}</p>` : ""}
    ${p.resposta ? `<p class="uni-obs resp"><span>${modo === "gestao" ? "Sua resposta" : "Resposta do responsável"}:</span> ${esc(p.resposta)}</p>` : ""}
    ${situacao}
    ${recebimentosHtml(p, urls)}
    ${acoes ? `<footer class="uni-ped-f">${acoes}</footer>` : ""}
  </article>`;
}

const avisoConfig = e => `<div class="uni-wrap"><p class="uni-alerta">${esc(msgErro(e))}</p></div>`;

/* =====================================================================================================
   Assinatura por foto: câmera + localização + carimbo de local, data e hora na imagem
   ===================================================================================================== */
async function enderecoDe(lat, lng){
  try{
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4500);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=pt-BR&lat=${lat}&lon=${lng}`, { signal: ctl.signal });
    clearTimeout(t);
    if(!r.ok) return "";
    const j = await r.json();
    const a = j.address || {};
    const via = [a.road, a.house_number].filter(Boolean).join(", ");
    const partes = [via, a.suburb || a.neighbourhood, a.city || a.town || a.village || a.municipality, a.state].filter(Boolean);
    return (partes.length ? partes.join(" - ") : (j.display_name || "")).slice(0, 200);
  }catch(e){ return ""; }   // sem endereço: o carimbo fica só com as coordenadas
}

function quebrarTexto(g, texto, largura){
  const palavras = String(texto).split(/\s+/);
  const linhas = []; let atual = "";
  palavras.forEach(w => {
    const t = atual ? atual + " " + w : w;
    if(g.measureText(t).width > largura && atual){ linhas.push(atual); atual = w; } else atual = t;
  });
  if(atual) linhas.push(atual);
  return linhas;
}

// desenha a faixa com nome, data/hora e local na parte de baixo da foto (fica gravada na própria imagem)
function carimbar(g, w, h, linhas){
  const fs = Math.max(12, Math.round(w / 40)), lh = Math.round(fs * 1.35), pad = Math.round(fs * .8);
  g.textBaseline = "top";
  const desenhar = [];
  linhas.forEach((l, idx) => {
    g.font = `${idx === 0 ? "700" : "500"} ${fs}px Barlow, Arial, sans-serif`;
    quebrarTexto(g, l, w - pad * 2).forEach(sub => desenhar.push({ txt: sub, forte: idx === 0 }));
  });
  const alt = desenhar.length * lh + pad * 2;
  g.fillStyle = "rgba(0,0,0,.66)";
  g.fillRect(0, h - alt, w, alt);
  desenhar.forEach((d, i) => {
    g.font = `${d.forte ? "700" : "500"} ${fs}px Barlow, Arial, sans-serif`;
    g.fillStyle = d.forte ? "#EFCC69" : "#FFFFFF";
    g.fillText(d.txt, pad, h - alt + pad + i * lh);
  });
}

/* =====================================================================================================
   Ferramenta 1 — Solicitar uniforme e EPI
   ===================================================================================================== */
const SOL = (function(){
  let root = null;
  let cargo = null, kit = [], pedidos = [], urls = {};
  // tamanhos: { idDoItem: "M" } · quantidades: { idDoItem: 2 } — os dois começam vazios: a pessoa só pede o que preencher
  let tamanhos = {}, quantidades = {}, obsPedido = "";
  const ouvintes = [];
  const on = (t, fn) => ouvintes.push([t, fn]);
  const $ = id => root && root.querySelector("#" + id);

  const temPendente = () => pedidos.some(p => p.status === "pendente");

  async function carregar(){
    const [k, p] = await Promise.all([lerMeuKit(), lerPedidos(true)]);
    cargo = k.cargo; kit = k.itens; pedidos = p;
    urls = await assinarFotos(pedidos);
  }

  // devolve um número válido (1..max) ou null se o campo estiver vazio/ inválido — nesse caso o item fica de fora
  function limparQtd(valor, max){
    const n = parseInt(valor, 10);
    if(!Number.isFinite(n) || n < 1) return null;
    return Math.min(n, max);
  }

  /* ----- kit do cargo: a pessoa escolhe a quantidade (e o tamanho, quando houver) de cada item ----- */
  function linhaKit(k){
    const t = k.tipo;
    const campoTam = t.tamanhos.length
      ? `<label class="f"><span>Tamanho</span><select data-tam="${t.id}" aria-label="Tamanho de ${esc(t.nome)}">
           <option value="">Não solicitar</option>
           ${t.tamanhos.map(s => `<option value="${esc(s)}" ${tamanhos[t.id] === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
         </select></label>`
      : `<span class="uni-unico">Tamanho único</span>`;
    const campoQtd = `<label class="f"><span>Quantidade</span>
      <input type="number" inputmode="numeric" min="1" max="${k.quantidade}" placeholder="0"
        data-qtd="${t.id}" value="${quantidades[t.id] || ""}" aria-label="Quantidade de ${esc(t.nome)}"></label>`;
    return `<div class="uni-kit-linha">
      <div class="uni-kit-nome"><b>${esc(t.nome)}</b><span class="uni-it-qtd">até ${k.quantidade}</span></div>
      ${campoTam}${campoQtd}
    </div>`;
  }
  function renderKit(){
    const el = $("uniKit"), form = $("uniForm"); if(!el) return;
    if(!cargo){
      el.innerHTML = `<p class="uni-alerta">Seu cargo ainda não foi definido no seu perfil. Fale com o administrador para ele cadastrar o seu cargo.</p>`;
      form.hidden = true; return;
    }
    if(!cargo.ativo){
      el.innerHTML = `<p class="uni-alerta">O cargo do seu perfil (${esc(cargo.nome)}) está desativado. Fale com o administrador.</p>`;
      form.hidden = true; return;
    }
    if(!kit.length){
      el.innerHTML = `<p class="uni-alerta">O kit do cargo <b>${esc(cargo.nome)}</b> ainda não foi cadastrado. Fale com o responsável pelos uniformes e EPIs.</p>`;
      form.hidden = true; return;
    }
    const grupo = c => {
      const its = kit.filter(k => catDe(k.tipo) === c);
      return its.length ? `<div class="uni-grupo">${CATS[c]}</div>${its.map(linhaKit).join("")}` : "";
    };
    el.innerHTML = `<p class="uni-cargo-tit">Seu cargo: <b>${esc(cargo.nome)}</b></p>
      <p class="uni-hint" style="margin:6px 0 0">Informe a quantidade (e o tamanho, quando houver) só dos itens de que você precisa, até o limite do seu cargo. Item com a quantidade em branco não entra no pedido.</p>
      ${grupo("uniforme")}${grupo("epi")}`;
    form.hidden = false;
    atualizarEnvio();
  }
  // itens que vão no pedido: precisam ter quantidade preenchida e, se tiverem tamanho, o tamanho escolhido
  const escolhidos = () => kit.filter(k => (!k.tipo.tamanhos.length || tamanhos[k.tipo.id]) && quantidades[k.tipo.id] != null);
  function atualizarEnvio(){
    const btn = $("uniEnviar"), av = $("uniPend"); if(!btn) return;
    const pend = temPendente();
    btn.disabled = pend;
    av.hidden = !pend;
    const r = $("uniResumo");
    if(r) r.textContent = `Itens neste pedido: ${escolhidos().length} de ${kit.length}`;
  }
  function erroForm(msg){
    const el = $("uniErro"); if(!el) return;
    el.textContent = msg || ""; el.hidden = !msg;
  }

  async function enviar(){
    erroForm("");
    if(temPendente()) return;
    // só vão os itens com quantidade preenchida (e tamanho escolhido, quando o item tem tamanho); os outros ficam de fora
    const itens = escolhidos();
    if(!itens.length){ erroForm("Informe a quantidade de pelo menos um item para fazer o pedido."); return; }
    const mapaTam = {}, mapaQtd = {};
    itens.forEach(k => {
      mapaTam[k.tipo.id] = k.tipo.tamanhos.length ? tamanhos[k.tipo.id] : "Único";
      mapaQtd[k.tipo.id] = quantidades[k.tipo.id];
    });
    const btn = $("uniEnviar"); btn.disabled = true; btn.textContent = "Enviando…";
    const { data: pedidoId, error } = await sb().rpc("uniforme_criar_pedido", { p_observacao: obsPedido.trim(), p_tamanhos: mapaTam, p_quantidades: mapaQtd });
    btn.textContent = "Enviar solicitação";
    if(error){ atualizarEnvio(); erroForm(msgErro(error)); return; }
    // avisa por e-mail o endereço da empresa (só facilita; se falhar, o pedido já foi feito do mesmo jeito)
    sb().functions.invoke("notificar-pedido-uniforme", { body: { pedido_id: pedidoId } }).catch(() => {});
    tamanhos = {}; quantidades = {}; obsPedido = "";
    if($("uniObs")) $("uniObs").value = "";
    window.Platform.toast("Solicitação enviada. O responsável já foi avisado.");
    await recarregar();
    renderKit();
    const meus = $("uniMeusCard"); if(meus) meus.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ----- meus pedidos ----- */
  function renderMeus(){
    const el = $("uniMeus"); if(!el) return;
    el.innerHTML = pedidos.length
      ? pedidos.map(p => pedidoHtml(p, "meu", urls)).join("")
      : `<p class="uni-vazio">Você ainda não fez nenhum pedido. Escolha os tamanhos acima e envie a solicitação.</p>`;
    const prontos = pedidos.filter(p => (p.status === "pronto" || p.status === "parcial") && p.itens.some(i => !i.recebimento_id));
    const av = $("uniAviso");
    if(av) av.innerHTML = prontos.length
      ? `<div class="uni-destaque"><b>${prontos.length === 1 ? "Você tem um pedido pronto para retirada." : `Você tem ${prontos.length} pedidos prontos para retirada.`}</b>
         <span>Depois de retirar, toque em “Recebi uniforme e EPI” no pedido para confirmar.</span></div>`
      : "";
  }
  async function recarregar(){
    try{
      pedidos = await lerPedidos(true);
      urls = await assinarFotos(pedidos);
    }catch(e){ return; }
    renderMeus();
    atualizarEnvio();
    atualizarBadges();
  }

  async function cancelar(id){
    if(!confirm("Cancelar este pedido?")) return;
    const { data, error } = await sb().from("uniforme_pedidos").update({ status: "cancelado" })
      .eq("id", id).eq("status", "pendente").select("id");
    if(error){ alert(msgErro(error)); return; }
    if(!data || !data.length) alert("Este pedido já foi atendido e não pode mais ser cancelado.");
    await recarregar();
  }

  /* ----- confirmação de recebimento (itens + foto + local) ----- */
  function abrirRecebimento(pedido){
    const pend = pedido.itens.filter(i => !i.recebimento_id);
    if(!pend.length) return;
    const R = {
      sel: new Set(pend.map(i => i.id)),
      stream: null, videoOk: false, blob: null, url: null, metodo: "camera", capturadoEm: null,
      pos: null, local: "", geo: "idle", geoMsg: "", cam: "idle", camMsg: "", enviando: false
    };

    const el = abrirModal(`
      <h2 class="uni-m-h">Recebi uniforme e EPI</h2>
      <p class="uni-m-sub">Pedido #${curto(pedido.id)}. Marque o que você recebeu. O que ficar desmarcado continua pendente e você confirma depois.</p>

      <div class="uni-m-sec">
        <div class="uni-m-top"><span class="mini">Itens recebidos</span><button class="uni-link" type="button" data-todos>Marcar todos</button></div>
        <ul class="uni-sel">${pend.map(i => `
          <li><label class="tg"><input type="checkbox" data-item="${i.id}" checked>
            <span><b>${esc(i.tipo_nome)}</b>${i.tamanho && i.tamanho !== "Único" ? " " + esc(i.tamanho) : ""} × ${i.quantidade} ${tagEpi(i)}</span></label></li>`).join("")}
        </ul>
      </div>

      <div class="uni-m-sec">
        <span class="mini">Assinatura digital</span>
        <p class="hint" style="margin:0 0 10px">Uma foto do seu rosto, com data, hora e local marcados na imagem.</p>
        <div class="uni-cam">
          <div class="uni-cam-vid" id="rcVidBox" hidden><video id="rcVid" autoplay playsinline muted></video></div>
          <img id="rcPrev" class="uni-cam-prev" alt="Foto da assinatura" hidden>
          <p class="uni-cam-msg" id="rcCamMsg" hidden></p>
          <div class="uni-cam-btns">
            <button class="btn ghost" type="button" id="rcIniciar">Abrir câmera e localização</button>
            <button class="btn" type="button" id="rcFoto" hidden>Tirar foto</button>
            <button class="btn ghost" type="button" id="rcRefazer" hidden>Tirar outra foto</button>
            <label class="btn ghost" id="rcArqLbl" hidden>Tirar foto pelo aparelho<input type="file" accept="image/*" capture="user" id="rcArq" hidden></label>
          </div>
        </div>
        <p class="uni-loc" id="rcLoc"></p>
      </div>

      <label class="tg uni-consent"><input type="checkbox" id="rcOk"><span>Confirmo que recebi os itens marcados e autorizo o registro da minha foto, data, hora e localização como assinatura digital.</span></label>
      <p class="uni-erro" id="rcErro" hidden></p>
      <div class="uni-m-act">
        <button class="btn ghost" type="button" data-fechar>Cancelar</button>
        <button class="btn" type="button" id="rcConfirmar" disabled>Confirmar recebimento</button>
      </div>`, { titulo: "Confirmar recebimento", aoFechar: limpar });

    const q = id => el.querySelector("#" + id);
    function limpar(){
      pararCamera();
      if(R.url){ URL.revokeObjectURL(R.url); R.url = null; }
    }
    function pararCamera(){
      if(R.stream){ R.stream.getTracks().forEach(t => t.stop()); R.stream = null; }
      R.videoOk = false;
      const v = q("rcVid"); if(v) v.srcObject = null;
    }
    const aberto = () => modal && modal.el === el;

    function erro(msg){ const e = q("rcErro"); e.textContent = msg || ""; e.hidden = !msg; }

    function atualizar(){
      const temFoto = !!R.blob, comStream = !!R.stream, falhou = R.cam === "falhou";
      q("rcVidBox").hidden = !comStream;
      q("rcPrev").hidden = !temFoto;
      q("rcIniciar").hidden = temFoto || comStream;
      q("rcIniciar").textContent = falhou ? "Tentar a câmera de novo" : "Abrir câmera e localização";
      q("rcIniciar").disabled = R.cam === "pedindo";
      q("rcFoto").hidden = !comStream || temFoto;
      q("rcFoto").disabled = R.geo !== "ok" || !R.videoOk;   // só libera com a imagem da câmera rodando e o local pronto
      q("rcRefazer").hidden = !temFoto;
      q("rcArqLbl").hidden = temFoto || !falhou;
      const cm = q("rcCamMsg"); cm.hidden = !R.camMsg || temFoto || comStream; cm.textContent = R.camMsg;

      const loc = q("rcLoc");
      if(R.geo === "idle") loc.innerHTML = "";
      else if(R.geo === "buscando") loc.textContent = "Obtendo sua localização…";
      else if(R.geo === "endereco") loc.textContent = "Localização obtida. Buscando o endereço…";
      else if(R.geo === "ok"){
        loc.textContent = "Local: " + (R.local || `${R.pos.lat.toFixed(5)}, ${R.pos.lng.toFixed(5)}`) + ` (±${Math.round(R.pos.prec)} m)`;
      }else loc.innerHTML = `${esc(R.geoMsg)} <button class="uni-link" type="button" data-geo>Tentar de novo</button>`;

      q("rcConfirmar").disabled = R.enviando || !R.sel.size || !R.blob || !q("rcOk").checked;
    }

    function pedirLocalizacao(){
      if(R.geo === "buscando" || R.geo === "endereco" || R.geo === "ok") return;
      if(!navigator.geolocation){ R.geo = "erro"; R.geoMsg = "Este aparelho não informa a localização."; atualizar(); return; }
      R.geo = "buscando"; atualizar();
      navigator.geolocation.getCurrentPosition(async pos => {
        if(!aberto()) return;
        R.pos = { lat: pos.coords.latitude, lng: pos.coords.longitude, prec: pos.coords.accuracy || 0 };
        R.geo = "endereco"; atualizar();
        R.local = await enderecoDe(R.pos.lat, R.pos.lng);
        if(!aberto()) return;
        R.geo = "ok"; atualizar();
      }, err => {
        if(!aberto()) return;
        R.geo = "erro";
        R.geoMsg = err && err.code === 1
          ? "A localização está bloqueada. Libere o acesso à localização nas configurações do navegador."
          : "Não foi possível obter sua localização. Vá para um lugar aberto e tente de novo.";
        atualizar();
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    }

    async function abrirCamera(){
      erro(""); R.camMsg = "";
      pedirLocalizacao();
      if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        R.cam = "falhou"; R.camMsg = "Este navegador não abre a câmera direto. Use o botão abaixo para tirar a foto pelo aparelho."; atualizar(); return;
      }
      R.cam = "pedindo"; atualizar();
      try{
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
        if(!aberto()){ stream.getTracks().forEach(t => t.stop()); return; }
        R.stream = stream; R.cam = "ok";
        const v = q("rcVid");
        v.onloadeddata = () => { if(aberto() && R.stream === stream){ R.videoOk = true; atualizar(); } };
        v.srcObject = stream;
        try{ await v.play(); }catch(e){}
      }catch(e){
        R.cam = "falhou";
        R.camMsg = e && e.name === "NotAllowedError"
          ? "A câmera está bloqueada. Libere o acesso à câmera nas configurações do navegador, ou use o botão abaixo."
          : "Não foi possível abrir a câmera. Use o botão abaixo para tirar a foto pelo aparelho.";
      }
      if(aberto()) atualizar();
    }

    function linhasCarimbo(){
      const agora = R.capturadoEm;
      const dataHora = agora.toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit" });
      return [
        `Imperium · Recebimento de uniforme/EPI · Pedido #${curto(pedido.id)}`,
        perfil().nome || "",
        dataHora,
        R.local,
        `Lat ${R.pos.lat.toFixed(5)}  Lng ${R.pos.lng.toFixed(5)}  (±${Math.round(R.pos.prec)} m)`
      ].filter(Boolean);
    }

    async function fixarFoto(fonte, w, h, metodo){
      if(!R.pos){ erro("Ainda sem localização. Aguarde ou tente de novo."); return; }
      R.capturadoEm = new Date();
      const escala = Math.min(1, 1000 / Math.max(w, h));
      const cw = Math.round(w * escala), ch = Math.round(h * escala);
      const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
      const g = cv.getContext("2d");
      g.drawImage(fonte, 0, 0, cw, ch);
      carimbar(g, cw, ch, linhasCarimbo());
      const blob = await new Promise(res => cv.toBlob(res, "image/jpeg", 0.82));
      if(!blob || !aberto()){ return; }
      if(R.url) URL.revokeObjectURL(R.url);
      R.blob = blob; R.metodo = metodo; R.url = URL.createObjectURL(blob);
      q("rcPrev").src = R.url;
      pararCamera(); R.camMsg = "";
      atualizar();
    }

    function tirarFoto(){
      const v = q("rcVid");
      if(!v.videoWidth){ erro("A câmera ainda está iniciando. Tente de novo em um segundo."); return; }
      fixarFoto(v, v.videoWidth, v.videoHeight, "camera");
    }

    function fotoDoArquivo(file){
      if(!file) return;
      if(!R.pos){ pedirLocalizacao(); erro("Primeiro precisamos da sua localização. Aguarde ela aparecer abaixo e escolha a foto de novo."); return; }
      const img = new Image(), u = URL.createObjectURL(file);
      img.onload = () => { fixarFoto(img, img.naturalWidth, img.naturalHeight, "arquivo"); URL.revokeObjectURL(u); };
      img.onerror = () => { URL.revokeObjectURL(u); erro("Não foi possível abrir essa imagem."); };
      img.src = u;
    }

    async function confirmar(){
      if(R.enviando) return;
      R.enviando = true; erro("");
      const btn = q("rcConfirmar"); btn.textContent = "Enviando…"; atualizar();
      try{
        const caminho = `${perfil().id}/${pedido.id}-${Date.now()}.jpg`;
        const up = await sb().storage.from(BUCKET).upload(caminho, R.blob, { contentType: "image/jpeg", upsert: false });
        if(up.error) throw up.error;
        const { error } = await sb().rpc("uniforme_confirmar_recebimento", {
          p_pedido: pedido.id, p_itens: [...R.sel], p_foto_path: caminho, p_metodo: R.metodo,
          p_lat: R.pos.lat, p_lng: R.pos.lng, p_precisao: R.pos.prec, p_local: R.local,
          p_capturado_em: R.capturadoEm.toISOString()
        });
        if(error) throw error;
        fecharModal();
        window.Platform.toast("Recebimento confirmado. Obrigado!");
        await recarregar();
      }catch(e){
        R.enviando = false;
        if(aberto()){ btn.textContent = "Confirmar recebimento"; erro(msgErro(e)); atualizar(); }
      }
    }

    el.addEventListener("change", e => {
      const t = e.target;
      if(t.dataset.item){ t.checked ? R.sel.add(t.dataset.item) : R.sel.delete(t.dataset.item); atualizar(); }
      else if(t.id === "rcOk") atualizar();
      else if(t.id === "rcArq"){ fotoDoArquivo(t.files[0]); t.value = ""; }
    });
    el.addEventListener("click", e => {
      const b = e.target.closest("button"); if(!b) return;
      if(b.dataset.todos !== undefined){
        el.querySelectorAll("[data-item]").forEach(c => { c.checked = true; R.sel.add(c.dataset.item); });
        atualizar();
      }else if(b.dataset.geo !== undefined){ R.geo = "idle"; pedirLocalizacao(); }
      else if(b.id === "rcIniciar") abrirCamera();
      else if(b.id === "rcFoto") tirarFoto();
      else if(b.id === "rcRefazer"){
        R.blob = null; if(R.url){ URL.revokeObjectURL(R.url); R.url = null; }
        q("rcPrev").removeAttribute("src");
        abrirCamera();
      }else if(b.id === "rcConfirmar") confirmar();
    });
    atualizar();
  }

  /* ----- eventos da tela ----- */
  function mudarQtd(t, corrigirCampo){
    const k = kit.find(x => x.tipo.id === t.dataset.qtd); if(!k) return;
    const n = limparQtd(t.value, k.quantidade);
    if(corrigirCampo) t.value = n === null ? "" : n;   // ao sair do campo, corrige valor fora do limite (ex.: 0 ou maior que o máximo)
    if(n === null) delete quantidades[t.dataset.qtd]; else quantidades[t.dataset.qtd] = n;
    atualizarEnvio();
  }
  on("change", e => {
    const t = e.target;
    if(t.dataset.tam){ tamanhos[t.dataset.tam] = t.value; atualizarEnvio(); }
    else if(t.dataset.qtd) mudarQtd(t, true);
  });
  on("input", e => {
    const t = e.target;
    if(t.id === "uniObs") obsPedido = t.value;
    else if(t.dataset.qtd) mudarQtd(t, false);   // atualiza o resumo enquanto digita, sem mexer no que a pessoa está escrevendo
  });
  on("click", e => {
    const b = e.target.closest("button"); if(!b) return;
    if(b.id === "uniEnviar"){ enviar(); return; }
    if(b.dataset.receber){ const p = pedidos.find(x => x.id === b.dataset.receber); if(p) abrirRecebimento(p); return; }
    if(b.dataset.cancelar){ cancelar(b.dataset.cancelar); return; }
  });

  const TEMPLATE = `
  <div class="uni-wrap">
    <h1 class="uni-h">Solicitar uniforme e EPI</h1>
    <p class="uni-sub">Cada cargo tem um kit de uniformes e EPIs já definido. Escolha só o seu tamanho e envie: o responsável é avisado assim que você enviar.</p>
    <div id="uniAviso"></div>

    <section class="uni-card">
      <h2 class="uni-h2">Novo pedido</h2>
      <div id="uniKit"></div>
      <div id="uniForm" hidden>
        <label class="f" style="margin-top:18px"><span>Observação (opcional)</span>
          <textarea id="uniObs" maxlength="500" placeholder="Ex.: o tamanho da calça mudou, preciso de uma numeração diferente"></textarea></label>
        <p class="uni-resumo" id="uniResumo"></p>
        <p class="uni-info" id="uniPend" hidden>Você já tem um pedido aguardando atendimento. Quando ele for atendido, você poderá fazer outro.</p>
        <p class="uni-erro" id="uniErro" hidden></p>
        <button class="btn" type="button" id="uniEnviar">Enviar solicitação</button>
      </div>
    </section>

    <section class="uni-card" id="uniMeusCard">
      <h2 class="uni-h2">Meus pedidos</h2>
      <div id="uniMeus"></div>
    </section>
  </div>`;

  async function mount(el){
    root = el; root.className = "mod-uni";
    root.innerHTML = `<div class="uni-wrap"><p class="hint" style="padding:40px 0">Carregando…</p></div>`;
    try{ await carregar(); }
    catch(e){ if(root === el) root.innerHTML = avisoConfig(e); return; }
    if(root !== el) return;   // a pessoa já saiu da tela antes de terminar de carregar
    root.innerHTML = TEMPLATE;
    tamanhos = {}; quantidades = {}; obsPedido = "";
    ouvintes.forEach(([t, fn]) => root.addEventListener(t, fn));
    renderKit(); renderMeus();
    escutas.add(recarregar);
  }
  function unmount(){
    fecharModal();
    escutas.delete(recarregar);
    if(root) ouvintes.forEach(([t, fn]) => root.removeEventListener(t, fn));
    root = null;
  }
  return { mount, unmount };
})();

/* =====================================================================================================
   Ferramenta 2 — Solicitações de uniforme e EPI (responsável)
   ===================================================================================================== */
const GES = (function(){
  let root = null;
  let pedidos = [], tipos = [], cargos = [], kits = {}, ferr = {}, ferrOk = false, urls = {};
  let aba = "pedidos", filtro = "pendente", busca = "";
  const abertos = new Set();   // cargos com o cartão aberto na aba "Cargos e kits"
  const ouvintes = [];
  const on = (t, fn, captura) => ouvintes.push([t, fn, !!captura]);
  const $ = id => root && root.querySelector("#" + id);

  async function carregar(){
    const [p, t, c] = await Promise.all([lerPedidos(false), lerTipos(false), lerCargos()]);
    pedidos = p; tipos = t.sort(ordemTipos); cargos = c.cargos; kits = c.kits; ferr = c.ferr; ferrOk = c.ferrOk;
    urls = await assinarFotos(pedidos);
  }
  function renderAba(){
    renderAbas();
    if(aba === "pedidos") renderPedidos(); else if(aba === "cargos") renderCargos(); else renderItens();
  }
  let recTimer = null;
  function recarregar(){   // chamado quando chega pedido novo: espera um instante para juntar várias mudanças
    clearTimeout(recTimer);
    recTimer = setTimeout(async () => {
      if(!root) return;
      try{ await carregar(); }catch(e){ return; }
      if(!root) return;
      if(aba === "pedidos") renderPedidos();   // nas abas de edição não mexe na tela, para não atrapalhar quem está digitando
      renderAbas();
      atualizarBadges();
    }, 350);
  }

  function salvo(){
    const el = $("gesSalvo"); if(!el) return;
    el.textContent = "Salvo";
    clearTimeout(salvo.t); salvo.t = setTimeout(() => { el.textContent = ""; }, 2000);
  }
  function erroAba(msg){ const e = $("gesErro"); if(e){ e.textContent = msg || ""; e.hidden = !msg; } }
  const msgUnico = (e, txt) => e && e.code === "23505" ? txt : msgErro(e);

  /* ----- pedidos ----- */
  const FILTROS = [
    { id: "pendente",  rotulo: "Aguardando",             conta: p => p.status === "pendente" },
    { id: "entrega",   rotulo: "Aguardando recebimento", conta: p => p.status === "pronto" || p.status === "parcial" },
    { id: "concluido", rotulo: "Concluídos",             conta: p => p.status === "concluido" },
    { id: "todos",     rotulo: "Todos",                  conta: () => true }
  ];
  function filtrados(){
    const f = FILTROS.find(x => x.id === filtro) || FILTROS[0];
    const b = busca.trim().toLowerCase();
    return pedidos.filter(f.conta).filter(p => !b || (p.solicitante_nome || "").toLowerCase().includes(b));
  }
  function resumoSeparacao(){
    const m = new Map();
    pedidos.filter(p => p.status === "pendente").forEach(p => p.itens.forEach(i => {
      const k = catDe(i) + "|" + i.tipo_nome + "|" + (i.tamanho === "Único" ? "" : i.tamanho);
      m.set(k, (m.get(k) || 0) + i.quantidade);
    }));
    return [...m.entries()].map(([k, n]) => {
      const [cat, nome, tam] = k.split("|");
      return { cat, rotulo: nome + (tam ? " " + tam : ""), n };
    }).sort((a, b) => ordemCat(a.cat) - ordemCat(b.cat) || cmp(a.rotulo, b.rotulo));
  }

  function renderPedidos(){
    const el = $("gesConteudo"); if(!el) return;
    const foco = document.activeElement && document.activeElement.id === "gesBusca";
    const lista = filtrados();
    const resumo = resumoSeparacao();
    el.innerHTML = `
      <div class="uni-stats">${FILTROS.map(f => `
        <button type="button" class="uni-stat ${f.id === filtro ? "on" : ""}" data-filtro="${f.id}">
          <b>${pedidos.filter(f.conta).length}</b><span>${f.rotulo}</span></button>`).join("")}
      </div>
      ${resumo.length ? `<details class="uni-det"><summary>O que separar para os pedidos aguardando<span class="chev">▸</span></summary>
        <div class="uni-chips">${resumo.map(r => `<span class="uni-chip">${esc(r.rotulo)}${r.cat === "epi" ? ` <span class="uni-tag epi">EPI</span>` : ""} <b>× ${r.n}</b></span>`).join("")}</div></details>` : ""}
      <div class="uni-busca"><input type="search" id="gesBusca" placeholder="Buscar por nome do solicitante" value="${esc(busca)}" aria-label="Buscar por nome"></div>
      <div class="uni-lista">${lista.length
        ? lista.map(p => pedidoHtml(p, "gestao", urls)).join("")
        : `<p class="uni-vazio">${pedidos.length ? "Nenhum pedido neste filtro." : "Nenhuma solicitação ainda. Quando alguém pedir, ela aparece aqui e o número no menu avisa."}</p>`}
      </div>`;
    if(foco){ const b = $("gesBusca"); if(b){ b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }
  }

  /* ----- resposta (pronto / recusa) e mudanças de status ----- */
  async function mudarStatus(p, status, resposta, deStatus){
    const patch = { status, resposta: resposta || "", respondido_por: perfil().id, respondido_em: new Date().toISOString() };
    const { data, error } = await sb().from("uniforme_pedidos").update(patch).eq("id", p.id).in("status", deStatus).select("id");
    if(error) return msgErro(error);
    if(!data || !data.length) return "Este pedido mudou enquanto você olhava. A lista foi atualizada.";
    return "";
  }

  function abrirResposta(p, recusa){
    const el = abrirModal(`
      <h2 class="uni-m-h">${recusa ? "Recusar solicitação" : "Marcar como pronto para retirada"}</h2>
      <p class="uni-m-sub">${recusa
        ? `${esc(p.solicitante_nome || "O solicitante")} verá o motivo em “Meus pedidos”.`
        : `${esc(p.solicitante_nome || "O solicitante")} será avisado(a) e poderá confirmar o recebimento depois de retirar.`}</p>
      <label class="f"><span>${recusa ? "Motivo (obrigatório)" : "Mensagem para o solicitante (opcional)"}</span>
        <textarea id="rsTxt" maxlength="300" data-foco placeholder="${recusa ? "Ex.: já foi entregue um kit este mês" : "Ex.: retirar no RH até sexta-feira"}"></textarea></label>
      <p class="uni-erro" id="rsErro" hidden></p>
      <div class="uni-m-act">
        <button class="btn ghost" type="button" data-fechar>Voltar</button>
        <button class="btn" type="button" id="rsOk">${recusa ? "Recusar pedido" : "Marcar como pronto"}</button>
      </div>`, { titulo: recusa ? "Recusar solicitação" : "Marcar como pronto" });
    el.querySelector("#rsOk").addEventListener("click", async () => {
      const txt = el.querySelector("#rsTxt").value.trim();
      const er = el.querySelector("#rsErro");
      if(recusa && !txt){ er.textContent = "Escreva o motivo da recusa."; er.hidden = false; return; }
      const btn = el.querySelector("#rsOk"); btn.disabled = true;
      const msg = await mudarStatus(p, recusa ? "recusado" : "pronto", txt, ["pendente"]);
      if(msg){ er.textContent = msg; er.hidden = false; btn.disabled = false; if(/mudou/.test(msg)){ fecharModal(); recarregar(); } return; }
      fecharModal();
      window.Platform.toast(recusa ? "Pedido recusado." : "Pedido marcado como pronto. O solicitante foi avisado.");
      await carregar(); renderPedidos(); renderAbas(); atualizarBadges();
    });
  }

  async function voltar(p){
    const msg = await mudarStatus(p, "pendente", "", ["pronto", "recusado"]);
    if(msg) alert(msg);
    await carregar(); renderPedidos(); renderAbas(); atualizarBadges();
  }

  /* ----- itens (catálogo de uniformes e EPIs) ----- */
  const lerTamanhos = s => [...new Set(String(s).split(/[,;\n]+/).map(x => x.trim()).filter(Boolean))];
  const optsCategoria = sel => Object.keys(CATS).map(c => `<option value="${c}" ${c === sel ? "selected" : ""}>${CATS[c]}</option>`).join("");

  function itemLinha(t){
    return `<div class="uni-tipo" data-tipo="${t.id}">
      <label class="f"><span>Nome</span><input type="text" data-tf="nome" maxlength="60" value="${esc(t.nome)}"></label>
      <label class="f"><span>Categoria</span><select data-tf="categoria">${optsCategoria(catDe(t))}</select></label>
      <label class="f"><span>Tamanhos</span><input type="text" data-tf="tamanhos" value="${esc(t.tamanhos.join(", "))}" placeholder="Em branco = tamanho único"></label>
      <label class="uni-sw"><input type="checkbox" data-tf="ativo" ${t.ativo ? "checked" : ""}><span>Disponível</span></label>
      <button class="rm" type="button" data-rmtipo="${t.id}" aria-label="Apagar ${esc(t.nome)}">✕</button>
    </div>`;
  }
  function renderItens(){
    const el = $("gesConteudo"); if(!el) return;
    el.innerHTML = `
      <section class="uni-card">
        <h2 class="uni-h2">Uniformes e EPIs</h2>
        <p class="uni-hint">Este é o catálogo de tudo o que pode entrar no kit de um cargo. Separe os tamanhos por vírgula (ex.: P, M, G ou 38, 40, 42) e deixe em branco para tamanho único. As alterações são salvas na hora. Para tirar um item de circulação sem perder o histórico, desmarque “Disponível”. A quantidade de cada item fica no kit do cargo, na aba <b>Cargos e kits</b>.</p>
        <div id="tpLista">${tipos.length ? tipos.map(itemLinha).join("") : `<p class="uni-vazio">Nenhum item cadastrado ainda.</p>`}</div>
        <div class="uni-tipo novo">
          <label class="f"><span>Novo item</span><input type="text" id="tpNome" maxlength="60" placeholder="Ex.: Colete refletivo"></label>
          <label class="f"><span>Categoria</span><select id="tpCat">${optsCategoria("uniforme")}</select></label>
          <label class="f"><span>Tamanhos</span><input type="text" id="tpTam" placeholder="Ex.: P, M, G, GG"></label>
          <button class="btn" type="button" id="tpAdd">Adicionar item</button>
        </div>
      </section>`;
  }

  async function adicionarItem(){
    erroAba("");
    const nome = $("tpNome").value.trim();
    if(!nome){ erroAba("Digite o nome do item."); return; }
    const ordem = tipos.reduce((m, t) => Math.max(m, t.ordem || 0), 0) + 1;
    const { data, error } = await sb().from("uniforme_tipos")
      .insert({ nome, categoria: $("tpCat").value, tamanhos: lerTamanhos($("tpTam").value), ordem }).select().single();
    if(error){ erroAba(msgUnico(error, "Já existe um item com esse nome.")); return; }
    tipos.push(data); tipos.sort(ordemTipos); renderItens(); salvo();
  }
  async function salvarItem(t, campo, valor, input){
    const patch = {}; patch[campo] = valor;
    const { error } = await sb().from("uniforme_tipos").update(patch).eq("id", t.id);
    if(error){
      erroAba(msgUnico(error, "Já existe um item com esse nome."));
      if(input){
        if(campo === "ativo") input.checked = t.ativo;
        else if(campo === "tamanhos") input.value = t.tamanhos.join(", ");
        else if(campo === "categoria") input.value = catDe(t);
        else input.value = t.nome;
      }
      return;
    }
    erroAba(""); t[campo] = valor; salvo();
    if(campo === "categoria"){ tipos.sort(ordemTipos); renderItens(); }
  }
  async function apagarItem(id){
    const t = tipos.find(x => x.id === id); if(!t) return;
    if(!confirm(`Apagar “${t.nome}”? Ele também sai do kit de todos os cargos, e os pedidos antigos continuam mostrando o nome. Se só quer parar de usar, prefira desmarcar “Disponível”.`)) return;
    const { error } = await sb().from("uniforme_tipos").delete().eq("id", id);
    if(error){ erroAba(msgErro(error)); return; }
    tipos = tipos.filter(x => x.id !== id);
    Object.keys(kits).forEach(cid => { kits[cid] = kits[cid].filter(k => k.tipo_id !== id); });
    renderItens(); salvo();
  }

  /* ----- cargos e kits ----- */
  const kitDe = cid => (kits[cid] || [])
    .map(k => ({ ...k, tipo: tipos.find(t => t.id === k.tipo_id) })).filter(k => k.tipo)
    .sort((a, b) => ordemTipos(a.tipo, b.tipo));

  function cargoHtml(c){
    const kit = kitDe(c.id);
    const livres = tipos.filter(t => t.ativo && !kit.some(k => k.tipo_id === t.id));
    const n = kit.length;
    const admin = !!perfil().admin;   // só admin mexe nas ferramentas do cargo e apaga cargo
    const marcadas = ferr[c.id] || new Set();
    const mods = window.Platform.modulosConfiguraveis();
    const nFerr = mods.filter(m => marcadas.has(m.id)).length;
    return `<details class="uni-cargo ${c.ativo ? "" : "off"}" data-cargo="${c.id}" ${abertos.has(c.id) ? "open" : ""}>
      <summary>
        <span class="uni-cargo-nome">${esc(c.nome)}</span>
        <span class="uni-cargo-info">${ferrOk ? `${nFerr} ${nFerr === 1 ? "ferramenta" : "ferramentas"} · ` : ""}${n} ${n === 1 ? "item" : "itens"} no kit${c.ativo ? "" : " · desativado"}</span>
        <span class="chev">▸</span>
      </summary>
      <div class="uni-cargo-body">
        <div class="uni-cargo-cfg">
          <label class="f"><span>Nome do cargo</span><input type="text" data-cf="nome" maxlength="60" value="${esc(c.nome)}"></label>
          <label class="uni-sw"><input type="checkbox" data-cf="ativo" ${c.ativo ? "checked" : ""}><span>Ativo</span></label>
          ${admin ? `<button class="rm" type="button" data-rmcargo aria-label="Apagar cargo ${esc(c.nome)}">✕</button>` : `<span></span>`}
        </div>
        ${ferrOk ? `<div class="mini">Ferramentas que este cargo libera</div>
        ${admin
          ? (mods.length ? `<div class="uni-cargo-ferr">${mods.map(m => `<label class="uni-sw"><input type="checkbox" data-cgmod="${esc(m.id)}" ${marcadas.has(m.id) ? "checked" : ""}><span>${esc(m.nome)}</span></label>`).join("")}</div>` : `<p class="uni-hint">Nenhuma ferramenta registrada ainda.</p>`)
          : `<p class="uni-hint">${nFerr ? esc(mods.filter(m => marcadas.has(m.id)).map(m => m.nome).join(", ")) : "Nenhuma ferramenta liberada por este cargo."} (só administradores alteram as ferramentas.)</p>`}` : ""}
        <div class="mini">Kit de uniforme e EPI deste cargo</div>
        ${kit.length ? `<ul class="uni-kit-lista">${kit.map(k => `
          <li data-kit="${k.tipo_id}">
            <span class="uni-kit-n"><b>${esc(k.tipo.nome)}</b>${tagEpi(k.tipo)}${k.tipo.ativo ? "" : `<em>indisponível: não aparece nos pedidos</em>`}</span>
            <label class="uni-kit-q">Qtde máx. <input type="number" min="1" max="99" data-kitqtd value="${k.quantidade}"></label>
            <button class="rm" type="button" data-rmkit="${k.tipo_id}" aria-label="Tirar ${esc(k.tipo.nome)} do kit">✕</button>
          </li>`).join("")}</ul>`
          : `<p class="uni-hint">Kit vazio. Adicione abaixo os uniformes e EPIs deste cargo.</p>`}
        ${livres.length ? `<div class="uni-kit-add">
          <label class="f"><span>Adicionar ao kit</span><select data-kitsel>${livres.map(t => `<option value="${t.id}">${esc(t.nome)} (${CATS[catDe(t)]})</option>`).join("")}</select></label>
          <label class="f"><span>Qtde máx.</span><input type="number" min="1" max="99" value="1" data-kitnew></label>
          <button class="btn ghost" type="button" data-addkit>Adicionar</button>
        </div>` : `<p class="uni-hint">Todos os itens disponíveis já estão neste kit.</p>`}
      </div>
    </details>`;
  }
  function renderCargos(){
    const el = $("gesConteudo"); if(!el) return;
    el.innerHTML = `
      <section class="uni-card">
        <h2 class="uni-h2">Cargos e kits</h2>
        <p class="uni-hint">O cargo reúne, num lugar só, as <b>ferramentas</b> que libera para quem o tem e o <b>kit</b> de uniformes e EPIs. No kit, a quantidade cadastrada é o <b>máximo</b> que a pessoa pode pedir de cada item — ao solicitar, ela escolhe quanto precisa (até esse limite) e o tamanho, quando houver. O cargo de cada pessoa é definido na tela <b>Usuários</b> (só administradores). Alterações no kit valem para os próximos pedidos; pedidos já feitos não mudam.</p>
        <div id="cgLista">${cargos.length ? cargos.map(cargoHtml).join("") : `<p class="uni-vazio">Nenhum cargo cadastrado ainda.</p>`}</div>
        <div class="uni-cargo-novo">
          <label class="f"><span>Novo cargo</span><input type="text" id="cgNome" maxlength="60" placeholder="Ex.: Porteiro"></label>
          <button class="btn" type="button" id="cgAdd">Adicionar cargo</button>
        </div>
      </section>`;
  }

  async function adicionarCargo(){
    erroAba("");
    const nome = $("cgNome").value.trim();
    if(!nome){ erroAba("Digite o nome do cargo."); return; }
    const { data, error } = await sb().from("cargos").insert({ nome }).select().single();
    if(error){ erroAba(msgUnico(error, "Já existe um cargo com esse nome.")); return; }
    cargos.push(data); cargos.sort((a, b) => cmp(a.nome, b.nome)); kits[data.id] = []; abertos.add(data.id);
    renderCargos(); salvo();
  }
  async function salvarCargo(c, campo, valor, input){
    const patch = {}; patch[campo] = valor;
    const { error } = await sb().from("cargos").update(patch).eq("id", c.id);
    if(error){
      erroAba(msgUnico(error, "Já existe um cargo com esse nome."));
      if(campo === "ativo") input.checked = c.ativo; else input.value = c.nome;
      return;
    }
    erroAba(""); c[campo] = valor; salvo();
    cargos.sort((a, b) => cmp(a.nome, b.nome)); renderCargos();
  }
  async function apagarCargo(id){
    const c = cargos.find(x => x.id === id); if(!c) return;
    if(!confirm(`Apagar o cargo “${c.nome}”? As pessoas que têm esse cargo ficam sem cargo (e sem as ferramentas que vinham dele) até o administrador definir outro, e o kit é apagado. Se só quer parar de usar, prefira desmarcar “Ativo”.`)) return;
    const { error } = await sb().from("cargos").delete().eq("id", id);
    if(error){ erroAba(msgErro(error)); return; }
    cargos = cargos.filter(x => x.id !== id); delete kits[id]; abertos.delete(id);
    renderCargos(); salvo();
  }
  async function alternarFerramenta(cid, moduloId, chk){
    const ligar = chk.checked;
    chk.disabled = true;
    const t = sb().from("cargo_modulos");
    const { error } = ligar
      ? await t.upsert({ cargo_id: cid, modulo_id: moduloId }, { onConflict: "cargo_id,modulo_id", ignoreDuplicates: true })
      : await t.delete().eq("cargo_id", cid).eq("modulo_id", moduloId);
    chk.disabled = false;
    if(error){ chk.checked = !ligar; erroAba(msgErro(error)); return; }
    erroAba("");
    const set = (ferr[cid] = ferr[cid] || new Set());
    if(ligar) set.add(moduloId); else set.delete(moduloId);
    // atualiza só o resumo do cabeçalho (não fecha o cartão nem tira o foco)
    const info = chk.closest("[data-cargo]").querySelector(".uni-cargo-info");
    if(info){
      const nF = window.Platform.modulosConfiguraveis().filter(m => set.has(m.id)).length;
      const nK = (kits[cid] || []).length;
      const c = cargos.find(x => x.id === cid);
      info.textContent = `${nF} ${nF === 1 ? "ferramenta" : "ferramentas"} · ${nK} ${nK === 1 ? "item" : "itens"} no kit${c && !c.ativo ? " · desativado" : ""}`;
    }
    salvo();
  }
  async function adicionarAoKit(cid, card){
    erroAba("");
    const tipoId = card.querySelector("[data-kitsel]").value;
    const qtd = parseInt(card.querySelector("[data-kitnew]").value, 10);
    if(!tipoId) return;
    if(!(qtd >= 1 && qtd <= 99)){ erroAba("Informe uma quantidade de 1 a 99."); return; }
    const { error } = await sb().from("cargo_itens").insert({ cargo_id: cid, tipo_id: tipoId, quantidade: qtd });
    if(error){ erroAba(msgUnico(error, "Esse item já está no kit.")); return; }
    (kits[cid] = kits[cid] || []).push({ cargo_id: cid, tipo_id: tipoId, quantidade: qtd });
    renderCargos(); salvo();
  }
  async function tirarDoKit(cid, tipoId){
    const { error } = await sb().from("cargo_itens").delete().eq("cargo_id", cid).eq("tipo_id", tipoId);
    if(error){ erroAba(msgErro(error)); return; }
    kits[cid] = (kits[cid] || []).filter(k => k.tipo_id !== tipoId);
    renderCargos(); salvo();
  }
  async function mudarQtdKit(cid, tipoId, input){
    const k = (kits[cid] || []).find(x => x.tipo_id === tipoId); if(!k) return;
    const qtd = parseInt(input.value, 10);
    if(!(qtd >= 1 && qtd <= 99)){ input.value = k.quantidade; erroAba("Informe uma quantidade de 1 a 99."); return; }
    if(qtd === k.quantidade) return;
    const { error } = await sb().from("cargo_itens").update({ quantidade: qtd }).eq("cargo_id", cid).eq("tipo_id", tipoId);
    if(error){ input.value = k.quantidade; erroAba(msgErro(error)); return; }
    erroAba(""); k.quantidade = qtd; salvo();
  }

  /* ----- eventos ----- */
  on("click", e => {
    const b = e.target.closest("button"); if(!b) return;
    if(b.dataset.aba){ aba = b.dataset.aba; erroAba(""); renderAba(); return; }
    if(b.dataset.filtro){ filtro = b.dataset.filtro; renderPedidos(); return; }
    const acha = id => pedidos.find(p => p.id === id);
    if(b.dataset.pronto){ const p = acha(b.dataset.pronto); if(p) abrirResposta(p, false); return; }
    if(b.dataset.recusar){ const p = acha(b.dataset.recusar); if(p) abrirResposta(p, true); return; }
    if(b.dataset.voltar){ const p = acha(b.dataset.voltar); if(p) voltar(p); return; }
    if(b.id === "tpAdd"){ adicionarItem(); return; }
    if(b.dataset.rmtipo){ apagarItem(b.dataset.rmtipo); return; }
    if(b.id === "cgAdd"){ adicionarCargo(); return; }
    const card = b.closest("[data-cargo]");
    if(card){
      const cid = card.dataset.cargo;
      if(b.hasAttribute("data-rmcargo")){ apagarCargo(cid); return; }
      if(b.hasAttribute("data-addkit")){ adicionarAoKit(cid, card); return; }
      if(b.dataset.rmkit){ tirarDoKit(cid, b.dataset.rmkit); return; }
    }
  });
  on("input", e => { if(e.target.id === "gesBusca"){ busca = e.target.value; renderPedidos(); } });
  on("change", e => {
    const t = e.target;
    const linha = t.closest("[data-tipo]");
    if(linha && t.dataset.tf){
      const tp = tipos.find(x => x.id === linha.dataset.tipo); if(!tp) return;
      if(t.dataset.tf === "nome"){
        const nome = t.value.trim();
        if(!nome){ t.value = tp.nome; return; }
        if(nome !== tp.nome) salvarItem(tp, "nome", nome, t);
      }else if(t.dataset.tf === "tamanhos"){
        const tam = lerTamanhos(t.value);
        t.value = tam.join(", ");
        if(tam.join("|") !== tp.tamanhos.join("|")) salvarItem(tp, "tamanhos", tam, t);
      }else if(t.dataset.tf === "categoria"){
        if(t.value !== catDe(tp)) salvarItem(tp, "categoria", t.value, t);
      }else if(t.dataset.tf === "ativo") salvarItem(tp, "ativo", t.checked, t);
      return;
    }
    const card = t.closest("[data-cargo]");
    if(card){
      const c = cargos.find(x => x.id === card.dataset.cargo); if(!c) return;
      if(t.dataset.cf === "nome"){
        const nome = t.value.trim();
        if(!nome){ t.value = c.nome; return; }
        if(nome !== c.nome) salvarCargo(c, "nome", nome, t);
      }else if(t.dataset.cf === "ativo") salvarCargo(c, "ativo", t.checked, t);
      else if(t.hasAttribute("data-kitqtd")) mudarQtdKit(c.id, t.closest("[data-kit]").dataset.kit, t);
      else if(t.hasAttribute("data-cgmod")) alternarFerramenta(c.id, t.dataset.cgmod, t);
    }
  });
  on("keydown", e => {
    if(e.key !== "Enter") return;
    if(e.target.id === "tpNome" || e.target.id === "tpTam"){ e.preventDefault(); adicionarItem(); }
    else if(e.target.id === "cgNome"){ e.preventDefault(); adicionarCargo(); }
  });
  // lembra quais cargos estão abertos (o evento "toggle" não sobe na árvore, por isso a captura)
  on("toggle", e => {
    const d = e.target;
    if(d.matches && d.matches("details[data-cargo]")){ d.open ? abertos.add(d.dataset.cargo) : abertos.delete(d.dataset.cargo); }
  }, true);

  function renderAbas(){
    const el = $("gesAbas"); if(!el) return;
    const aguardando = pedidos.filter(p => p.status === "pendente").length;
    el.innerHTML = `
      <button type="button" class="${aba === "pedidos" ? "on" : ""}" data-aba="pedidos">Solicitações${aguardando ? ` <i>${aguardando}</i>` : ""}</button>
      <button type="button" class="${aba === "cargos" ? "on" : ""}" data-aba="cargos">Cargos e kits</button>
      <button type="button" class="${aba === "itens" ? "on" : ""}" data-aba="itens">Uniformes e EPIs</button>`;
  }

  const TEMPLATE = `
  <div class="uni-wrap">
    <h1 class="uni-h">Solicitações de uniforme e EPI</h1>
    <p class="uni-sub">Pedidos de uniforme e EPI da equipe. Quando alguém solicitar, o número no menu e um aviso na tela chamam sua atenção.</p>
    <div class="uni-abas-linha"><div class="uni-abas" id="gesAbas"></div><span class="uni-salvo" id="gesSalvo" aria-live="polite"></span></div>
    <p class="uni-erro" id="gesErro" hidden></p>
    <div id="gesConteudo"></div>
  </div>`;

  async function mount(el){
    root = el; root.className = "mod-uni";
    root.innerHTML = `<div class="uni-wrap"><p class="hint" style="padding:40px 0">Carregando…</p></div>`;
    try{ await carregar(); }
    catch(e){ if(root === el) root.innerHTML = avisoConfig(e); return; }
    if(root !== el) return;
    root.innerHTML = TEMPLATE;
    ouvintes.forEach(([t, fn, cap]) => root.addEventListener(t, fn, cap));
    aba = "pedidos";
    renderAba();
    escutas.add(recarregar);
    atualizarBadges();
  }
  function unmount(){
    fecharModal();
    clearTimeout(recTimer);
    escutas.delete(recarregar);
    if(root) ouvintes.forEach(([t, fn, cap]) => root.removeEventListener(t, fn, cap));
    root = null;
  }
  return { mount, unmount };
})();

/* ---------- registro na plataforma ---------- */
window.Platform.register({
  id: MOD_SOL,
  categoria: "uniformes",
  menu: "Solicitar uniforme e EPI",
  nome: "Solicitar uniforme e EPI",
  descricao: "Peça o kit de uniforme e EPI do seu cargo escolhendo só o tamanho e confirme o recebimento com uma foto.",
  icone: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  aoIniciar: iniciarAvisos,
  mount: SOL.mount, unmount: SOL.unmount
});

window.Platform.register({
  id: MOD_GES,
  categoria: "uniformes",
  menu: "Solicitações de uniforme e EPI",
  nome: "Solicitações de uniforme e EPI",
  descricao: "Atenda os pedidos, confira as assinaturas e edite os cargos, os kits e os uniformes e EPIs.",
  icone: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  aoIniciar: iniciarAvisos,
  mount: GES.mount, unmount: GES.unmount
});

})();
