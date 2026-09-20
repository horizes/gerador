/* Fluxo de caixa — módulo da plataforma Imperium.
   Lançamentos de entrada/saída com painel de filtros, planilha editável (tabela),
   resumo por período e exportação para .csv (abre em Excel/Google Sheets).
   Os dados ficam salvos no localStorage do navegador (ver seção "Backup" no painel);
   por ser um site estático sem servidor, o backup em .json é a forma de levar os
   lançamentos para outro computador/navegador ou de não perder tudo ao limpar o cache. */
(function(){
"use strict";

let root = null;
let iniciado = false;
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
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);

const ESTADO_INICIAL = () => ({
  categorias: JSON.parse(JSON.stringify(CATEGORIAS_PADRAO)),
  lancamentos: [],
  filtro: { mes: mesDe(hoje()), tipo: "todos", categoria: "" }
});
let S = ESTADO_INICIAL();

/* ---------- persistência (localStorage do navegador) ---------- */
function salvar(){ try{ localStorage.setItem("imperium_fluxo", JSON.stringify(S)); }catch(e){} }
function carregar(){
  try{
    const raw = localStorage.getItem("imperium_fluxo");
    if(!raw) return;
    const v = JSON.parse(raw);
    if(v && Array.isArray(v.lancamentos)){
      S = Object.assign(ESTADO_INICIAL(), v);
      if(!S.categorias) S.categorias = JSON.parse(JSON.stringify(CATEGORIAS_PADRAO));
      if(!S.filtro) S.filtro = { mes: mesDe(hoje()), tipo: "todos", categoria: "" };
    }
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
    .sort((a,b)=> (b.data||"").localeCompare(a.data||"") || (b.id||"").localeCompare(a.id||""));
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

/* ---------- ações sobre lançamentos ---------- */
function novoLancamento(base){
  return Object.assign({
    id: uid(), data: hoje(), tipo: "saida",
    categoria: S.categorias.saida[0] || "",
    descricao: "", forma: "Pix", status: "pendente", valor: 0
  }, base||{});
}
function excluir(id){
  S.lancamentos = S.lancamentos.filter(l=>l.id!==id);
  salvar(); renderStage(); renderResumo();
}

/* ---------- exportação ---------- */
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
  const linhas = [["Data","Tipo","Categoria","Descrição","Forma","Status","Valor"].join(";")];
  filtrados().slice().reverse().forEach(l=>{
    linhas.push([
      l.data, l.tipo==="entrada"?"Entrada":"Saída", csvEsc(l.categoria), csvEsc(l.descricao),
      l.forma, l.status==="pago"?"Pago":"Pendente", n2(l.valor)
    ].join(";"));
  });
  baixar(new Blob(["\uFEFF"+linhas.join("\r\n")], {type:"text/csv;charset=utf-8"}), "fluxo-de-caixa.csv");
}
function exportarBackup(){
  baixar(new Blob([JSON.stringify(S,null,2)], {type:"application/json"}), "fluxo-de-caixa-backup.json");
}
function importarBackup(file){
  const r = new FileReader();
  r.onload = () => {
    try{
      const v = JSON.parse(r.result);
      if(!v || !Array.isArray(v.lancamentos)) throw new Error("formato inválido");
      if(!confirm("Importar vai substituir todos os lançamentos atuais deste navegador pelos do arquivo. Continuar?")) return;
      S = Object.assign(ESTADO_INICIAL(), v);
      if(!S.categorias) S.categorias = JSON.parse(JSON.stringify(CATEGORIAS_PADRAO));
      salvar(); painel(); renderStage(); renderResumo();
    }catch(e){ alert("Não foi possível importar: arquivo inválido."); }
  };
  r.readAsText(file);
}

/* ---------- painel (rail) ---------- */
function opcoes(lista, atual){
  return lista.map(v=>`<option value="${esc(v)}" ${v===atual?"selected":""}>${esc(v)}</option>`).join("");
}
function categoriasChips(tipo){
  return S.categorias[tipo].map(c=>
    `<span class="cat-chip">${esc(c)}<button type="button" data-rmcat="${tipo}|${esc(c)}" aria-label="Remover categoria">×</button></span>`
  ).join("") || `<span class="hint" style="margin:0">Nenhuma categoria cadastrada.</span>`;
}

const TEMPLATE_RAIL = () => `
<div class="brand"><h1>Fluxo de Caixa<span>Lançamentos e planilha</span></h1></div>

<details class="sec" open>
  <summary>Novo lançamento<span class="chev">▸</span></summary>
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
    <button class="btn wide" id="qzAdd" type="button">Adicionar lançamento</button>
  </div>
</details>

<details class="sec" open>
  <summary>Filtros<span class="chev">▸</span></summary>
  <div class="body">
    <label class="f"><span>Período</span>
      <select id="fMes">
        <option value="">Todos os períodos</option>
        ${mesesDisponiveis().map(m=>`<option value="${m}" ${m===S.filtro.mes?"selected":""}>${rotuloMes(m)}</option>`).join("")}
      </select>
    </label>
    <div class="row">
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
      </label>
    </div>
  </div>
</details>

<details class="sec">
  <summary>Categorias<span class="chev">▸</span></summary>
  <div class="body">
    <div class="mini">Entradas</div>
    <div class="cat-list">${categoriasChips("entrada")}</div>
    <div class="mini">Saídas</div>
    <div class="cat-list">${categoriasChips("saida")}</div>
    <div class="row" style="margin-top:12px">
      <label class="f"><span>Tipo</span>
        <select id="catTipo"><option value="saida">Saída</option><option value="entrada">Entrada</option></select>
      </label>
      <label class="f"><span>Nova categoria</span><input type="text" id="catNome" placeholder="Nome"></label>
    </div>
    <button class="btn ghost wide" id="catAdd" type="button">Adicionar categoria</button>
  </div>
</details>

<details class="sec">
  <summary>Planilha e backup<span class="chev">▸</span></summary>
  <div class="body">
    <button class="btn wide" id="expCsv" type="button">Exportar para planilha (.csv)</button>
    <p class="hint">Abre no Excel, Google Sheets ou LibreOffice Calc. Exporta os lançamentos do filtro atual.</p>
    <button class="btn ghost wide" id="expJson" type="button" style="margin-top:6px">Salvar backup (.json)</button>
    <button class="btn ghost wide" id="impJsonBtn" type="button" style="margin-top:6px">Importar backup (.json)</button>
    <input type="file" id="impJson" accept="application/json" style="display:none">
    <p class="hint">Os lançamentos ficam salvos apenas neste navegador. Para usar em outro computador/celular, ou para
      não perder nada ao limpar o navegador, exporte um backup de tempos em tempos e importe-o quando precisar.</p>
    <button class="rm wide" id="limparTudo" type="button" style="margin-top:10px;width:100%">Apagar todos os lançamentos</button>
  </div>
</details>
`;

function painel(){
  $("rail").innerHTML = TEMPLATE_RAIL();
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
    <td><button class="rm" data-del="${l.id}" aria-label="Excluir">✕</button></td>
  </tr>`;
}

function renderStage(){
  const f = filtrados();
  $("tbody").innerHTML = f.length ? f.map(linhaHtml).join("") :
    `<tr class="vazio"><td colspan="8">Nenhum lançamento neste filtro ainda.</td></tr>`;
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
  $("porcat").innerHTML = !cats.length ? "" : `
    <div class="mini">Por categoria — ${esc(rotulo)}</div>
    <table class="dt fx-cat">
      <tbody>
        ${cats.map(c=>`<tr><td class="l">${esc(c.categoria)}</td><td>${c.tipo==="entrada"?"Entrada":"Saída"}</td><td class="v ${c.tipo}">${brl(c.total)}</td></tr>`).join("")}
      </tbody>
    </table>`;
}

/* ---------- eventos ---------- */
on("input", e=>{
  const t = e.target;
  const tr = t.closest("[data-row]");
  if(tr && t.dataset.f){
    const l = achar(tr.dataset.row);
    if(l){
      l[t.dataset.f] = t.type==="number" ? (+t.value||0) : t.value;
      salvar(); renderResumo();
    }
  }
});

on("change", e=>{
  const t = e.target;
  const tr = t.closest("[data-row]");
  if(tr && t.dataset.f){
    const l = achar(tr.dataset.row);
    if(l){
      l[t.dataset.f] = t.type==="number" ? (+t.value||0) : t.value;
      if(t.dataset.f==="tipo" && !S.categorias[l.tipo].includes(l.categoria)) l.categoria = S.categorias[l.tipo][0] || "";
      salvar(); renderStage(); renderResumo();
    }
    return;
  }
  if(t.id==="fMes"){ S.filtro.mes = t.value; salvar(); renderStage(); renderResumo(); return; }
  if(t.id==="fTipo"){ S.filtro.tipo = t.value; salvar(); renderStage(); renderResumo(); return; }
  if(t.id==="fCategoria"){ S.filtro.categoria = t.value; salvar(); renderStage(); renderResumo(); return; }
  if(t.id==="qzTipo"){ $("qzCategoria").innerHTML = opcoes(S.categorias[t.value]); return; }
  if(t.id==="impJson" && t.files[0]){ importarBackup(t.files[0]); t.value=""; return; }
});

on("click", e=>{
  const b = e.target.closest("button");
  if(!b) return;

  if(b.dataset.del){ if(confirm("Excluir este lançamento?")) excluir(b.dataset.del); return; }

  if(b.dataset.rmcat){
    const [tipo, nome] = b.dataset.rmcat.split("|");
    S.categorias[tipo] = S.categorias[tipo].filter(c=>c!==nome);
    salvar(); painel(); return;
  }

  if(b.id==="catAdd"){
    const tipo = $("catTipo").value, nome = $("catNome").value.trim();
    if(nome && !S.categorias[tipo].includes(nome)) S.categorias[tipo].push(nome);
    salvar(); painel(); return;
  }

  if(b.id==="qzAdd"){
    const l = novoLancamento({
      data: $("qzData").value || hoje(),
      tipo: $("qzTipo").value,
      categoria: $("qzCategoria").value,
      descricao: $("qzDescricao").value.trim(),
      forma: $("qzForma").value,
      status: $("qzStatus").value,
      valor: +$("qzValor").value || 0
    });
    S.lancamentos.push(l);
    salvar(); renderStage(); renderResumo();
    $("qzDescricao").value = ""; $("qzValor").value = "0"; $("qzDescricao").focus();
    return;
  }

  if(b.id==="addrow"){
    const l = novoLancamento();
    S.lancamentos.push(l);
    salvar(); renderStage(); renderResumo();
    const novaLinha = root.querySelector(`[data-row="${l.id}"] [data-f="descricao"]`);
    if(novaLinha) novaLinha.focus();
    return;
  }

  if(b.id==="expCsv"){ exportarCSV(); return; }
  if(b.id==="expJson"){ exportarBackup(); return; }
  if(b.id==="impJsonBtn"){ $("impJson").click(); return; }
  if(b.id==="limparTudo"){
    if(confirm("Isso apaga todos os lançamentos salvos neste navegador. Recomendado exportar um backup antes. Continuar?")){
      S.lancamentos = []; salvar(); renderStage(); renderResumo();
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
        <button class="btn ghost" id="expCsvTop" type="button">Exportar planilha (.csv)</button>
      </div>
      <div class="fx-card">
        <div class="fx-scroll">
          <table class="fx-tbl">
            <thead><tr>
              <th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th>Forma</th><th>Status</th><th>Valor</th><th></th>
            </tr></thead>
            <tbody id="tbody"></tbody>
          </table>
        </div>
        <button class="btn ghost" id="addrow" type="button" style="margin:16px">+ Novo lançamento</button>
      </div>
      <div id="porcat"></div>
    </div>
  </main>
</div>`;

function mount(el){
  root = el;
  root.className = "mod-fluxo m-edit";
  root.innerHTML = TEMPLATE;
  if(!iniciado){ carregar(); iniciado = true; }
  ouvintes.forEach(([t,fn]) => root.addEventListener(t, fn));
  root.querySelectorAll(".tabs button").forEach(b=>{
    b.addEventListener("click", ()=>{
      root.querySelectorAll(".tabs button").forEach(x=>x.classList.toggle("on", x===b));
      root.className = "mod-fluxo " + (b.dataset.tab==="prev" ? "m-prev" : "m-edit");
    });
  });
  $("expCsvTop").addEventListener("click", exportarCSV);
  painel();
  renderStage();
  renderResumo();
}

function unmount(){
  if(!root) return;
  ouvintes.forEach(([t,fn]) => root.removeEventListener(t, fn));
  root = null;
}

Platform.register({
  id: "fluxo",
  menu: "Fluxo de Caixa",
  nome: "Fluxo de caixa",
  descricao: "Lance entradas e saídas, acompanhe o saldo por período e exporte para planilha (.csv).",
  icone: '<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" fill="currentColor" stroke="none"/><rect x="12" y="8" width="3" height="10" fill="currentColor" stroke="none"/><rect x="17" y="5" width="3" height="13" fill="currentColor" stroke="none"/>',
  mount, unmount
});

})();
