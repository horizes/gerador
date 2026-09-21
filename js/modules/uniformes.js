/* Uniformes — duas ferramentas ligadas pelo mesmo banco (Supabase):

   "Solicitar uniforme"      (id uniforme_solicitar) — qualquer pessoa liberada pede uniforme (tipo, tamanho,
                             quantidade) e, quando o pedido fica pronto, confirma o recebimento com uma foto do
                             rosto carimbada com local, data e hora (assinatura digital).
   "Solicitações de uniforme" (id uniforme_gestao)   — o responsável vê os pedidos, marca como pronto ou recusa,
                             confere as assinaturas e edita os tipos de uniforme.

   Quem vê cada uma é definido na tela "Usuários". Tabelas, regras de segurança e funções:
   supabase-schema-uniformes.sql. As fotos ficam num bucket PRIVADO ("uniforme-assinaturas") e são abertas
   por links temporários. */
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
const ordemItens = (a,b) => String(a.tipo_nome).localeCompare(String(b.tipo_nome),"pt-BR") || String(a.tamanho).localeCompare(String(b.tamanho),"pt-BR",{numeric:true});

function msgErro(e){
  const m = (e && e.message) || String(e);
  if(/schema cache|does not exist|Could not find|relation .* does not exist/i.test(m)){
    return "O banco ainda não tem as tabelas de uniformes. Rode o arquivo supabase-schema-uniformes.sql no SQL Editor do Supabase (veja o README).";
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
          window.Platform.toast(`Nova solicitação de uniforme de ${n.solicitante_nome || "um colaborador"}.`, "#/" + MOD_GES);
        }
        if(payload.eventType === "UPDATE" && n.solicitante_id === P.id && n.status === "pronto"){
          window.Platform.toast("Seu uniforme está pronto para retirada. Depois de retirar, confirme o recebimento.", "#/" + MOD_SOL);
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
  const sub = modo === "gestao" ? `Pedido #${curto(p.id)} · ${dh(p.criado_em)}` : dh(p.criado_em);

  let acoes = "";
  if(modo === "meu"){
    if((p.status === "pronto" || p.status === "parcial") && pendentes.length){
      acoes += `<button class="btn" type="button" data-receber="${p.id}">Recebi o uniforme</button>`;
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
      : `<p class="uni-nota">Retire seu uniforme e toque em <b>Recebi o uniforme</b> para confirmar${p.status === "parcial" ? " o que faltava" : ""}.</p>`;
  }

  return `<article class="uni-ped st-${p.status}" data-ped="${p.id}">
    <header class="uni-ped-h">
      <div><b>${titulo}</b><small>${sub}</small></div>
      <span class="uni-badge ${st.cls}">${st.rotulo}</span>
    </header>
    <ul class="uni-itens">${p.itens.map(itemHtml).join("")}</ul>
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
   Ferramenta 1 — Solicitar uniforme
   ===================================================================================================== */
const SOL = (function(){
  let root = null;
  let tipos = [], pedidos = [], urls = {};
  let linhas = [], obsPedido = "";
  const ouvintes = [];
  const on = (t, fn) => ouvintes.push([t, fn]);
  const $ = id => root && root.querySelector("#" + id);

  const tipoDe = id => tipos.find(t => t.id === id);
  const novaLinha = () => ({ tipo_id: "", tamanho: "", quantidade: 1, obs: "" });

  async function carregar(){
    const [t, p] = await Promise.all([lerTipos(true), lerPedidos(true)]);
    tipos = t; pedidos = p;
    urls = await assinarFotos(pedidos);
  }

  /* ----- formulário do novo pedido ----- */
  function opcoesTipo(sel){
    return `<option value="">Selecione</option>` + tipos.map(t => `<option value="${t.id}" ${t.id===sel?"selected":""}>${esc(t.nome)}</option>`).join("");
  }
  function opcoesTamanho(l){
    const t = tipoDe(l.tipo_id);
    if(!t) return `<option value="">—</option>`;
    if(!t.tamanhos.length) return `<option value="Único">Tamanho único</option>`;
    return `<option value="">Selecione</option>` + t.tamanhos.map(s => `<option ${s===l.tamanho?"selected":""}>${esc(s)}</option>`).join("");
  }
  function renderLinhas(){
    const el = $("uniLinhas"); if(!el) return;
    el.innerHTML = linhas.map((l, i) => `
      <div class="uni-linha" data-i="${i}">
        <label class="f"><span>Tipo</span><select data-f="tipo_id">${opcoesTipo(l.tipo_id)}</select></label>
        <label class="f"><span>Tamanho</span><select data-f="tamanho" ${tipoDe(l.tipo_id)?"":"disabled"}>${opcoesTamanho(l)}</select></label>
        <label class="f uni-qtd"><span>Qtde</span><input type="number" min="1" max="99" inputmode="numeric" data-f="quantidade" value="${l.quantidade}"></label>
        <label class="f uni-linha-obs"><span>Observação</span><input type="text" maxlength="120" data-f="obs" value="${esc(l.obs)}" placeholder="Opcional (ex.: manga longa)"></label>
        <button class="rm" type="button" data-rmlinha="${i}" aria-label="Remover item" ${linhas.length===1?"disabled":""}>✕</button>
      </div>`).join("");
  }
  function erroForm(msg){
    const el = $("uniErro"); if(!el) return;
    el.textContent = msg || ""; el.hidden = !msg;
  }

  async function enviar(){
    erroForm("");
    if(!tipos.length){ erroForm("Ainda não há tipos de uniforme cadastrados. Fale com o responsável."); return; }
    const itens = [];
    for(let i = 0; i < linhas.length; i++){
      const l = linhas[i], t = tipoDe(l.tipo_id);
      if(!t){ erroForm(`Item ${i+1}: escolha o tipo de uniforme.`); return; }
      if(t.tamanhos.length && !l.tamanho){ erroForm(`Item ${i+1}: escolha o tamanho de ${t.nome}.`); return; }
      const q = parseInt(l.quantidade, 10);
      if(!(q >= 1 && q <= 99)){ erroForm(`Item ${i+1}: informe uma quantidade de 1 a 99.`); return; }
      itens.push({ tipo_id: t.id, tamanho: l.tamanho, quantidade: q, observacao: l.obs.trim() });
    }
    const btn = $("uniEnviar"); btn.disabled = true; btn.textContent = "Enviando…";
    const { error } = await sb().rpc("uniforme_criar_pedido", { p_observacao: obsPedido.trim(), p_itens: itens });
    btn.disabled = false; btn.textContent = "Enviar solicitação";
    if(error){ erroForm(msgErro(error)); return; }
    linhas = [novaLinha()]; obsPedido = "";
    if($("uniObs")) $("uniObs").value = "";
    renderLinhas();
    window.Platform.toast("Solicitação enviada. O responsável já foi avisado.");
    await recarregar();
    const meus = $("uniMeusCard"); if(meus) meus.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ----- meus pedidos ----- */
  function renderMeus(){
    const el = $("uniMeus"); if(!el) return;
    el.innerHTML = pedidos.length
      ? pedidos.map(p => pedidoHtml(p, "meu", urls)).join("")
      : `<p class="uni-vazio">Você ainda não fez nenhum pedido. Preencha o formulário acima para pedir seu uniforme.</p>`;
    const prontos = pedidos.filter(p => (p.status === "pronto" || p.status === "parcial") && p.itens.some(i => !i.recebimento_id));
    const av = $("uniAviso");
    if(av) av.innerHTML = prontos.length
      ? `<div class="uni-destaque"><b>${prontos.length === 1 ? "Você tem um pedido pronto para retirada." : `Você tem ${prontos.length} pedidos prontos para retirada.`}</b>
         <span>Depois de retirar, toque em “Recebi o uniforme” no pedido para confirmar.</span></div>`
      : "";
  }
  async function recarregar(){
    try{
      pedidos = await lerPedidos(true);
      urls = await assinarFotos(pedidos);
    }catch(e){ return; }
    renderMeus();
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
      <h2 class="uni-m-h">Recebi o uniforme</h2>
      <p class="uni-m-sub">Pedido #${curto(pedido.id)}. Marque o que você recebeu. O que ficar desmarcado continua pendente e você confirma depois.</p>

      <div class="uni-m-sec">
        <div class="uni-m-top"><span class="mini">Itens recebidos</span><button class="uni-link" type="button" data-todos>Marcar todos</button></div>
        <ul class="uni-sel">${pend.map(i => `
          <li><label class="tg"><input type="checkbox" data-item="${i.id}" checked>
            <span><b>${esc(i.tipo_nome)}</b>${i.tamanho && i.tamanho !== "Único" ? " " + esc(i.tamanho) : ""} × ${i.quantidade}</span></label></li>`).join("")}
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
        `Imperium · Recebimento de uniforme · Pedido #${curto(pedido.id)}`,
        perfil().nome || "",
        dataHora,
        R.local,
        `Lat ${R.pos.lat.toFixed(5)}  Lng ${R.pos.lng.toFixed(5)}  (±${Math.round(R.pos.prec)} m)`
      ].filter(Boolean);
    }

    async function fixarFoto(fonte, w, h, metodo){
      if(!R.pos){ erro("Ainda sem localização. Aguarde ou tente de novo."); return; }
      R.capturadoEm = new Date();
      const esc1 = Math.min(1, 1000 / Math.max(w, h));
      const cw = Math.round(w * esc1), ch = Math.round(h * esc1);
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
  on("change", e => {
    const t = e.target, linha = t.closest("[data-i]");
    if(!linha || !t.dataset.f) return;
    const l = linhas[+linha.dataset.i]; if(!l) return;
    if(t.dataset.f === "tipo_id"){
      l.tipo_id = t.value;
      const tp = tipoDe(t.value);
      l.tamanho = tp && !tp.tamanhos.length ? "Único" : "";
      renderLinhas();
    }else if(t.dataset.f === "tamanho") l.tamanho = t.value;
  });
  on("input", e => {
    const t = e.target;
    if(t.id === "uniObs"){ obsPedido = t.value; return; }
    const linha = t.closest("[data-i]"); if(!linha || !t.dataset.f) return;
    const l = linhas[+linha.dataset.i]; if(!l) return;
    if(t.dataset.f === "quantidade") l.quantidade = t.value;
    if(t.dataset.f === "obs") l.obs = t.value;
  });
  on("click", e => {
    const b = e.target.closest("button"); if(!b) return;
    if(b.dataset.rmlinha !== undefined){ if(linhas.length > 1){ linhas.splice(+b.dataset.rmlinha, 1); renderLinhas(); } return; }
    if(b.id === "uniAddLinha"){ linhas.push(novaLinha()); renderLinhas(); return; }
    if(b.id === "uniEnviar"){ enviar(); return; }
    if(b.dataset.receber){ const p = pedidos.find(x => x.id === b.dataset.receber); if(p) abrirRecebimento(p); return; }
    if(b.dataset.cancelar){ cancelar(b.dataset.cancelar); return; }
  });

  const TEMPLATE = `
  <div class="uni-wrap">
    <h1 class="uni-h">Solicitar uniforme</h1>
    <p class="uni-sub">Peça o uniforme que você precisa. A pessoa responsável é avisada assim que você enviar.</p>
    <div id="uniAviso"></div>

    <section class="uni-card">
      <h2 class="uni-h2">Novo pedido</h2>
      <div id="uniLinhas"></div>
      <button class="btn ghost" type="button" id="uniAddLinha">Adicionar outro item</button>
      <label class="f" style="margin-top:18px"><span>Observação do pedido (opcional)</span>
        <textarea id="uniObs" maxlength="500" placeholder="Ex.: preciso para o posto do cliente"></textarea></label>
      <p class="uni-erro" id="uniErro" hidden></p>
      <button class="btn" type="button" id="uniEnviar">Enviar solicitação</button>
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
    linhas = [novaLinha()]; obsPedido = "";
    ouvintes.forEach(([t, fn]) => root.addEventListener(t, fn));
    renderLinhas(); renderMeus();
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
   Ferramenta 2 — Solicitações de uniforme (responsável)
   ===================================================================================================== */
const GES = (function(){
  let root = null;
  let pedidos = [], tipos = [], urls = {};
  let aba = "pedidos", filtro = "pendente", busca = "";
  const ouvintes = [];
  const on = (t, fn) => ouvintes.push([t, fn]);
  const $ = id => root && root.querySelector("#" + id);

  async function carregar(){
    const [p, t] = await Promise.all([lerPedidos(false), lerTipos(false)]);
    pedidos = p; tipos = t;
    urls = await assinarFotos(pedidos);
  }
  let recTimer = null;
  function recarregar(){   // chamado quando chega pedido novo: espera um instante para juntar várias mudanças
    clearTimeout(recTimer);
    recTimer = setTimeout(async () => {
      if(!root) return;
      try{ await carregar(); }catch(e){ return; }
      if(!root) return;
      if(aba === "pedidos") renderPedidos(); else renderTipos();
      renderAbas();
      atualizarBadges();
    }, 350);
  }

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
      const k = i.tipo_nome + "|" + (i.tamanho === "Único" ? "" : i.tamanho);
      m.set(k, (m.get(k) || 0) + i.quantidade);
    }));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { numeric: true })).map(([k, n]) => {
      const [nome, tam] = k.split("|");
      return { rotulo: nome + (tam ? " " + tam : ""), n };
    });
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
        <div class="uni-chips">${resumo.map(r => `<span class="uni-chip">${esc(r.rotulo)} <b>× ${r.n}</b></span>`).join("")}</div></details>` : ""}
      <div class="uni-busca"><input type="search" id="gesBusca" placeholder="Buscar por nome do solicitante" value="${esc(busca)}" aria-label="Buscar por nome"></div>
      <div class="uni-lista">${lista.length
        ? lista.map(p => pedidoHtml(p, "gestao", urls)).join("")
        : `<p class="uni-vazio">${pedidos.length ? "Nenhum pedido neste filtro." : "Nenhuma solicitação de uniforme ainda. Quando alguém pedir, ela aparece aqui e o número no menu avisa."}</p>`}
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
        <textarea id="rsTxt" maxlength="300" data-foco placeholder="${recusa ? "Ex.: já foi entregue um uniforme este mês" : "Ex.: retirar no RH até sexta-feira"}"></textarea></label>
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

  /* ----- tipos de uniforme ----- */
  const lerTamanhos = s => [...new Set(String(s).split(/[,;\n]+/).map(x => x.trim()).filter(Boolean))];
  function salvo(){
    const el = $("tpStatus"); if(!el) return;
    el.textContent = "Salvo";
    clearTimeout(salvo.t); salvo.t = setTimeout(() => { el.textContent = ""; }, 2000);
  }
  function tipoLinha(t){
    return `<div class="uni-tipo" data-tipo="${t.id}">
      <label class="f"><span>Nome</span><input type="text" data-tf="nome" maxlength="60" value="${esc(t.nome)}"></label>
      <label class="f"><span>Tamanhos</span><input type="text" data-tf="tamanhos" value="${esc(t.tamanhos.join(", "))}" placeholder="Em branco = tamanho único"></label>
      <label class="uni-sw"><input type="checkbox" data-tf="ativo" ${t.ativo ? "checked" : ""}><span>Disponível</span></label>
      <button class="rm" type="button" data-rmtipo="${t.id}" aria-label="Apagar tipo ${esc(t.nome)}">✕</button>
    </div>`;
  }
  function renderTipos(){
    const el = $("gesConteudo"); if(!el) return;
    el.innerHTML = `
      <section class="uni-card">
        <div class="uni-card-top"><h2 class="uni-h2">Tipos de uniforme</h2><span class="uni-salvo" id="tpStatus" aria-live="polite"></span></div>
        <p class="uni-hint">Estes são os itens que as pessoas veem ao solicitar. Separe os tamanhos por vírgula e deixe em branco para tamanho único. As alterações são salvas na hora. Para tirar um tipo da lista sem perder o histórico, desmarque “Disponível”.</p>
        <div id="tpLista">${tipos.length ? tipos.map(tipoLinha).join("") : `<p class="uni-vazio">Nenhum tipo cadastrado ainda.</p>`}</div>
        <div class="uni-tipo novo">
          <label class="f"><span>Novo tipo</span><input type="text" id="tpNome" maxlength="60" placeholder="Ex.: Colete"></label>
          <label class="f"><span>Tamanhos</span><input type="text" id="tpTam" placeholder="Ex.: P, M, G, GG"></label>
          <button class="btn" type="button" id="tpAdd">Adicionar tipo</button>
        </div>
        <p class="uni-erro" id="tpErro" hidden></p>
      </section>`;
  }
  function erroTipos(msg){ const e = $("tpErro"); if(e){ e.textContent = msg || ""; e.hidden = !msg; } }
  const msgTipo = e => e && e.code === "23505" ? "Já existe um tipo com esse nome." : msgErro(e);

  async function adicionarTipo(){
    erroTipos("");
    const nome = $("tpNome").value.trim();
    if(!nome){ erroTipos("Digite o nome do tipo de uniforme."); return; }
    const ordem = tipos.reduce((m, t) => Math.max(m, t.ordem || 0), 0) + 1;
    const { data, error } = await sb().from("uniforme_tipos").insert({ nome, tamanhos: lerTamanhos($("tpTam").value), ordem }).select().single();
    if(error){ erroTipos(msgTipo(error)); return; }
    tipos.push(data); renderTipos(); salvo();
  }
  async function salvarCampo(t, campo, valor, input){
    const patch = {}; patch[campo] = valor;
    const { error } = await sb().from("uniforme_tipos").update(patch).eq("id", t.id);
    if(error){
      erroTipos(msgTipo(error));
      if(input){ if(campo === "ativo") input.checked = t.ativo; else input.value = campo === "tamanhos" ? t.tamanhos.join(", ") : t.nome; }
      return;
    }
    erroTipos(""); t[campo] = valor; salvo();
  }
  async function apagarTipo(id){
    const t = tipos.find(x => x.id === id); if(!t) return;
    if(!confirm(`Apagar o tipo “${t.nome}”? Os pedidos antigos continuam mostrando o nome. Se só quer tirá-lo da lista de pedidos, prefira desmarcar “Disponível”.`)) return;
    const { error } = await sb().from("uniforme_tipos").delete().eq("id", id);
    if(error){ erroTipos(msgErro(error)); return; }
    tipos = tipos.filter(x => x.id !== id); renderTipos(); salvo();
  }

  /* ----- eventos ----- */
  on("click", e => {
    const b = e.target.closest("button"); if(!b) return;
    if(b.dataset.aba){ aba = b.dataset.aba; renderAbas(); aba === "pedidos" ? renderPedidos() : renderTipos(); return; }
    if(b.dataset.filtro){ filtro = b.dataset.filtro; renderPedidos(); return; }
    const acha = id => pedidos.find(p => p.id === id);
    if(b.dataset.pronto){ const p = acha(b.dataset.pronto); if(p) abrirResposta(p, false); return; }
    if(b.dataset.recusar){ const p = acha(b.dataset.recusar); if(p) abrirResposta(p, true); return; }
    if(b.dataset.voltar){ const p = acha(b.dataset.voltar); if(p) voltar(p); return; }
    if(b.id === "tpAdd"){ adicionarTipo(); return; }
    if(b.dataset.rmtipo){ apagarTipo(b.dataset.rmtipo); return; }
  });
  on("input", e => { if(e.target.id === "gesBusca"){ busca = e.target.value; renderPedidos(); } });
  on("change", e => {
    const t = e.target, linha = t.closest("[data-tipo]");
    if(!linha || !t.dataset.tf) return;
    const tp = tipos.find(x => x.id === linha.dataset.tipo); if(!tp) return;
    if(t.dataset.tf === "nome"){
      const nome = t.value.trim();
      if(!nome){ t.value = tp.nome; return; }
      if(nome !== tp.nome) salvarCampo(tp, "nome", nome, t);
    }else if(t.dataset.tf === "tamanhos"){
      const tam = lerTamanhos(t.value);
      t.value = tam.join(", ");
      if(tam.join("|") !== tp.tamanhos.join("|")) salvarCampo(tp, "tamanhos", tam, t);
    }else if(t.dataset.tf === "ativo") salvarCampo(tp, "ativo", t.checked, t);
  });
  on("keydown", e => { if(e.key === "Enter" && (e.target.id === "tpNome" || e.target.id === "tpTam")){ e.preventDefault(); adicionarTipo(); } });

  function renderAbas(){
    const el = $("gesAbas"); if(!el) return;
    const aguardando = pedidos.filter(p => p.status === "pendente").length;
    el.innerHTML = `
      <button type="button" class="${aba === "pedidos" ? "on" : ""}" data-aba="pedidos">Solicitações${aguardando ? ` <i>${aguardando}</i>` : ""}</button>
      <button type="button" class="${aba === "tipos" ? "on" : ""}" data-aba="tipos">Tipos de uniforme</button>`;
  }

  const TEMPLATE = `
  <div class="uni-wrap">
    <h1 class="uni-h">Solicitações de uniforme</h1>
    <p class="uni-sub">Pedidos de uniforme da equipe. Quando alguém solicitar, o número no menu e um aviso na tela chamam sua atenção.</p>
    <div class="uni-abas" id="gesAbas"></div>
    <div id="gesConteudo"></div>
  </div>`;

  async function mount(el){
    root = el; root.className = "mod-uni";
    root.innerHTML = `<div class="uni-wrap"><p class="hint" style="padding:40px 0">Carregando…</p></div>`;
    try{ await carregar(); }
    catch(e){ if(root === el) root.innerHTML = avisoConfig(e); return; }
    if(root !== el) return;
    root.innerHTML = TEMPLATE;
    ouvintes.forEach(([t, fn]) => root.addEventListener(t, fn));
    aba = "pedidos";
    renderAbas(); renderPedidos();
    escutas.add(recarregar);
    atualizarBadges();
  }
  function unmount(){
    fecharModal();
    clearTimeout(recTimer);
    escutas.delete(recarregar);
    if(root) ouvintes.forEach(([t, fn]) => root.removeEventListener(t, fn));
    root = null;
  }
  return { mount, unmount };
})();

/* ---------- registro na plataforma ---------- */
window.Platform.register({
  id: MOD_SOL,
  categoria: "uniformes",
  menu: "Solicitar uniforme",
  nome: "Solicitar uniforme",
  descricao: "Peça camiseta, calça, sapato, bata e outros uniformes e confirme o recebimento com uma foto.",
  icone: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  aoIniciar: iniciarAvisos,
  mount: SOL.mount, unmount: SOL.unmount
});

window.Platform.register({
  id: MOD_GES,
  categoria: "uniformes",
  menu: "Solicitações de uniforme",
  nome: "Solicitações de uniforme",
  descricao: "Veja os pedidos de uniforme, marque como pronto ou recuse, confira as assinaturas e edite os tipos de uniforme.",
  icone: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  aoIniciar: iniciarAvisos,
  mount: GES.mount, unmount: GES.unmount
});

})();
