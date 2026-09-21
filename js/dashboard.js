/* Dashboard da tela inicial — resumo do Fluxo de Caixa.
   Não é uma ferramenta com rota própria: é chamado direto pela tela inicial (js/platform.js),
   lendo o mesmo localStorage ("imperium_fluxo") que o módulo js/modules/fluxo.js usa.
   Conforme novos módulos guardarem dados relevantes, dá para somar mais painéis aqui. */
(function(){
"use strict";

const n2 = v => (Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const brl = v => "R$ " + n2(v);
const esc = s => String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const MES_ABR = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const MES_EXT = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const hoje = () => new Date().toISOString().slice(0,10);
const mesDe = iso => (iso||"").slice(0,7);

function rotuloMesExt(m){
  if(!m) return "";
  const [a,mm] = m.split("-").map(Number);
  const nome = MES_EXT[(mm||1)-1] || "";
  return nome.charAt(0).toUpperCase() + nome.slice(1) + " de " + a;
}

/* ---------- leitura dos dados do Fluxo de Caixa ---------- */
function lerFluxo(){
  try{
    const raw = localStorage.getItem("imperium_fluxo");
    if(!raw) return null;
    const v = JSON.parse(raw);
    if(v && Array.isArray(v.lancamentos)) return v;
  }catch(e){}
  return null;
}

function ultimosMeses(n){
  const arr = [];
  const base = new Date();
  base.setDate(1);
  for(let i=n-1;i>=0;i--){
    const d = new Date(base.getFullYear(), base.getMonth()-i, 1);
    arr.push(d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0"));
  }
  return arr;
}

/* ---------- gráfico (SVG simples, sem dependências) ---------- */
function graficoMeses(meses, porMes){
  const W = 560, H = 190, padL = 6, padR = 6, padT = 10, padB = 26;
  const areaW = W - padL - padR, areaH = H - padT - padB;
  const max = Math.max(1, ...meses.map(m => Math.max(porMes[m].entradas, porMes[m].saidas)));
  const grupo = areaW / meses.length;
  const barW = Math.max(8, Math.min(22, grupo*0.26));
  let out = "";
  meses.forEach((m,i)=>{
    const cx = padL + grupo*i + grupo/2;
    const hE = (porMes[m].entradas/max)*areaH;
    const hS = (porMes[m].saidas/max)*areaH;
    const xE = cx - barW - 3;
    const xS = cx + 3;
    out += `<rect x="${xE.toFixed(1)}" y="${(padT+areaH-hE).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0,hE).toFixed(1)}" rx="2" fill="#8FD39C"/>`;
    out += `<rect x="${xS.toFixed(1)}" y="${(padT+areaH-hS).toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0,hS).toFixed(1)}" rx="2" fill="#E59A9A"/>`;
    out += `<text x="${cx.toFixed(1)}" y="${H-8}" text-anchor="middle" class="dash-axis">${esc(MES_ABR[Number(m.slice(5,7))-1])}</text>`;
  });
  out += `<line x1="${padL}" y1="${(padT+areaH).toFixed(1)}" x2="${W-padR}" y2="${(padT+areaH).toFixed(1)}" stroke="#2F2A22"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="dash-svg" role="img" aria-label="Entradas e saídas por mês">${out}</svg>`;
}

function listaCategorias(cats, max){
  if(!cats.length) return `<p class="hint" style="margin:0">Nenhum lançamento neste mês ainda.</p>`;
  return cats.map(c=>{
    const pct = Math.max(4, Math.round((c.total/max)*100));
    return `<div class="dash-cat">
      <div class="dash-cat-top"><span>${esc(c.categoria)}</span><b class="${c.tipo}">${brl(c.total)}</b></div>
      <div class="dash-cat-bar"><i class="${c.tipo}" style="width:${pct}%"></i></div>
    </div>`;
  }).join("");
}

/* ---------- HTML do painel ---------- */
function html(){
  const dados = lerFluxo();
  const lanc = dados ? dados.lancamentos : [];

  if(!lanc.length){
    return `
    <section class="dash">
      <h2 class="home-h">Painel — Fluxo de caixa</h2>
      <div class="dash-vazio">
        <p>Ainda não há lançamentos no Fluxo de Caixa neste navegador.</p>
        <a class="btn" href="#/fluxo">Lançar o primeiro</a>
      </div>
    </section>`;
  }

  const mesAtual = mesDe(hoje());
  const doMes = lanc.filter(l => mesDe(l.data) === mesAtual);
  const entradasMes = doMes.filter(l=>l.tipo==="entrada").reduce((s,l)=>s+(+l.valor||0),0);
  const saidasMes   = doMes.filter(l=>l.tipo==="saida").reduce((s,l)=>s+(+l.valor||0),0);
  const saldoAtual  = lanc.filter(l=>l.status==="pago")
    .reduce((s,l)=> s + (l.tipo==="entrada" ? +l.valor||0 : -(+l.valor||0)), 0);
  const pendPagar   = lanc.filter(l=>l.status==="pendente" && l.tipo==="saida").reduce((s,l)=>s+(+l.valor||0),0);
  const pendReceber = lanc.filter(l=>l.status==="pendente" && l.tipo==="entrada").reduce((s,l)=>s+(+l.valor||0),0);

  const meses = ultimosMeses(6);
  const porMes = {};
  meses.forEach(m => porMes[m] = {entradas:0, saidas:0});
  lanc.forEach(l=>{
    const m = mesDe(l.data);
    if(porMes[m]){
      if(l.tipo==="entrada") porMes[m].entradas += (+l.valor||0);
      else porMes[m].saidas += (+l.valor||0);
    }
  });

  const catsMapa = {};
  doMes.forEach(l=>{
    const k = l.tipo+"|"+l.categoria;
    catsMapa[k] = catsMapa[k] || {tipo:l.tipo, categoria:l.categoria, total:0};
    catsMapa[k].total += (+l.valor||0);
  });
  const cats = Object.values(catsMapa).sort((a,b)=>b.total-a.total).slice(0,5);
  const maxCat = Math.max(1, ...cats.map(c=>c.total));

  return `
  <section class="dash">
    <div class="dash-head">
      <h2 class="home-h">Painel — Fluxo de caixa</h2>
      <a class="btn ghost" href="#/fluxo">Abrir Fluxo de Caixa</a>
    </div>
    <div class="dash-grid">
      <div class="dash-card dash-saldo">
        <span class="dash-lbl">Saldo atual</span>
        <b class="dash-val ${saldoAtual<0?"out":"in"}">${brl(saldoAtual)}</b>
        <small>lançamentos pagos</small>
      </div>
      <div class="dash-card">
        <span class="dash-lbl">Entradas — ${esc(rotuloMesExt(mesAtual))}</span>
        <b class="dash-val in">${brl(entradasMes)}</b>
      </div>
      <div class="dash-card">
        <span class="dash-lbl">Saídas — ${esc(rotuloMesExt(mesAtual))}</span>
        <b class="dash-val out">${brl(saidasMes)}</b>
      </div>
      <div class="dash-card">
        <span class="dash-lbl">Pendente a receber</span>
        <b class="dash-val in">${brl(pendReceber)}</b>
      </div>
      <div class="dash-card">
        <span class="dash-lbl">Pendente a pagar</span>
        <b class="dash-val out">${brl(pendPagar)}</b>
      </div>
    </div>
    <div class="dash-row">
      <div class="dash-panel">
        <div class="mini">Entradas × saídas — últimos 6 meses</div>
        ${graficoMeses(meses, porMes)}
        <div class="dash-legend"><span><i class="in"></i>Entradas</span><span><i class="out"></i>Saídas</span></div>
      </div>
      <div class="dash-panel">
        <div class="mini">Top categorias — ${esc(rotuloMesExt(mesAtual))}</div>
        ${listaCategorias(cats, maxCat)}
      </div>
    </div>
  </section>`;
}

window.ImperiumDashboard = { html };
})();
