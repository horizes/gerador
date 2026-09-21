/* Fluxo de caixa — módulo da plataforma Imperium.
   Painel da esquerda: só o formulário "Novo lançamento".
   Página da direita (a planilha): resumo, exportar/backup, filtros, categorias, dados salvos,
   planilha editável (tabela) e totais por categoria.
   Os dados ficam no Supabase (tabelas fluxo_lancamentos e fluxo_categorias), compartilhados
   por todos os usuários logados — não é mais por navegador. Veja supabase-schema.sql para
   criar as tabelas e o bucket de anexos. O botão "Salvar backup (.json)" continua útil como
   cópia de segurança pessoal; "Importar backup (.json)" agora ADICIONA os lançamentos do
   arquivo aos dados atuais (em vez de substituir), já que os dados são de todos. */
(function(){
"use strict";

const sb = () => window.Imperium.supabase;
const BUCKET_ANEXOS = "anexos";

let root = null;
let anexoPendente = null; // anexo (nota fiscal/foto) já processado, aguardando o próximo "Adicionar lançamento"
const ouvintes = [];
function on(tipo, fn){ ouvintes.push([tipo, fn]); }

const $ = id => document.getElementById(id);

const CATEGORIAS_PADRAO = {
  entrada: ["Prestação de serviços", "Outras receitas"],
  saida:   ["Salários e encargos", "Fornecedores", "Aluguel", "Impostos e taxas", "Combustível e manutenção", "Outras despesas"]
};
const FORMAS = ["Pix", "Dinheiro", "Cartão", "Boleto", "Transferência", "Outro"];

const hoje = () => new Date().toISOString().slice(0,10);
const mesDe = iso => (iso||"").slice(0,7);

const ESTADO_INICIAL = () => ({
  categorias: JSON.parse(JSON.stringify(CATEGORIAS_PADRAO)),
  lancamentos: [],
  filtro: { mes: mesDe(hoje()), tipo: "todos", categoria: "" }
});
let S = ESTADO_INICIAL();

/* ---------- filtro: preferência pessoal, continua no localStorage do navegador ---------- */
function salvarFiltro(){ try{ localStorage.setItem("imperium_fluxo_filtro", JSON.stringify(S.filtro)); }catch(e){} }
function carregarFiltro(){
  try{
    const v = JSON.parse(localStorage.getItem("imperium_fluxo_filtro") || "null");
    if(v) S.filtro = Object.assign(S.filtro, v);
  }catch(e){}
}

/* ---------- helpers ---------- */
const n2 = v => (Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const brl = v => "R$ " + n2(v);
const esc = s => String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const MES=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
function rotuloMes(m){ // "2026-09" -> "Setembro de 2026"
  if(!m) return "";
  const [a,mm]=m.split("-").map(Number);
  const nome=MES[(mm||1)-1]||"";
  return nome.charAt(0).toUpperCase()+nome.slice(1)+" de "+a;
}
function achar(id){ return S.lancamentos.find(l=>l.id===id); }

function mesesDisponiveis(){
  const s = new Set([mesDe(hoje())]);
  if(S.filtro.mes) s.add(S.filtro.mes);
  S.lancamentos.forEach(l=>{ if(l.data) s.add(mesDe(l.data)); });
  return [...s].sort().reverse();
}
function categoriasDisponiveisFiltro(){
  const s = new Set([...S.categorias.entrada, ...S.categorias.saida]);
  return [...s];
}
function filtrados(){
  return S.lancamentos
    .filter(l => !S.filtro.mes || mesDe(l.data)===S.filtro.mes)
    .filter(l => S.filtro.tipo==="todos" || l.tipo===S.filtro.tipo)
    .filter(l => !S.filtro.categoria || l.categoria===S.filtro.categoria)
    .sort((a,b)=> (b.data||"").localeCompare(a.data||"") || (b.criado_em||"").localeCompare(a.criado_em||""));
}
function saldoAtual(){
  return S.lancamentos.filter(l=>l.status==="pago")
    .reduce((s,l)=> s + (l.tipo==="entrada" ? +l.valor||0 : -(+l.valor||0)), 0);
}
function totaisPeriodo(){
  const f = filtrados();
  const entradas = f.filter(l=>l.tipo==="entrada").reduce((s,l)=>s+(+l.valor||0),0);
  const saidas   = f.filter(l=>l.tipo==="saida").reduce((s,l)=>s+(+l.valor||0),0);
  return { entradas, saidas, saldo: entradas - saidas };
}
function porCategoria(){
  const f = filtrados();
  const mapa = {};
  f.forEach(l=>{
    const k = l.tipo+"|"+l.categoria;
    mapa[k] = mapa[k] || {tipo:l.tipo, categoria:l.categoria, total:0};
    mapa[k].total += (+l.valor||0);
  });
  return Object.values(mapa).sort((a,b)=> b.total - a.total);
}

/* ---------- anexo (nota fiscal / foto do comprovante) ----------
   Antes de salvar, fica embutido como dataURL (preview local). Ao confirmar o lançamento,
   é enviado para o Storage do Supabase (bucket "anexos") e só o caminho/URL fica salvo
   na tabela — assim não esbarra no limite do localStorage nem fica preso a um navegador. */
const ANEXO_TAMANHO_MAX = 8*1024*1024; // 8 MB no arquivo original enviado

function lerArquivo(file){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    r.readAsDataURL(file);
  });
}
function comprimirImagem(file, maxLado, qualidade){
  return new Promise((resolve, reject)=>{
    const r = new FileReader();
    r.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        if(w > maxLado || h > maxLado){
          const escala = Math.min(maxLado/w, maxLado/h);
          w = Math.round(w*escala); h = Math.round(h*escala);
        }
        const cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL("image/jpeg", qualidade));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}
async function processarAnexo(file){
  if(!file) return null;
  if(file.size > ANEXO_TAMANHO_MAX){ alert("Arquivo muito grande (máximo 8 MB)."); return null; }
  let dataUrl;
  if(file.type.startsWith("image/")){
    try{ dataUrl = await comprimirImagem(file, 1600, 0.72); }
    catch(e){ dataUrl = await lerArquivo(file); }
  }else if(file.type === "application/pdf"){
    dataUrl = await lerArquivo(file);
  }else{
    alert("Envie uma foto (JPG/PNG) ou um PDF.");
    return null;
  }
  return { nome: file.name, tipo: file.type, dataUrl };
}
function anexoIconeHtml(a){
  return a.tipo.startsWith("image/")
    ? `<img src="${a.url || a.dataUrl}" alt="">`
    : `<span class="anexo-ico">PDF</span>`;
}
async function enviarAnexo(pendente){
  if(!pendente) return null;
  try{
    const blob = await (await fetch(pendente.dataUrl)).blob();
    const ext = pendente.tipo === "application/pdf" ? "pdf" : (pendente.tipo.split("/")[1] || "jpg");
    const caminho = `${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
    const { error } = await sb().storage.from(BUCKET_ANEXOS).upload(caminho, blob, { contentType: pendente.tipo, upsert: false });
    if(error) throw error;
    return { path: caminho, nome: pendente.nome, tipo: pendente.tipo };
  }catch(e){
    alert("Não foi possível enviar o anexo: " + e.message);
    return null;
  }
}
function urlAnexo(caminho){
  return sb().storage.from(BUCKET_ANEXOS).getPublicUrl(caminho).data.publicUrl;
}

/* ---------- carregamento a partir do Supabase ---------- */
function mapRow(r){
  return {
    id: r.id, data: r.data, tipo: r.tipo, categoria: r.categoria,
    descricao: r.descricao || "", forma: r.forma || "Pix", status: r.status, valor: +r.valor || 0,
    criado_em: r.criado_em,
    anexo: r.anexo_path ? { nome: r.anexo_nome, tipo: r.anexo_tipo, path: r.anexo_path, url: urlAnexo(r.anexo_path) } : null
  };
}
async function carregarCategorias(){
  const { data, error } = await sb().from("fluxo_categorias").select("tipo,nome").order("nome");
  const cat = { entrada: [], saida: [] };
  if(!error && data) data.forEach(r=>{ if(cat[r.tipo]) cat[r.tipo].push(r.nome); });
  if(!cat.entrada.length && !cat.saida.length) return JSON.parse(JSON.stringify(CATEGORIAS_PADRAO));
  return cat;
}
async function carregarLancamentos(){
  const { data, error } = await sb().from("fluxo_lancamentos").select("*")
    .order("data", { ascending:false }).order("criado_em", { ascending:false });
  if(error){ alert("Não foi possível carregar os lançamentos: " + error.message); return []; }
  return (data||[]).map(mapRow);
}
async function carregar(){
  carregarFiltro();
  const [cat, lanc] = await Promise.all([carregarCategorias(), carregarLancamentos()]);
  S.categorias = cat;
  S.lancamentos = lanc;
}

/* ---------- ações sobre lançamentos (gravam direto no Supabase) ---------- */
const timers = {};
function salvarCampos(id, patch){
  sb().from("fluxo_lancamentos").update(patch).eq("id", id).then(({error})=>{
    if(error) alert("Não foi possível salvar a alteração: " + error.message);
  });
}
function agendarSalvar(id, patch){
  timers[id+"_patch"] = Object.assign(timers[id+"_patch"] || {}, patch);
  clearTimeout(timers[id]);
  timers[id] = setTimeout(()=>{
    const p = timers[id+"_patch"];
    delete timers[id+"_patch"];
    salvarCampos(id, p);
  }, 600);
}

async function adicionarLancamento(){
  const btn = $("qzAdd");
  btn.disabled = true; const txt = btn.textContent; btn.textContent = "Adicionando…";

  const anexoInfo = anexoPendente ? await enviarAnexo(anexoPendente) : null;
  const linha = {
    data: $("qzData").value || hoje(),
    tipo: $("qzTipo").value,
    categoria: $("qzCategoria").value,
    descricao: $("qzDescricao").value.trim(),
    forma: $("qzForma").value,
    status: $("qzStatus").value,
    valor: +$("qzValor").value || 0,
    anexo_nome: anexoInfo ? anexoInfo.nome : null,
    anexo_tipo: anexoInfo ? anexoInfo.tipo : null,
    anexo_path: anexoInfo ? anexoInfo.path : null
  };
  const { data, error } = await sb().from("fluxo_lancamentos").insert(linha).select().single();
  btn.disabled = false; btn.textContent = txt;
  if(error){ alert("Não foi possível salvar o lançamento: " + error.message); return; }

  S.lancamentos.unshift(mapRow(data));
  anexoPendente = null;
  renderFiltros(); renderStage(); renderResumo();
  $("qzDescricao").value = ""; $("qzValor").value = "0"; $("qzDescricao").focus();
  if($("qzAnexo")) $("qzAnexo").value = "";
  if($("qzAnexoLabel")) $("qzAnexoLabel").textContent = "Anexar foto ou PDF";
  $("qzAnexoPrev").innerHTML = "";
}

async function excluirLancamento(id){
  const { error } = await sb().from("fluxo_lancamentos").delete().eq("id", id);
  if(error){ alert("Não foi possível excluir: " + error.message); return; }
  S.lancamentos = S.lancamentos.filter(l=>l.id!==id);
  renderFiltros(); renderStage(); renderResumo();
}

async function removerAnexo(id){
  const l = achar(id);
  if(!l) return;
  const caminho = l.anexo && l.anexo.path;
  const { error } = await sb().from("fluxo_lancamentos")
    .update({ anexo_nome:null, anexo_tipo:null, anexo_path:null }).eq("id", id);
  if(error){ alert("Não foi possível remover o anexo: " + error.message); return; }
  l.anexo = null;
  renderStage();
  if(caminho) sb().storage.from(BUCKET_ANEXOS).remove([caminho]).catch(()=>{});
}

async function adicionarCategoria(tipo, nome){
  if(S.categorias[tipo].includes(nome)) return;
  const { error } = await sb().from("fluxo_categorias").insert({ tipo, nome });
  if(error){
    if(!/duplicate|unique/i.test(error.message)) alert("Não foi possível adicionar a categoria: " + error.message);
    return;
  }
  S.categorias[tipo].push(nome);
  renderFiltros(); renderCategorias(); atualizarCategoriasForm();
}
async function removerCategoria(tipo, nome){
  const { error } = await sb().from("fluxo_categorias").delete().eq("tipo", tipo).eq("nome", nome);
  if(error){ alert("Não foi possível remover a categoria: " + error.message); return; }
  S.categorias[tipo] = S.categorias[tipo].filter(c=>c!==nome);
  const filtroPerdido = S.filtro.categoria && !categoriasDisponiveisFiltro().includes(S.filtro.categoria);
  if(filtroPerdido) S.filtro.categoria = "";
  salvarFiltro();
  renderFiltros(); renderCategorias(); atualizarCategoriasForm();
  if(filtroPerdido){ renderStage(); renderResumo(); }
}

async function limparTudo(){
  const { error } = await sb().from("fluxo_lancamentos").delete().not("id", "is", null);
  if(error){ alert("Não foi possível apagar: " + error.message); return; }
  S.lancamentos = [];
  renderFiltros(); renderStage(); renderResumo();
}

/* ---------- exportação / importação ---------- */
function baixar(blob, nome){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
}
function csvEsc(s){
  s = String(s==null?"":s);
  return /[;"\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
function exportarCSV(){
  const linhas = [["Data","Tipo","Categoria","Descrição","Forma","Status","Valor","Anexo"].join(";")];
  filtrados().slice().reverse().forEach(l=>{
    linhas.push([
      l.data, l.tipo==="entrada"?"Entrada":"Saída", csvEsc(l.categoria), csvEsc(l.descricao),
      l.forma, l.status==="pago"?"Pago":"Pendente", n2(l.valor), l.anexo ? "Sim" : "Não"
    ].join(";"));
  });
  baixar(new Blob(["\uFEFF"+linhas.join("\r\n")], {type:"text/csv;charset=utf-8"}), "fluxo-de-caixa.csv");
}
function exportarBackup(){
  baixar(new Blob([JSON.stringify(S,null,2)], {type:"application/json"}), "fluxo-de-caixa-backup.json");
}
function importarBackup(file){
  const r = new FileReader();
  r.onload = async () => {
    let v;
    try{
      v = JSON.parse(r.result);
      if(!v || !Array.isArray(v.lancamentos)) throw new Error("formato inválido");
    }catch(e){ alert("Não foi possível importar: arquivo inválido."); return; }

    if(!confirm(`Isso vai ADICIONAR ${v.lancamentos.length} lançamento(s) deste arquivo aos dados atuais (compartilhados pela empresa, não só deste navegador). Continuar?`)) return;

    if(v.categorias){
      for(const tipo of ["entrada","saida"]){
        for(const nome of (v.categorias[tipo]||[])){
          if(!S.categorias[tipo].includes(nome)) await adicionarCategoria(tipo, nome);
        }
      }
    }
    for(const l of v.lancamentos){
      const anexoInfo = (l.anexo && l.anexo.dataUrl) ? await enviarAnexo(l.anexo) : null;
      await sb().from("fluxo_lancamentos").insert({
        data: l.data || hoje(), tipo: l.tipo==="entrada" ? "entrada" : "saida",
        categoria: l.categoria || "", descricao: l.descricao || "", forma: l.forma || "Pix",
        status: l.status==="pago" ? "pago" : "pendente", valor: +l.valor || 0,
        anexo_nome: anexoInfo ? anexoInfo.nome : null,
        anexo_tipo: anexoInfo ? anexoInfo.tipo : null,
        anexo_path: anexoInfo ? anexoInfo.path : null
      });
    }
    await carregar();
    renderTudo();
    alert("Importação concluída.");
  };
  r.readAsText(file);
}

/* ---------- painel da esquerda (rail): só o novo lançamento ---------- */
function opcoes(lista, atual){
  return lista.map(v=>`<option value="${esc(v)}" ${v===atual?"selected":""}>${esc(v)}</option>`).join("");
}
function categoriasChips(tipo){
  return S.categorias[tipo].map(c=>
    `<span class="cat-chip">${esc(c)}<button type="button" data-rmcat="${tipo}|${esc(c)}" aria-label="Remover categoria">×</button></span>`
  ).join("") || `<span class="hint" style="margin:0">Nenhuma categoria cadastrada.</span>`;
}

function anexoPendentePreviewHtml(){
  if(!anexoPendente) return "";
  return `<div class="anexo-prev">
    <div class="anexo-thumb">${anexoIconeHtml(anexoPendente)}</div>
    <span class="anexo-nome">${esc(anexoPendente.nome)}</span>
    <button type="button" class="anexo-rm" id="qzAnexoRm" aria-label="Remover anexo">×</button>
  </div>`;
}

const TEMPLATE_RAIL = () => `
<div class="brand"><h1>Fluxo de Caixa<span>Lançamentos e planilha</span></h1></div>

<section class="sec sec-static">
  <h2 class="sec-title">Novo lançamento</h2>
  <div class="body">
    <label class="f"><span>Data</span><input type="date" id="qzData" value="${hoje()}"></label>
    <div class="row">
      <label class="f"><span>Tipo</span>
        <select id="qzTipo">
          <option value="saida">Saída</option>
          <option value="entrada">Entrada</option>
        </select>
      </label>
      <label class="f"><span>Status</span>
        <select id="qzStatus">
          <option value="pendente">Pendente</option>
          <option value="pago">Pago</option>
        </select>
      </label>
    </div>
    <label class="f"><span>Categoria</span><select id="qzCategoria">${opcoes(S.categorias.saida)}</select></label>
    <label class="f"><span>Descrição</span><input type="text" id="qzDescricao" placeholder="Ex.: aluguel de setembro"></label>
    <div class="row">
      <label class="f"><span>Forma</span><select id="qzForma">${opcoes(FORMAS)}</select></label>
      <label class="f"><span>Valor (R$)</span><input type="number" id="qzValor" step="0.01" min="0" value="0"></label>
    </div>
    <label class="f" for="qzAnexo"><span>Nota fiscal / comprovante</span>
      <div class="anexo-input">
        <input type="file" id="qzAnexo" accept="image/*,application/pdf" capture="environment">
        <span id="qzAnexoLabel">${anexoPendente ? "Trocar arquivo" : "Anexar foto ou PDF"}</span>
      </div>
    </label>
    <div id="qzAnexoPrev">${anexoPendentePreviewHtml()}</div>
    <button class="btn wide" id="qzAdd" type="button">Adicionar lançamento</button>
  </div>
</section>
`;

function painel(){
  $("rail").innerHTML = TEMPLATE_RAIL();
}

/* ---------- controles da planilha (página da direita) ---------- */
function renderFiltros(){
  const el = $("filtros");
  if(!el) return;
  el.innerHTML = `
    <label class="f"><span>Período</span>
      <select id="fMes">
        <option value="">Todos os períodos</option>
        ${mesesDisponiveis().map(m=>`<option value="${m}" ${m===S.filtro.mes?"selected":""}>${rotuloMes(m)}</option>`).join("")}
      </select>
    </label>
    <label class="f"><span>Tipo</span>
      <select id="fTipo">
        <option value="todos" ${S.filtro.tipo==="todos"?"selected":""}>Todos</option>
        <option value="entrada" ${S.filtro.tipo==="entrada"?"selected":""}>Entradas</option>
        <option value="saida" ${S.filtro.tipo==="saida"?"selected":""}>Saídas</option>
      </select>
    </label>
    <label class="f"><span>Categoria</span>
      <select id="fCategoria">
        <option value="">Todas</option>
        ${opcoes(categoriasDisponiveisFiltro(), S.filtro.categoria)}
      </select>
    </label>`;
}
function renderCategorias(){
  $("catEntrada").innerHTML = categoriasChips("entrada");
  $("catSaida").innerHTML = categoriasChips("saida");
}
/* o formulário "Novo lançamento" não é redesenhado (para não perder o que já foi digitado):
   só a lista de categorias dele é atualizada */
function atualizarCategoriasForm(){
  const sel = $("qzCategoria"), tipo = $("qzTipo");
  if(!sel || !tipo) return;
  sel.innerHTML = opcoes(S.categorias[tipo.value] || [], sel.value);
}
function renderTudo(){
  renderFiltros(); renderCategorias(); atualizarCategoriasForm();
  renderStage(); renderResumo();
}

/* ---------- planilha (stage) ---------- */
function linhaHtml(l){
  const cats = S.categorias[l.tipo] || [];
  const catOpts = cats.includes(l.categoria) ? cats : [l.categoria, ...cats].filter(Boolean);
  return `<tr data-row="${l.id}">
    <td><input type="date" data-f="data" value="${esc(l.data)}"></td>
    <td><select data-f="tipo">
      <option value="saida" ${l.tipo==="saida"?"selected":""}>Saída</option>
      <option value="entrada" ${l.tipo==="entrada"?"selected":""}>Entrada</option>
    </select></td>
    <td><select data-f="categoria">${opcoes(catOpts, l.categoria)}</select></td>
    <td><input type="text" data-f="descricao" value="${esc(l.descricao)}" placeholder="Descrição"></td>
    <td><select data-f="forma">${opcoes(FORMAS, l.forma)}</select></td>
    <td><select data-f="status" class="st-${l.status}">
      <option value="pendente" ${l.status==="pendente"?"selected":""}>Pendente</option>
      <option value="pago" ${l.status==="pago"?"selected":""}>Pago</option>
    </select></td>
    <td class="vcell ${l.tipo}"><input type="number" data-f="valor" step="0.01" value="${+l.valor||0}"></td>
    <td class="anexo-cell">${l.anexo ? `
      <a class="anexo-thumb" href="${l.anexo.url}" target="_blank" rel="noopener" title="${esc(l.anexo.nome)}">${anexoIconeHtml(l.anexo)}</a>
      <button type="button" class="anexo-rm" data-rmanexo="${l.id}" aria-label="Remover anexo">×</button>
    ` : `<span class="anexo-vazio" aria-label="Sem anexo">—</span>`}</td>
    <td><button class="rm" data-del="${l.id}" aria-label="Excluir">✕</button></td>
  </tr>`;
}

function renderStage(){
  const f = filtrados();
  $("tbody").innerHTML = f.length ? f.map(linhaHtml).join("") :
    `<tr class="vazio"><td colspan="9">Nenhum lançamento neste filtro ainda.</td></tr>`;
}

function renderResumo(){
  const t = totaisPeriodo();
  const rotulo = S.filtro.mes ? rotuloMes(S.filtro.mes) : "todos os períodos";
  $("resumo").innerHTML = `
    <div class="calc-chip">
      <div class="calc-row total"><span>Saldo atual (lançamentos pagos)</span><b class="${saldoAtual()<0?"neg":""}">${brl(saldoAtual())}</b></div>
      <div class="calc-row"><span>Entradas — ${esc(rotulo)}</span><b>${brl(t.entradas)}</b></div>
      <div class="calc-row"><span>Saídas — ${esc(rotulo)}</span><b>${brl(t.saidas)}</b></div>
      <div class="calc-row lucro ${t.saldo<0?"neg":""}"><span>Saldo do período</span><b>${brl(t.saldo)}</b></div>
    </div>`;
  const cats = porCategoria();
  const maxCat = Math.max(1, ...cats.map(c=>c.total));
  $("porcat").innerHTML = !cats.length ? "" : `
    <div class="mini">Por categoria — ${esc(rotulo)}</div>
    ${cats.map(c=>{
      const pct = Math.max(4, Math.round((c.total/maxCat)*100));
      return `<div class="dash-cat">
        <div class="dash-cat-top"><span>${esc(c.categoria)}</span><b class="${c.tipo}">${brl(c.total)}</b></div>
        <div class="dash-cat-bar"><i class="${c.tipo}" style="width:${pct}%"></i></div>
      </div>`;
    }).join("")}`;
}

/* ---------- eventos ---------- */
on("input", e=>{
  const t = e.target;
  const tr = t.closest("[data-row]");
  if(tr && t.dataset.f){
    const l = achar(tr.dataset.row);
    if(l){
      const val = t.type==="number" ? (+t.value||0) : t.value;
      l[t.dataset.f] = val;
      renderResumo();
      agendarSalvar(l.id, { [t.dataset.f]: val });
    }
  }
});

on("change", e=>{
  const t = e.target;
  const tr = t.closest("[data-row]");
  if(tr && t.dataset.f){
    const l = achar(tr.dataset.row);
    if(l){
      const campo = t.dataset.f;
      l[campo] = t.type==="number" ? (+t.value||0) : t.value;
      const patch = { [campo]: l[campo] };
      if(campo==="tipo" && !S.categorias[l.tipo].includes(l.categoria)){
        l.categoria = S.categorias[l.tipo][0] || "";
        patch.categoria = l.categoria;
      }
      salvarCampos(l.id, patch);
      renderFiltros(); renderStage(); renderResumo();
    }
    return;
  }
  if(t.id==="fMes"){ S.filtro.mes = t.value; salvarFiltro(); renderStage(); renderResumo(); return; }
  if(t.id==="fTipo"){ S.filtro.tipo = t.value; salvarFiltro(); renderStage(); renderResumo(); return; }
  if(t.id==="fCategoria"){ S.filtro.categoria = t.value; salvarFiltro(); renderStage(); renderResumo(); return; }
  if(t.id==="qzTipo"){ $("qzCategoria").innerHTML = opcoes(S.categorias[t.value]); return; }
  if(t.id==="impJson" && t.files[0]){ importarBackup(t.files[0]); t.value=""; return; }

  if(t.id==="qzAnexo" && t.files[0]){
    const arquivo = t.files[0];
    processarAnexo(arquivo).then(a=>{
      if(!a) { t.value=""; return; }
      anexoPendente = a;
      if($("qzAnexoLabel")) $("qzAnexoLabel").textContent = "Trocar arquivo";
      $("qzAnexoPrev").innerHTML = anexoPendentePreviewHtml();
    });
    return;
  }
});

on("click", e=>{
  const b = e.target.closest("button");
  if(!b) return;

  if(b.dataset.del){ if(confirm("Excluir este lançamento?")) excluirLancamento(b.dataset.del); return; }

  if(b.dataset.rmcat){
    const [tipo, nome] = b.dataset.rmcat.split("|");
    removerCategoria(tipo, nome);
    return;
  }

  if(b.id==="catAdd"){
    const tipo = $("catTipo").value, nome = $("catNome").value.trim();
    if(nome) adicionarCategoria(tipo, nome);
    $("catNome").value = "";
    $("catNome").focus();
    return;
  }

  if(b.id==="qzAdd"){ adicionarLancamento(); return; }

  if(b.id==="qzAnexoRm"){
    anexoPendente = null;
    if($("qzAnexo")) $("qzAnexo").value = "";
    if($("qzAnexoLabel")) $("qzAnexoLabel").textContent = "Anexar foto ou PDF";
    $("qzAnexoPrev").innerHTML = "";
    return;
  }

  if(b.dataset.rmanexo){ removerAnexo(b.dataset.rmanexo); return; }

  if(b.id==="expCsv"){ exportarCSV(); return; }
  if(b.id==="expJson"){ exportarBackup(); return; }
  if(b.id==="impJsonBtn"){ $("impJson").click(); return; }
  if(b.id==="limparTudo"){
    if(confirm("Isso apaga todos os lançamentos da empresa (de todos os usuários, não só deste navegador). Recomendado exportar um backup antes. Continuar?")){
      limparTudo();
    }
    return;
  }
});

/* ---------- integração com a plataforma ---------- */
const TEMPLATE = `
<div class="tabs">
  <button data-tab="edit" class="on">Lançar</button>
  <button data-tab="prev">Planilha</button>
</div>
<div class="app">
  <aside class="rail" id="rail"></aside>
  <main class="stage">
    <div class="fx-wrap">
      <div class="fx-toolbar">
        <div class="fx-resumo" id="resumo"></div>
        <div class="fx-acoes">
          <button class="btn ghost" id="expCsv" type="button">Exportar planilha (.csv)</button>
          <button class="btn ghost" id="expJson" type="button">Salvar backup (.json)</button>
          <button class="btn ghost" id="impJsonBtn" type="button">Importar backup (.json)</button>
          <input type="file" id="impJson" accept="application/json" style="display:none">
        </div>
      </div>

      <div class="fx-bar" id="filtros"></div>

      <div class="fx-extras">
        <details class="fx-det">
          <summary>Categorias<span class="chev">▸</span></summary>
          <div class="body">
            <div class="mini">Entradas</div>
            <div class="cat-list" id="catEntrada"></div>
            <div class="mini">Saídas</div>
            <div class="cat-list" id="catSaida"></div>
            <div class="row" style="margin-top:12px">
              <label class="f"><span>Tipo</span>
                <select id="catTipo"><option value="saida">Saída</option><option value="entrada">Entrada</option></select>
              </label>
              <label class="f"><span>Nova categoria</span><input type="text" id="catNome" placeholder="Nome"></label>
            </div>
            <button class="btn ghost wide" id="catAdd" type="button">Adicionar categoria</button>
          </div>
        </details>
        <details class="fx-det">
          <summary>Dados salvos<span class="chev">▸</span></summary>
          <div class="body">
            <p class="hint" style="margin-top:0">O .csv exporta os lançamentos do filtro atual e abre no Excel, Google Sheets ou LibreOffice Calc.</p>
            <p class="hint">Os lançamentos ficam no banco de dados da empresa (compartilhados entre todos que fizerem login).
              O backup (.json) continua útil como cópia de segurança pessoal.</p>
            <button class="rm wide" id="limparTudo" type="button" style="margin-top:10px;width:100%">Apagar todos os lançamentos</button>
          </div>
        </details>
      </div>

      <div class="fx-card">
        <div class="fx-scroll">
          <table class="fx-tbl">
            <thead><tr>
              <th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Forma</th><th>Status</th><th>Valor</th><th>Anexo</th><th></th>
            </tr></thead>
            <tbody id="tbody"></tbody>
          </table>
        </div>
      </div>
      <div id="porcat"></div>
    </div>
  </main>
</div>`;

const TEMPLATE_CARREGANDO = `<div class="fx-wrap"><p class="hint" style="padding:40px 0">Carregando dados do fluxo de caixa…</p></div>`;

async function mount(el){
  root = el;
  root.className = "mod-fluxo m-edit";
  root.innerHTML = TEMPLATE_CARREGANDO;

  await carregar();
  if(root !== el) return; // usuário já saiu do módulo antes de terminar de carregar

  root.innerHTML = TEMPLATE;
  ouvintes.forEach(([t,fn]) => root.addEventListener(t, fn));
  root.querySelectorAll(".tabs button").forEach(b=>{
    b.addEventListener("click", ()=>{
      root.querySelectorAll(".tabs button").forEach(x=>x.classList.toggle("on", x===b));
      root.className = "mod-fluxo " + (b.dataset.tab==="prev" ? "m-prev" : "m-edit");
    });
  });
  painel();
  renderTudo();
}

function unmount(){
  if(!root) return;
  ouvintes.forEach(([t,fn]) => root.removeEventListener(t, fn));
  root = null;
}

Platform.register({
  id: "fluxo",
  categoria: "financeiro",
  menu: "Fluxo de Caixa",
  nome: "Fluxo de caixa",
  descricao: "Lance entradas e saídas, acompanhe o saldo por período e exporte para planilha (.csv).",
  icone: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" fill="currentColor" stroke="none"/><rect x="12" y="8" width="3" height="10" fill="currentColor" stroke="none"/><rect x="17" y="5" width="3" height="13" fill="currentColor" stroke="none"/>',
  mount, unmount
});

})();
