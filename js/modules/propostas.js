/* Gerador de propostas — módulo da plataforma Imperium.
   Lógica, geração das páginas e exportação .docx são as mesmas da versão anterior;
   o que mudou é só a forma de ligar (mount/unmount) dentro da plataforma. */
(function(){
"use strict";

let root = null;          // elemento onde o módulo está montado
let zoom = 1;
let iniciado = false;     // o rascunho salvo é lido só na primeira abertura
const ouvintes = [];
function on(tipo, fn){ ouvintes.push([tipo, fn]); }

const PAD = {premio:200, insal:324.20, plr:326.04, vr:26.03, vt:13, va:205.91, dias:23.33};

/* Catálogo de cargos. confirmado:true = CBO retirado da sua proposta atual.
   Os demais vêm do site/uso de mercado e ficam editáveis para conferência. */
const CATALOGO = [
  {id:"aux",   nome:"Auxiliar de Serviços Gerais",       curto:"Auxiliar de Limpeza", cbo:"5143-20", conf:true,  salario:1805.43, posto:5798.25, escala:"6x1", turno:"Diurno", frente:"limpeza e conservação"},
  {id:"jard",  nome:"Jardineiro",                      curto:"Jardineiro",          cbo:"6220-10", conf:true,  salario:1886.00, posto:6700.00, escala:"6x1", turno:"Diurno", frente:"jardinagem"},
  {id:"zel",   nome:"Zelador Predial",                   curto:"Zelador",             cbo:"5141-20", conf:true,  salario:2144.33, posto:6693.75, escala:"5x2", turno:"Diurno", frente:"zeladoria"},
  {id:"port",  nome:"Porteiro e Controlador de Acesso",  curto:"Porteiro",            cbo:"5174-10", conf:false, salario:2144.33, posto:6700.00, escala:"12x36",turno:"Diurno", frente:"portaria e controle de acesso"},
  {id:"recep", nome:"Recepcionista",                     curto:"Recepcionista",       cbo:"4221-05", conf:false, salario:2144.33, posto:6700.00, escala:"5x2", turno:"Diurno", frente:"recepção"},
  {id:"manut", nome:"Manutencista Predial",              curto:"Manutencista",        cbo:"5143-10", conf:false, salario:2300.00, posto:7000.00, escala:"5x2", turno:"Diurno", frente:"manutenção predial"},
  {id:"copa",  nome:"Copeira",                           curto:"Copeira",             cbo:"5134-25", conf:false, salario:1805.43, posto:5798.25, escala:"6x1", turno:"Diurno", frente:"copa"},
  {id:"mens",  nome:"Mensageiro",                        curto:"Mensageiro",          cbo:"4122-05", conf:false, salario:1805.43, posto:5798.25, escala:"5x2", turno:"Diurno", frente:"mensageria"},
  {id:"enc",   nome:"Encarregado / Supervisor",          curto:"Encarregado",         cbo:"4101-05", conf:false, salario:2600.00, posto:8000.00, escala:"5x2", turno:"Diurno", frente:"supervisão operacional"}
];

const SECOES = [
  {id:"capa",    rot:"Capa com serviços",                 fixo:true},
  {id:"carta",   rot:"Carta de apresentação",             fixo:true},
  {id:"suporte", rot:"Suporte à funcionária (tabela)",    fixo:false},
  {id:"cbo",     rot:"Serviços solicitados + CBO",        fixo:false},
  {id:"ponto",   rot:"Ponto por app e cartão benefício",  fixo:false},
  {id:"clientes",rot:"Clientes e parceiros / Quem somos", fixo:false},
  {id:"valores", rot:"Da Proposta (valores)",             fixo:true},
  {id:"aceite",  rot:"Termo de aceite",                   fixo:false}
];

const CLIENTES_PADRAO = [
  {t:"Condomínio Residencial", n:"Bárbara", c:"Campinas SP", foto:"assets/clientes/barbara.jpg"},
  {t:"Condomínio Residencial", n:"Jauaperí", c:"Campinas SP", foto:"assets/clientes/jauaperi.jpg"},
  {t:"Empresa", n:"RDB Ferramentaria", c:"Campinas SP", foto:"assets/clientes/rdb-ferramentaria.jpg", modo:"logo"},
  {t:"Condomínio Residencial", n:"Colinas de Nápoles", c:"Campinas SP", foto:"assets/clientes/colinas-de-napoles.jpg"},
  {t:"Condomínio Residencial", n:"Laranjeiras", c:"Hortolândia SP", foto:"assets/clientes/laranjeiras.jpg"},
  {t:"Escritório de Advocacia", n:"Lira Advogados", c:"Campinas SP", foto:"assets/clientes/lira-advogados.jpg", modo:"logo"},
  {t:"Escritório Contabilidade", n:"7Mais", c:"Campinas SP", foto:"assets/clientes/7mais.jpg", modo:"logo"}
];

const DIF_PADRAO = [
  {t:"Equipamentos e Segurança", d:"A proposta inclui todos os maquinários, ferramentas e EPIs necessários para a execução contínua dos serviços durante a vigência do contrato (ex.: roçadeira e soprador a gasolina, tesourão e serrote de poda)."},
  {t:"Flexibilidade Contratual", d:"O contrato não exige fidelidade nem prazo mínimo de permanência, garantindo total liberdade para o cliente decidir sobre a continuidade dos serviços a qualquer momento."}
];

function hoje(){const d=new Date();return d.toISOString().slice(0,10);}

const ESTADO_INICIAL = () => ({
  cidade:"Campinas",
  data:hoje(),
  tratamento:"Síndica Sra.",
  responsavel:"",
  tipoCliente:"Residencial",
  cliente:"",
  localCliente:"Campinas",
  escopoTexto:"",
  base:"Base no SINDEEPRES",
  assinante:"Cyriaco Wilson",
  cargoAssinante:"Diretor/Presidente",
  dias:PAD.dias,
  secoes:{capa:true,carta:true,suporte:true,cbo:true,ponto:true,clientes:true,valores:true,aceite:true},
  difs:JSON.parse(JSON.stringify(DIF_PADRAO)),
  obs:"",
  clientes:JSON.parse(JSON.stringify(CLIENTES_PADRAO)),
  cargos:{},
  extras:[]
});

function novoCargo(base){
  return {on:false, acum:false, nome:base.nome, curto:base.curto, cbo:base.cbo, conf:base.conf, frente:base.frente,
    postos:1, func:1, escala:base.escala, turno:base.turno, posto:base.posto,
    salario:base.salario, premio:PAD.premio, insal:PAD.insal, plr:PAD.plr,
    vr:PAD.vr, vt:PAD.vt, va:PAD.va};
}

let S = ESTADO_INICIAL();
CATALOGO.forEach(c => S.cargos[c.id] = novoCargo(c));

/* ---------- persistência leve (rascunho local) ---------- */
function salvar(){ try{ localStorage.setItem("imperium_proposta", JSON.stringify(S)); }catch(e){} }
function carregar(){
  try{
    const raw = localStorage.getItem("imperium_proposta");
    if(!raw) return;
    const v = JSON.parse(raw);
    if(v && v.cargos){
      CATALOGO.forEach(c=>{ if(!v.cargos[c.id]) v.cargos[c.id]=novoCargo(c); });
      S = Object.assign(ESTADO_INICIAL(), v);
    }
  }catch(e){}
}

/* ---------- helpers ---------- */
const n2 = v => (Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const brl = v => "R$ " + n2(v);
const esc = s => String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const MES=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
function dataExt(iso){
  if(!iso) return "";
  const [a,m,d] = iso.split("-").map(Number);
  const nome = MES[(m||1)-1];
  return `${d} de ${nome.charAt(0).toUpperCase()+nome.slice(1)} de ${a}`;
}
function listaCargos(){
  const out=[];
  CATALOGO.forEach(c=>{ const x=S.cargos[c.id]; if(x&&x.on) out.push(Object.assign({id:c.id},x)); });
  S.extras.forEach((x,i)=>{ if(x.on) out.push(Object.assign({id:"x"+i},x)); });
  return out;
}
function nomeDoc(c){ return c.nome + (c.acum ? " com acúmulo de função" : ""); }
function remun(c){ return (+c.salario||0)+(+c.premio||0)+(+c.insal||0)+(+c.plr||0); }
function benef(c){ return ((+c.vr||0)+(+c.vt||0))*(+S.dias||0) + (+c.va||0); }
function totalMensal(){ return listaCargos().reduce((s,c)=>s+(+c.posto||0)*(+c.postos||0),0); }
function escopoAuto(){
  const f=[...new Set(listaCargos().map(c=>c.frente).filter(Boolean))];
  if(!f.length) return "limpeza e conservação";
  if(f.length===1) return f[0];
  return f.slice(0,-1).join(", ") + " e " + f[f.length-1];
}
function nomeCliente(){
  const t = S.tipoCliente==="Empresa" ? "" : (S.tipoCliente==="Residencial" ? "Residencial " : S.tipoCliente+" ");
  return (t + (S.cliente||"________")).trim();
}

/* ---------- PAINEL ---------- */
function campo(label,tipo,path,attrs=""){
  return `<label class="f"><span>${label}</span><input type="${tipo}" data-p="${path}" ${attrs} value="${esc(get(path))}"></label>`;
}
function get(path){ return path.split(".").reduce((o,k)=>o?o[k]:"",S); }
function set(path,val){
  const ks=path.split("."); let o=S;
  for(let i=0;i<ks.length-1;i++) o=o[ks[i]];
  o[ks[ks.length-1]]=val;
}

function cargoCard(key,c){
  return `<div class="cargo ${c.on?"on":""}" data-card="${key}">
    <div class="head">
      <input type="checkbox" data-on="${key}" ${c.on?"checked":""}>
      <div class="nm">
        <b>${esc(c.nome)}</b>
        <small>CBO ${esc(c.cbo)}</small>
      </div>
      ${key.startsWith("x")?`<button class="rm" data-del="${key}">remover</button>`:""}
    </div>
    <div class="cfg">
      <div class="grid3">
        <label class="f"><span>Postos</span><input type="number" min="1" step="1" data-c="${key}.postos" value="${c.postos}"></label>
        <label class="f"><span>Pessoas</span><input type="number" min="1" step="1" data-c="${key}.func" value="${c.func}"></label>
        <label class="f"><span>Escala</span>
          <select data-c="${key}.escala">${["6x1","5x2","5x1","12x36","44h sem."].map(e=>`<option ${c.escala===e?"selected":""}>${e}</option>`).join("")}</select>
        </label>
      </div>
      <div class="tg" style="margin-top:2px">
        <input type="checkbox" data-c="${key}.acum" ${c.acum?"checked":""}>
        <span>Com acúmulo de função</span>
      </div>
      <div class="grid2" style="margin-top:9px">
        <label class="f"><span>Turno</span>
          <select data-c="${key}.turno">${["Diurno","Noturno","Misto"].map(e=>`<option ${c.turno===e?"selected":""}>${e}</option>`).join("")}</select>
        </label>
        <label class="f"><span>Valor por posto (R$)</span><input type="number" step="0.01" data-c="${key}.posto" value="${c.posto}"></label>
      </div>
      <div class="mini">Remuneração da colaboradora</div>
      <div class="grid2">
        <label class="f"><span>Salário</span><input type="number" step="0.01" data-c="${key}.salario" value="${c.salario}"></label>
        <label class="f"><span>Prêmio assid.</span><input type="number" step="0.01" data-c="${key}.premio" value="${c.premio}"></label>
        <label class="f"><span>Insalub./acúmulo</span><input type="number" step="0.01" data-c="${key}.insal" value="${c.insal}"></label>
        <label class="f"><span>PLR anual</span><input type="number" step="0.01" data-c="${key}.plr" value="${c.plr}"></label>
      </div>
      <div class="mini">Benefícios</div>
      <div class="grid3">
        <label class="f"><span>VR/dia</span><input type="number" step="0.01" data-c="${key}.vr" value="${c.vr}"></label>
        <label class="f"><span>VT/dia</span><input type="number" step="0.01" data-c="${key}.vt" value="${c.vt}"></label>
        <label class="f"><span>VA cesta</span><input type="number" step="0.01" data-c="${key}.va" value="${c.va}"></label>
      </div>
      <div class="grid2" style="margin-top:9px">
        <label class="f"><span>Nome no documento</span><input type="text" data-c="${key}.nome" value="${esc(c.nome)}"></label>
        <label class="f"><span>CBO</span><input type="text" data-c="${key}.cbo" value="${esc(c.cbo)}"></label>
      </div>
    </div>
  </div>`;
}

function painel(){
  if(!root) return;
  const secHTML = SECOES.map(s=>`<div class="tg">
      <input type="checkbox" data-sec="${s.id}" ${S.secoes[s.id]?"checked":""} ${s.fixo?"disabled":""}>
      <span>${s.rot}${s.fixo?' <small style="color:var(--muted)">(essencial)</small>':""}</span>
    </div>`).join("");

  const difHTML = S.difs.map((d,i)=>`<div class="cargo on" style="margin-bottom:9px">
      <div class="cfg" style="display:block;border-top:none;padding-top:12px">
        <label class="f"><span>Título</span><input type="text" data-d="${i}.t" value="${esc(d.t)}"></label>
        <label class="f"><span>Descrição</span><textarea data-d="${i}.d">${esc(d.d)}</textarea></label>
        <button class="rm" data-deldif="${i}">remover diferencial</button>
      </div></div>`).join("");

  document.getElementById("rail").innerHTML = `
  <div class="brand">
    <h1>Gerador de propostas<span>Configuração da proposta</span></h1>
  </div>

  <details class="sec" open><summary>Dados do cliente <span class="chev">›</span></summary>
    <div class="body">
      <div class="row">
        <label class="f" style="flex:0 0 42%"><span>Tipo</span>
          <select data-p="tipoCliente">${["Residencial","Condomínio Comercial","Empresa","Escritório"].map(t=>`<option ${S.tipoCliente===t?"selected":""}>${t}</option>`).join("")}</select>
        </label>
        ${campo("Nome do cliente","text","cliente",'placeholder="Nome do condomínio ou empresa"')}
      </div>
      <div class="row">
        <label class="f" style="flex:0 0 42%"><span>Tratamento</span>
          <select data-p="tratamento">${["Síndica Sra.","Síndico Sr.","Sra.","Sr.","Gestora Sra.","Gestor Sr."].map(t=>`<option ${S.tratamento===t?"selected":""}>${t}</option>`).join("")}</select>
        </label>
        ${campo("Responsável","text","responsavel",'placeholder="Nome do responsável"')}
      </div>
      <div class="row">
        ${campo("Cidade do cliente","text","localCliente")}
        ${campo("Data da proposta","date","data")}
      </div>
      <label class="f"><span>Escopo citado na carta</span>
        <input type="text" data-p="escopoTexto" placeholder="${esc(escopoAuto())}" value="${esc(S.escopoTexto)}">
      </label>
      <p class="hint">Em branco, o escopo é montado sozinho a partir dos cargos marcados.</p>
    </div>
  </details>

  <details class="sec" open><summary>Cargos e quantidades <span class="chev">›</span></summary>
    <div class="body">
      ${CATALOGO.map(c=>cargoCard(c.id,S.cargos[c.id])).join("")}
      ${S.extras.map((c,i)=>cargoCard("x"+i,c)).join("")}
      <button class="btn ghost wide" id="addcargo">+ Cargo personalizado</button>
    </div>
  </details>

  <details class="sec"><summary>Seções da proposta <span class="chev">›</span></summary>
    <div class="body">${secHTML}
      <label class="f" style="margin-top:14px"><span>Dias de benefício / mês</span><input type="number" step="0.01" data-p="dias" value="${S.dias}"></label>
      <label class="f"><span>Base da convenção</span><input type="text" data-p="base" value="${esc(S.base)}"></label>
    </div>
  </details>

  <details class="sec"><summary>Clientes e parceiros <span class="chev">›</span></summary>
    <div class="body">
      ${S.clientes.map((c,i)=>`<div class="cargo on" style="margin-bottom:9px">
        <div class="cfg" style="display:block;border-top:none;padding-top:12px">
          <div class="row" style="align-items:flex-start">
            <div style="flex:0 0 52px">
              <div class="cli-thumb" data-thumb="${i}" style="width:52px;height:52px;border-radius:6px;overflow:hidden;border:1px solid var(--rule);background:#0E0C08;display:flex;align-items:center;justify-content:center">
                ${c.foto?`<img src="${c.foto}" style="width:100%;height:100%;object-fit:${c.modo==="logo"?"contain":"cover"};${c.modo==="logo"?"background:#fff;padding:3px":""}">`:'<span style="color:var(--muted);font-size:9px;text-align:center">sem foto</span>'}
              </div>
            </div>
            <div style="flex:1;min-width:0">
              <label class="f" style="margin-bottom:7px"><span>Nome</span><input type="text" data-cli="${i}.n" value="${esc(c.n)}"></label>
              <label class="f" style="margin:0"><span>Foto</span><input type="file" accept="image/*" data-clifoto="${i}"></label>
            </div>
          </div>
          <div class="row" style="margin-top:9px">
            <label class="f" style="flex:0 0 60%"><span>Tipo</span><input type="text" data-cli="${i}.t" value="${esc(c.t)}"></label>
            <label class="f"><span>Modo da foto</span>
              <select data-cli="${i}.modo"><option value="foto" ${c.modo!=="logo"?"selected":""}>Foto (preenche)</option><option value="logo" ${c.modo==="logo"?"selected":""}>Logo (fundo branco)</option></select>
            </label>
          </div>
          <label class="f"><span>Cidade</span><input type="text" data-cli="${i}.c" value="${esc(c.c)}"></label>
          <button class="rm" data-delcli="${i}">remover</button>
        </div></div>`).join("")}
      <button class="btn ghost wide" id="addcli">+ Cliente ou parceiro</button>
      <p class="hint">Envie uma foto do local ou a logo do parceiro (arquivo local, fica salvo só neste documento).</p>
    </div>
  </details>

  <details class="sec"><summary>Diferenciais e condições <span class="chev">›</span></summary>
    <div class="body">${difHTML}
      <button class="btn ghost wide" id="adddif">+ Diferencial</button>
      <label class="f" style="margin-top:14px"><span>Observações (opcional)</span><textarea data-p="obs" placeholder="Ex.: reposição de faltas em até 24h."></textarea></label>
    </div>
  </details>

  <details class="sec"><summary>Assinatura <span class="chev">›</span></summary>
    <div class="body">
      ${campo("Nome","text","assinante")}
      ${campo("Cargo","text","cargoAssinante")}
      ${campo("Cidade de emissão","text","cidade")}
    </div>
  </details>

  <div class="actions">
    <div class="total-chip"><small>Total mensal</small><b id="chip">${brl(totalMensal())}</b></div>
    <button class="btn wide" id="print2">Imprimir / salvar PDF</button>
    <button class="btn ghost wide" id="word">Exportar para Word (.docx)</button>
    <button class="btn ghost wide" id="zerar">Nova proposta em branco</button>
  </div>`;

  const t = document.querySelector('[data-p="obs"]'); if(t) t.value = S.obs || "";
}

/* ---------- PÁGINAS ---------- */
/* ícones de linha minimalistas (stroke=currentColor), um por categoria de serviço */
const ICONE_SVG = {
  limpeza:  '<path d="M9 3v6M9 9c-3 0-4 2-4 5v7h8v-7c0-3-1-5-4-5z"/><path d="M5 21h8"/><circle cx="9" cy="3" r="1.4"/>',
  jardim:   '<path d="M12 21v-8"/><path d="M12 13c0-4-3-6-7-6 0 4 3 6 7 6z"/><path d="M12 11c0-3 2.5-5 6-5 0 3-2.5 5-6 5z"/>',
  zelad:    '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>',
  portaria: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 21v-4h6v4"/><circle cx="15" cy="11" r=".9" fill="currentColor" stroke="none"/>',
  recep:    '<circle cx="12" cy="8" r="3.2"/><path d="M5 21c0-4 3-6.5 7-6.5S19 17 19 21"/>',
  manuten:  '<path d="M14.7 6.3a3 3 0 0 1-3.8 3.8L4 17v3h3l6.9-6.9a3 3 0 0 1 3.8-3.8l-2.6 2.6-2-2z"/>',
  copa:     '<path d="M6 3v7a3 3 0 0 0 6 0V3"/><path d="M9 10v11"/><path d="M17 3c-1.5 1.5-1.5 5 0 6.5V21"/>',
  mensag:   '<path d="M4 6h16v11H8l-4 3V6z"/><path d="M8 10h8M8 13h5"/>',
  encarreg: '<circle cx="12" cy="7" r="3"/><path d="M5 21c0-4.5 3-7 7-7s7 2.5 7 7"/><path d="M12 4v0"/><circle cx="19" cy="6" r="1.6"/>',
  padrao:   '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h5"/>'
};
function iconeCargo(c){
  const k = ((c.frente||"")+" "+(c.curto||"")+" "+(c.nome||"")).toLowerCase();
  let key="padrao";
  if(k.includes("jardin")) key="jardim";
  else if(k.includes("zelad")) key="zelad";
  else if(k.includes("porta")||k.includes("controlad")) key="portaria";
  else if(k.includes("recep")) key="recep";
  else if(k.includes("manut")) key="manuten";
  else if(k.includes("copeir")||k.includes("copa")) key="copa";
  else if(k.includes("mensag")) key="mensag";
  else if(k.includes("encarreg")||k.includes("supervis")) key="encarreg";
  else if(k.includes("limp")||k.includes("auxiliar")) key="limpeza";
  return `<svg viewBox="0 0 24 24" fill="none" stroke="#B8901F" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONE_SVG[key]}</svg>`;
}
const WM = (cls="") => `<div class="wm ${cls}"><span class="w1">IMPERIUM</span><span class="w2">TERCEIRIZAÇÃO E SERVIÇOS</span></div>`;
const FOOT = `<div class="pfoot"><a href="https://www.imperiumservicos.com">www.imperiumservicos.com</a> – CNPJ: 62.249.653.0001/66</div>`;
const HEAD = `<div class="phead">${WM("sm")}</div>`;
const page = (inner,cls="") => `<section class="paper ${cls}">${inner}${FOOT}</section>`;

function pgCapa(){
  const cs = listaCargos();
  const grid = cs.length ? `<div class="svcgrid">${cs.map(c=>`<div>${iconeCargo(c)}${esc(c.curto||c.nome)}<em>CBO ${esc(c.cbo)}</em></div>`).join("")}</div>` : "";
  return page(`
    <div style="text-align:center;padding-top:6mm;display:flex;flex-direction:column;align-items:center;flex:1;width:100%">
      ${WM("lg")}
      <p class="site">www.imperiumservicos.com</p>
      <div class="cover-motto">A pessoa certa no lugar certo faz a diferença</div>
      <p class="ttl">PROPOSTA DE PARCERIA</p>
      <p class="sub">${esc(nomeCliente())} — ${esc(S.localCliente)}</p>
      <h2 class="dt center" style="margin:40px 0 0;font-size:25px">Nossos serviços</h2>
      ${grid}
      <div class="cover-fill">
        <div class="cover-orn"><span class="ln"></span><span>Campinas e região</span><span class="ln"></span></div>
      </div>
    </div>`,"cover");
}

function pgCarta(){
  const escopo = S.escopoTexto || escopoAuto();
  return page(`${HEAD}
    <p style="color:#444">${esc(S.cidade)}, ${esc(dataExt(S.data))}</p>
    <p class="lead">Prezada <b>${esc(S.tratamento)} ${esc(S.responsavel||"________")}</b> – ${esc(nomeCliente())} – ${esc(S.localCliente)}.</p>
    <p class="lead">É com muita satisfação que apresentamos a proposta da Imperium para a prestação de serviços de ${esc(escopo)}. Na Imperium, acreditamos que a excelência do serviço é consequência direta do respeito, cuidado e valorização das pessoas envolvidas no processo.</p>
    <p class="motto">"A Pessoa certa, no lugar certo, faz a diferença"</p>
    <h3 class="dt">Nosso Propósito e Diferencial Humano</h3>
    <p>O mercado tradicional de terceirização costuma focar apenas em números e alocação de mão de obra. Na <b>Imperium</b>, priorizamos o tratamento individual e humano tanto para com nossos clientes quanto com nossa equipe de colaboradores. Cuidar de quem cuida do seu espaço garante motivação, menor rotatividade (turnover), segurança e alto padrão de capricho no dia a dia.</p>
    <h3 class="dt">Suporte Completo à Funcionária Terceirizada</h3>
    <p>Para assegurar que o atendimento em seu espaço ocorra com total eficiência e harmonia, oferecemos um programa contínuo de suporte e acompanhamento aos nossos profissionais.</p>
    <h3 class="dt">Compromisso de Parceria e Alinhamento</h3>
    <p>Será um prazer ter vocês como parceiros e servir o seu espaço com a nossa dedicação diária. Ficamos à disposição para qualquer dúvida ou ajuste que seja necessário; nosso objetivo é conversar abertamente para chegarmos a um alinhamento justo e benéfico para todos os envolvidos.</p>
    ${S.obs?`<p>${esc(S.obs)}</p>`:""}
    <div style="margin-top:26px">
      <p style="margin-bottom:22px">Cordialmente,</p>
      <p style="margin:0;font-weight:700">${esc(S.assinante)}</p>
      <p style="margin:0 0 10px;font-weight:700">${esc(S.cargoAssinante)}</p>
      ${WM()}
    </div>`);
}

function pgSuporte(){
  return page(`${HEAD}
    <h2 class="dt">Suporte Completo à Funcionária Terceirizada</h2>
    <table class="dt sup">
      <thead><tr><th style="width:27%">Pilar de Atuação</th><th style="width:40%">Ações e Suporte Prestado</th><th>Benefício para o Cliente</th></tr></thead>
      <tbody>
        <tr><td class="pil" rowspan="3">Cuidados Operacionais e Ergonômicos</td><td>Uniformes de alta qualidade e adequados à estação.</td><td rowspan="3">Agilidade na execução, equipe motivada e ambiente padronizado.</td></tr>
        <tr><td>Equipamentos ergonômicos e produtos de alta performance.</td></tr>
        <tr><td>Orientação contínua sobre segurança e postura técnica.</td></tr>
        <tr><td class="pil" rowspan="3">Acompanhamento e Escuta Ativa</td><td>Supervisão técnica quinzenal com foco humano e acolhedor.</td><td rowspan="3">Tranquilidade operacional sem interrupção de cronograma ou faltas descobertas.</td></tr>
        <tr><td>Canal direto de suporte (ouvidoria/RH) para a funcionária.</td></tr>
        <tr><td>Suporte imediato e gestão humanizada em caso de imprevistos.</td></tr>
        <tr><td class="pil" rowspan="3">Desenvolvimento e Valorização</td><td>Treinamentos periódicos de higienização e atendimento.</td><td rowspan="3">Profissionais dedicadas, atenciosas, confiáveis e de longa permanência.</td></tr>
        <tr><td>Programas de reconhecimento e premiação por desempenho.</td></tr>
        <tr><td>Acompanhamento de bem-estar e ambiente saudável.</td></tr>
      </tbody>
    </table>`);
}

function pgCBO(){
  const cs = listaCargos();
  return page(`${HEAD}
    <h2 class="dt">SERVIÇOS SOLICITADOS</h2>
    <ol class="dt">${cs.map(c=>`<li>${esc(nomeDoc(c))} – CBO ${esc(c.cbo)}</li>`).join("") || "<li>—</li>"}</ol>
    <h3 class="dt" style="color:#111">O que é o CBO?</h3>
    <p>É um documento criado para identificar e codificar as ocupações do mercado de trabalho no Brasil.</p>
    <p>É uma classificação que serve como referência para o reconhecimento e a nomeação das profissões.</p>
    <p>Foi estabelecido pela Portaria Ministerial nº 397, de 9 de outubro de 2002.</p>
    <div style="margin-top:14px;border:1px solid var(--paper-rule);border-radius:4px;overflow:hidden">
      <div style="background:#111;color:#fff;display:flex">
        ${cs.map(c=>`<div style="flex:1;text-align:center;padding:12px 6px;border-right:1px solid #333"><div style="width:26px;height:2px;background:#D7B247;margin:0 auto 7px"></div><b style="font-size:13px">${esc(c.curto||c.nome)}</b><div style="font-size:10px;color:#bbb;margin-top:3px">${esc(c.escala)} · ${esc(c.turno)}</div></div>`).join("")}
      </div>
    </div>`);
}

const ICO_PONTO = '<svg viewBox="0 0 24 24" fill="none" stroke="#B8901F" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>';
const ICO_CARTAO = '<svg viewBox="0 0 24 24" fill="none" stroke="#B8901F" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/><path d="M7 14h4"/></svg>';
function pgPonto(){
  return page(`${HEAD}
    <div class="card-grid">
      <div class="card-box">
        <div class="card-ico">${ICO_PONTO}</div>
        <h4>Sistema de ponto via aplicativo</h4>
        <ul><li>Registro facial</li><li>Registro por geolocalização</li><li>100% conforme a Portaria 671</li></ul>
      </div>
      <div class="card-box">
        <div class="card-ico">${ICO_CARTAO}</div>
        <h4>Cartão Benefício para o Funcionário</h4>
        <ul><li>Vale Refeição</li><li>Vale Alimentação</li><li>Vale Transporte</li><li>Prêmio por assiduidade</li><li>Multibenefícios</li></ul>
      </div>
    </div>
    <p style="text-align:center;margin-top:22px">${WM("sm")}</p>`);
}

function pgClientes(){
  return page(`${HEAD}
    <h2 class="dt center" style="text-align:center">Alguns de nossos clientes e parceiros</h2>
    <div class="clientes">${S.clientes.map(c=>`<div>${c.foto?`<div class="foto${c.modo==="logo"?" logo":""}"><img src="${c.foto}"></div>`:""}<em>${esc(c.t)}</em><b>${esc(c.n)}</b>${esc(c.c)}</div>`).join("")}</div>
    <div style="margin-top:38px;padding-top:26px;border-top:1px solid #E4DFD3">
      <p style="font-family:'Oswald';letter-spacing:.22em;text-transform:uppercase;font-size:11px;color:var(--accent);margin:0 0 8px">Quem somos</p>
      <h2 class="dt noline" style="font-size:25px;max-width:120mm">Focamos no que é essencial para que você foque no seu negócio.</h2>
      <p style="max-width:130mm;margin-top:14px">A Imperium assume a gestão de atividades complementares com <b>excelência e profissionalismo</b>.</p>
    </div>`);
}

function pgValores(){
  const cs = listaCargos();
  const mediaBen = cs.length ? cs.reduce((s,c)=>s+benef(c),0)/cs.length : 0;
  const iguais = cs.every(c=>Math.abs(benef(c)-benef(cs[0]||c))<0.01);
  return page(`${HEAD}
    <h2 class="dt" style="font-size:28px">Da Proposta</h2>
    <p style="font-size:16px;color:#444;margin-bottom:18px">${esc(S.base)}</p>

    <p style="font-weight:700;margin-bottom:4px">Remuneração da Colaboradora</p>
    <table class="dt">
      <thead><tr><th>Função</th><th>Salário</th><th>Prêmio Assiduidade</th><th>Insalubridade Acúmulo</th><th>PLR anual</th><th>Total mensal</th></tr></thead>
      <tbody>${cs.map(c=>`<tr><td class="fn">${esc(c.curto||c.nome)}</td><td>${brl(c.salario)}</td><td>${brl(c.premio)}</td><td>${brl(c.insal)}</td><td>${brl(c.plr)}</td><td>${brl(remun(c))}</td></tr>`).join("")}</tbody>
    </table>

    <p style="font-weight:700;margin-bottom:4px">Benefícios mensais da Colaboradora</p>
    <table class="dt">
      <thead><tr><th>Função</th><th>VR/ Dia</th><th>VT/ Dia</th><th>VA Cesta</th><th>${iguais?"Média":"Total"}</th></tr></thead>
      <tbody>${cs.map((c,i)=>`<tr><td class="fn">${esc(c.curto||c.nome)}</td><td>${brl(c.vr)}</td><td>${brl(c.vt)}</td><td>${brl(c.va)}</td>${
        iguais ? (i===0?`<td rowspan="${cs.length}" style="vertical-align:middle">${brl(mediaBen)}</td>`:"") : `<td>${brl(benef(c))}</td>`
      }</tr>`).join("")}</tbody>
    </table>

    <p style="font-weight:700;margin-bottom:4px">Escopo e valores da proposta</p>
    <table class="dt">
      <thead><tr><th>Função</th><th>Escala</th><th>Turno</th><th>Postos</th><th>Pessoas</th><th>Valor por posto</th><th>Valor total</th></tr></thead>
      <tbody>
        ${cs.map(c=>`<tr><td class="fn">${esc(c.curto||c.nome)}</td><td>${esc(c.escala)}</td><td>${esc(c.turno)}</td><td>${c.postos}</td><td>${c.func}</td><td>${brl(c.posto)}</td><td>${brl((+c.posto||0)*(+c.postos||0))}</td></tr>`).join("")}
        <tr class="totrow"><td colspan="6" style="text-align:right">Mensal</td><td class="v">${brl(totalMensal())}</td></tr>
      </tbody>
    </table>

    <h3 class="dt" style="color:#111">Diferenciais e Condições da Proposta</h3>
    <ul class="dt">${S.difs.map(d=>`<li><b>${esc(d.t)}</b>: ${esc(d.d)}</li>`).join("")}</ul>`);
}

function pgAceite(){
  return page(`${HEAD}
    <h2 class="dt" style="font-size:19px">TERMO DE ACEITE</h2>
    <p class="lead">O ${S.tipoCliente==="Empresa"?"":"Condomínio "}<b>${esc(nomeCliente())}</b> – ${esc(S.localCliente)}, com seu responsável legal faz o aceite da proposta da qual passará pelos ajustes jurídicos de contrato e após o início dos trabalhos conforme acertado entre as partes.</p>
    <p class="pill-note">Valor mensal acordado: <b>${brl(totalMensal())}</b> — ${listaCargos().reduce((s,c)=>s+(+c.postos||0),0)} posto(s) de trabalho.</p>
    <p style="margin-top:40px;color:#444">${esc(S.cidade)}, ${esc(dataExt(S.data))}</p>
    <div class="assin">
      <div class="line"></div>
      <p style="margin:0">${esc(S.tratamento)} ${esc(S.responsavel||"________")}</p>
      <p style="margin:0;font-weight:700">${esc(nomeCliente())}</p>
    </div>`);
}

function renderPapers(){
  if(!root) return;
  const map = {capa:pgCapa,carta:pgCarta,suporte:pgSuporte,cbo:pgCBO,ponto:pgPonto,clientes:pgClientes,valores:pgValores,aceite:pgAceite};
  document.getElementById("papers").innerHTML =
    SECOES.filter(s=>S.secoes[s.id]).map(s=>map[s.id]()).join("");
  const chip = document.getElementById("chip");
  if(chip) chip.textContent = brl(totalMensal());
  salvar();
}

/* ---------- eventos ---------- */
function refCargo(key){ return key.startsWith("x") ? S.extras[+key.slice(1)] : S.cargos[key]; }

on("input", e=>{
  const t = e.target;
  if(t.type==="checkbox") return;
  if(t.dataset.p){ let v=t.value; if(t.type==="number") v=parseFloat(v)||0; set(t.dataset.p,v); renderPapers(); return; }
  if(t.dataset.c){
    const [key,campo] = t.dataset.c.split(".");
    const o = refCargo(key); if(!o) return;
    o[campo] = t.type==="number" ? (parseFloat(t.value)||0) : t.value;
    renderPapers(); return;
  }
  if(t.dataset.d){
    const [i,campo] = t.dataset.d.split(".");
    S.difs[+i][campo] = t.value; renderPapers(); return;
  }
  if(t.dataset.cli){
    const [i,campo] = t.dataset.cli.split(".");
    S.clientes[+i][campo] = t.value; renderPapers(); return;
  }
});

on("change", e=>{
  const t = e.target;
  if(t.dataset.on!==undefined && t.type==="checkbox"){
    const o = refCargo(t.dataset.on); if(!o) return;
    o.on = t.checked;
    document.querySelector(`[data-card="${t.dataset.on}"]`).classList.toggle("on",t.checked);
    renderPapers(); return;
  }
  if(t.dataset.sec){ S.secoes[t.dataset.sec] = t.checked; renderPapers(); return; }
  if(t.dataset.clifoto!==undefined){
    const i = +t.dataset.clifoto;
    const file = t.files && t.files[0];
    if(!file) return;
    if(!/^image\//.test(file.type)){ alert("Selecione um arquivo de imagem."); t.value=""; return; }
    if(file.size > 4*1024*1024){ alert("Imagem muito grande (máx. 4MB)."); t.value=""; return; }
    const reader = new FileReader();
    reader.onload = () => {
      S.clientes[i].foto = reader.result;
      painel(); renderPapers();
    };
    reader.onerror = () => alert("Não foi possível ler essa imagem.");
    reader.readAsDataURL(file);
    return;
  }
  if(t.dataset.c && t.type==="checkbox"){
    const [k,campo]=t.dataset.c.split(".");
    const o=refCargo(k); if(o){ o[campo]=t.checked; renderPapers(); }
    return;
  }
  if(t.dataset.p && (t.tagName==="SELECT"||t.type==="date")){ set(t.dataset.p,t.value); renderPapers(); }
  if(t.dataset.c && t.tagName==="SELECT"){
    const [key,campo]=t.dataset.c.split(".");
    const o=refCargo(key); if(o){ o[campo]=t.value; renderPapers(); }
  }
});

on("click", e=>{
  const b = e.target.closest("button"); if(!b) return;
  if(b.id==="addcargo"){
    S.extras.push(Object.assign(novoCargo(CATALOGO[0]),{on:true,nome:"Novo cargo",curto:"Novo cargo",cbo:"0000-00",conf:false,frente:"serviços gerais"}));
    painel(); renderPapers(); return;
  }
  if(b.dataset.del){ S.extras.splice(+b.dataset.del.slice(1),1); painel(); renderPapers(); return; }
  if(b.id==="adddif"){ S.difs.push({t:"Novo diferencial",d:""}); painel(); renderPapers(); return; }
  if(b.dataset.deldif){ S.difs.splice(+b.dataset.deldif,1); painel(); renderPapers(); return; }
  if(b.id==="addcli"){ S.clientes.push({t:"Empresa",n:"Nome do parceiro",c:"Campinas SP"}); painel(); renderPapers(); return; }
  if(b.dataset.delcli){ S.clientes.splice(+b.dataset.delcli,1); painel(); renderPapers(); return; }
  if(b.id==="print"||b.id==="print2"){ imprimir(); return; }
  if(b.id==="word"){ exportarWord(); return; }
  if(b.id==="zerar"){
    if(!confirm("Limpar todos os campos e começar uma proposta nova?")) return;
    S = ESTADO_INICIAL(); CATALOGO.forEach(c=>S.cargos[c.id]=novoCargo(c));
    painel(); renderPapers(); return;
  }
  if(b.id==="zin"||b.id==="zout"){
    zoom = Math.min(1.2,Math.max(0.5, zoom + (b.id==="zin"?0.1:-0.1)));
    const p=document.getElementById("papers");
    p.style.transform = `scale(${zoom})`;
    p.style.marginBottom = `${(zoom-1)*400}px`;
    return;
  }
  if(b.dataset.tab){
    root.querySelectorAll(".tabs button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on");
    root.classList.remove("m-edit","m-prev");
    root.classList.add(b.dataset.tab==="prev" ? "m-prev" : "m-edit");
    return;
  }
});


/* ---------- Exportação .docx ---------- */
const CRCT=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}return t;})();
function crc32(u8){let c=0xFFFFFFFF;for(let i=0;i<u8.length;i++)c=CRCT[(c^u8[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function zipar(files){
  const enc=new TextEncoder(), parts=[], cd=[]; let off=0;
  files.forEach(f=>{
    const nm=enc.encode(f.name), d=f.data, c=crc32(d);
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true); lh.setUint16(4,20,true); lh.setUint16(6,0x0800,true);
    lh.setUint16(8,0,true); lh.setUint16(10,0,true); lh.setUint16(12,0,true);
    lh.setUint32(14,c,true); lh.setUint32(18,d.length,true); lh.setUint32(22,d.length,true);
    lh.setUint16(26,nm.length,true); lh.setUint16(28,0,true);
    parts.push(new Uint8Array(lh.buffer),nm,d);
    const ch=new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true); ch.setUint16(4,20,true); ch.setUint16(6,20,true);
    ch.setUint16(8,0x0800,true); ch.setUint16(10,0,true); ch.setUint16(12,0,true); ch.setUint16(14,0,true);
    ch.setUint32(16,c,true); ch.setUint32(20,d.length,true); ch.setUint32(24,d.length,true);
    ch.setUint16(28,nm.length,true); ch.setUint16(30,0,true); ch.setUint16(32,0,true);
    ch.setUint16(34,0,true); ch.setUint16(36,0,true); ch.setUint32(38,0,true); ch.setUint32(42,off,true);
    cd.push(new Uint8Array(ch.buffer),nm);
    off += 30+nm.length+d.length;
  });
  let cdLen=0; cd.forEach(p=>cdLen+=p.length);
  const eo=new DataView(new ArrayBuffer(22));
  eo.setUint32(0,0x06054b50,true); eo.setUint16(8,files.length,true); eo.setUint16(10,files.length,true);
  eo.setUint32(12,cdLen,true); eo.setUint32(16,off,true);
  return new Blob([...parts,...cd,new Uint8Array(eo.buffer)],{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
}

const X = s => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
function R(t,o){o=o||{};const sz=o.sz||21;return `<w:r><w:rPr>${o.b?"<w:b/>":""}${o.i?"<w:i/>":""}${o.color?`<w:color w:val="${o.color}"/>`:""}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${X(t)}</w:t></w:r>`;}
function P(rs,o){o=o||{};const runs=Array.isArray(rs)?rs.join(""):rs;
  return `<w:p><w:pPr>${o.align?`<w:jc w:val="${o.align}"/>`:""}${o.ind?`<w:ind w:left="${o.ind}"/>`:""}<w:spacing w:before="${o.before||0}" w:after="${o.after==null?120:o.after}" w:line="264" w:lineRule="auto"/></w:pPr>${runs}</w:p>`;}
const BRK = `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>`;
function H(t,o){o=o||{};return P([R(t,{b:true,sz:o.sz||30,color:o.color||"111111"})],{before:200,after:120,align:o.align});}
function TD(t,o){o=o||{};
  const p=P([R(t,{b:o.b,sz:o.sz||19,color:o.color})],{align:o.align||"center",after:40});
  return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${o.shade?`<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>`:""}${o.span?`<w:gridSpan w:val="${o.span}"/>`:""}${o.vm?`<w:vMerge w:val="${o.vm}"/>`:""}<w:vAlign w:val="center"/></w:tcPr>${p}</w:tc>`;}
const TR = cs => `<w:tr>${cs.join("")}</w:tr>`;
function TBL(rows){
  const b=["top","left","bottom","right","insideH","insideV"].map(s=>`<w:${s} w:val="single" w:sz="4" w:space="0" w:color="B9B3A7"/>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${b}</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>${rows.join("")}</w:tbl>` + P([R("",{sz:12})],{after:0});
}
const MARCA = () => P([R("IMPERIUM ",{b:true,sz:26,color:"C9A227"}),R("TERCEIRIZAÇÃO E SERVIÇOS",{b:true,sz:16,color:"111111"})],{align:"right",after:200});
const BULLET = (t,d) => P([R("•  ",{b:true,color:"C9A227"}),R(t,{b:true}),R(d?": "+d:"")],{ind:200});

function docBody(){
  const cs = listaCargos(), esc0 = S.escopoTexto || escopoAuto();
  const P_=[];

  /* capa */
  P_.push(P([R("IMPERIUM",{b:true,sz:64,color:"C9A227"})],{align:"center",after:0}));
  P_.push(P([R("TERCEIRIZAÇÃO E SERVIÇOS",{b:true,sz:28})],{align:"center",after:200}));
  P_.push(P([R("www.imperiumservicos.com",{sz:22})],{align:"center",after:320}));
  P_.push(P([R("A pessoa certa no lugar certo faz a diferença",{b:true,sz:26,color:"C9A227"})],{align:"center",after:480}));
  P_.push(P([R("PROPOSTA DE PARCERIA",{b:true,sz:44})],{align:"center",after:120}));
  P_.push(P([R(nomeCliente()+" — "+S.localCliente,{sz:26,color:"555555"})],{align:"center",after:400}));
  P_.push(H("Nossos serviços",{sz:34,align:"center"}));
  if(cs.length){
    const linhas=[]; for(let i=0;i<cs.length;i+=3) linhas.push(cs.slice(i,i+3));
    P_.push(TBL(linhas.map(l=>TR(l.map(c=>TD((c.curto||c.nome),{b:true}))
      .concat(Array(3-l.length).fill(TD("")))))));
    linhas.length && P_.push(P([R("")],{after:0}));
  }

  /* carta */
  P_.push(BRK, MARCA());
  P_.push(P([R(S.cidade+", "+dataExt(S.data),{color:"444444"})]));
  P_.push(P([R("Prezada "),R(S.tratamento+" "+(S.responsavel||"________"),{b:true}),R(" – "+nomeCliente()+" – "+S.localCliente+".")]));
  P_.push(P([R("É com muita satisfação que apresentamos a proposta da Imperium para a prestação de serviços de "+esc0+". Na Imperium, acreditamos que a excelência do serviço é consequência direta do respeito, cuidado e valorização das pessoas envolvidas no processo.")],{align:"both"}));
  P_.push(P([R('"A Pessoa certa, no lugar certo, faz a diferença"',{b:true,sz:24})],{align:"center",before:200,after:200}));
  P_.push(H("Nosso Propósito e Diferencial Humano",{sz:24,color:"1F4E9B"}));
  P_.push(P([R("O mercado tradicional de terceirização costuma focar apenas em números e alocação de mão de obra. Na Imperium, priorizamos o tratamento individual e humano tanto para com nossos clientes quanto com nossa equipe de colaboradores. Cuidar de quem cuida do seu espaço garante motivação, menor rotatividade (turnover), segurança e alto padrão de capricho no dia a dia.")],{align:"both"}));
  P_.push(H("Suporte Completo à Funcionária Terceirizada",{sz:24,color:"1F4E9B"}));
  P_.push(P([R("Para assegurar que o atendimento em seu espaço ocorra com total eficiência e harmonia, oferecemos um programa contínuo de suporte e acompanhamento aos nossos profissionais.")],{align:"both"}));
  P_.push(H("Compromisso de Parceria e Alinhamento",{sz:24,color:"1F4E9B"}));
  P_.push(P([R("Será um prazer ter vocês como parceiros e servir o seu espaço com a nossa dedicação diária. Ficamos à disposição para qualquer dúvida ou ajuste que seja necessário; nosso objetivo é conversar abertamente para chegarmos a um alinhamento justo e benéfico para todos os envolvidos.")],{align:"both"}));
  if(S.obs) P_.push(P([R(S.obs)],{align:"both"}));
  P_.push(P([R("Cordialmente,")],{before:300}));
  P_.push(P([R(S.assinante,{b:true})],{after:0}));
  P_.push(P([R(S.cargoAssinante,{b:true})]));
  P_.push(P([R("IMPERIUM ",{b:true,sz:26,color:"C9A227"}),R("TERCEIRIZAÇÃO E SERVIÇOS",{b:true,sz:16})]));

  /* suporte */
  if(S.secoes.suporte){
    P_.push(BRK, MARCA(), H("Suporte Completo à Funcionária Terceirizada"));
    const hd=TR([TD("Pilar de Atuação",{b:true,shade:"1F4E9B",color:"FFFFFF"}),TD("Ações e Suporte Prestado",{b:true,shade:"1F4E9B",color:"FFFFFF"}),TD("Benefício para o Cliente",{b:true,shade:"1F4E9B",color:"FFFFFF"})]);
    const blocos=[
      ["Cuidados Operacionais e Ergonômicos",["Uniformes de alta qualidade e adequados à estação.","Equipamentos ergonômicos e produtos de alta performance.","Orientação contínua sobre segurança e postura técnica."],"Agilidade na execução, equipe motivada e ambiente padronizado."],
      ["Acompanhamento e Escuta Ativa",["Supervisão técnica quinzenal com foco humano e acolhedor.","Canal direto de suporte (ouvidoria/RH) para a funcionária.","Suporte imediato e gestão humanizada em caso de imprevistos."],"Tranquilidade operacional sem interrupção de cronograma ou faltas descobertas."],
      ["Desenvolvimento e Valorização",["Treinamentos periódicos de higienização e atendimento.","Programas de reconhecimento e premiação por desempenho.","Acompanhamento de bem-estar e ambiente saudável."],"Profissionais dedicadas, atenciosas, confiáveis e de longa permanência."]
    ];
    const rows=[hd];
    blocos.forEach(b=>b[1].forEach((acao,i)=>{
      rows.push(TR([
        i===0?TD(b[0],{b:true,vm:"restart"}):TD("",{vm:"continue"}),
        TD(acao),
        i===0?TD(b[2],{vm:"restart"}):TD("",{vm:"continue"})
      ]));
    }));
    P_.push(TBL(rows));
  }

  /* CBO */
  if(S.secoes.cbo){
    P_.push(BRK, MARCA(), H("SERVIÇOS SOLICITADOS"));
    cs.forEach((c,i)=>P_.push(P([R((i+1)+".  "+nomeDoc(c)+" – CBO "+c.cbo,{b:true})],{ind:200,after:60})));
    P_.push(H("O que é o CBO?",{sz:24}));
    P_.push(P([R("É um documento criado para identificar e codificar as ocupações do mercado de trabalho no Brasil.")]));
    P_.push(P([R("É uma classificação que serve como referência para o reconhecimento e a nomeação das profissões.")]));
    P_.push(P([R("Foi estabelecido pela Portaria Ministerial nº 397, de 9 de outubro de 2002.")]));
  }

  /* ponto e cartão */
  if(S.secoes.ponto){
    P_.push(BRK, MARCA(), H("Sistema de ponto via aplicativo",{align:"center"}));
    ["Registro facial","Registro por geolocalização","100% conforme a Portaria 671"].forEach(t=>P_.push(BULLET(t)));
    P_.push(H("Cartão Benefício para o Funcionário",{align:"center"}));
    ["Vale Refeição","Vale Alimentação","Vale Transporte","Prêmio por assiduidade","Multibenefícios"].forEach(t=>P_.push(BULLET(t)));
  }

  /* clientes */
  if(S.secoes.clientes){
    P_.push(BRK, MARCA(), H("Alguns de nossos clientes e parceiros",{align:"center"}));
    const ln=[]; for(let i=0;i<S.clientes.length;i+=2) ln.push(S.clientes.slice(i,i+2));
    P_.push(TBL(ln.map(l=>TR(l.map(c=>TD(c.t+" — "+c.n+" ("+c.c+")",{align:"left"}))
      .concat(Array(2-l.length).fill(TD(""))))))); 
    P_.push(H("QUEM SOMOS",{sz:20}));
    P_.push(P([R("Focamos no que é essencial para que você foque no seu negócio.",{b:true,sz:30})]));
    P_.push(P([R("A Imperium assume a gestão de atividades complementares com "),R("excelência e profissionalismo",{b:true}),R(".")]));
  }

  /* valores */
  const mediaBen = cs.length ? cs.reduce((s,c)=>s+benef(c),0)/cs.length : 0;
  P_.push(BRK, MARCA(), H("Da Proposta",{sz:40}));
  P_.push(P([R(S.base,{sz:24,color:"444444"})],{after:200}));

  P_.push(P([R("Remuneração da Colaboradora",{b:true})],{after:60}));
  P_.push(TBL([TR(["Função","Salário","Prêmio Assiduidade","Insalubridade Acúmulo","PLR anual","Total mensal"].map(t=>TD(t,{b:true,shade:"111111",color:"D7B247"})))]
    .concat(cs.map(c=>TR([TD(c.curto||c.nome,{b:true,align:"left"}),TD(brl(c.salario)),TD(brl(c.premio)),TD(brl(c.insal)),TD(brl(c.plr)),TD(brl(remun(c)))])))));

  P_.push(P([R("Benefícios mensais da Colaboradora",{b:true})],{after:60}));
  P_.push(TBL([TR(["Função","VR/ Dia","VT/ Dia","VA Cesta","Total"].map(t=>TD(t,{b:true,shade:"111111",color:"D7B247"})))]
    .concat(cs.map(c=>TR([TD(c.curto||c.nome,{b:true,align:"left"}),TD(brl(c.vr)),TD(brl(c.vt)),TD(brl(c.va)),TD(brl(benef(c)))])))));
  P_.push(P([R("Média mensal de benefícios por colaboradora: "+brl(mediaBen),{sz:19,color:"555555"})]));

  P_.push(P([R("Escopo e valores da proposta",{b:true})],{after:60}));
  P_.push(TBL([TR(["Função","Escala","Turno","Postos","Pessoas","Valor por posto","Valor total"].map(t=>TD(t,{b:true,shade:"111111",color:"D7B247"})))]
    .concat(cs.map(c=>TR([TD(c.curto||c.nome,{b:true,align:"left"}),TD(c.escala),TD(c.turno),TD(String(c.postos)),TD(String(c.func)),TD(brl(c.posto)),TD(brl((+c.posto||0)*(+c.postos||0)))])))
    .concat([TR([TD("Mensal",{b:true,span:6,align:"right",shade:"111111",color:"FFFFFF"}),TD(brl(totalMensal()),{b:true,shade:"111111",color:"D7B247"})])])));

  P_.push(H("Diferenciais e Condições da Proposta",{sz:24}));
  S.difs.forEach(d=>P_.push(BULLET(d.t,d.d)));

  /* aceite */
  if(S.secoes.aceite){
    P_.push(BRK, MARCA(), H("TERMO DE ACEITE",{sz:26}));
    P_.push(P([R("O "+(S.tipoCliente==="Empresa"?"":"Condomínio ")),R(nomeCliente(),{b:true}),R(" – "+S.localCliente+", com seu responsável legal faz o aceite da proposta da qual passará pelos ajustes jurídicos de contrato e após o início dos trabalhos conforme acertado entre as partes.")],{align:"both"}));
    P_.push(P([R("Valor mensal acordado: "),R(brl(totalMensal()),{b:true}),R(" — "+cs.reduce((s,c)=>s+(+c.postos||0),0)+" posto(s) de trabalho.")],{before:200}));
    P_.push(P([R(S.cidade+", "+dataExt(S.data),{color:"444444"})],{before:600}));
    P_.push(P([R("____________________________________")],{before:600,after:0}));
    P_.push(P([R(S.tratamento+" "+(S.responsavel||"________"))],{after:0}));
    P_.push(P([R(nomeCliente(),{b:true})]));
  }

  P_.push(P([R("www.imperiumservicos.com – CNPJ: 62.249.653.0001/66",{sz:18,color:"777777"})],{align:"center",before:400}));
  return P_.join("");
}

function docxBlob(){
  const enc=new TextEncoder();
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${docBody()}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1021" w:bottom="1134" w:left="1021" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  return zipar([
    {name:"[Content_Types].xml", data:enc.encode(ct)},
    {name:"_rels/.rels", data:enc.encode(rels)},
    {name:"word/document.xml", data:enc.encode(doc)}
  ]);
}

function nomeArquivo(){
  const base = "Proposta Imperium - " + (S.cliente || "cliente");
  return base.replace(/[\\/:*?"<>|]/g,"-").slice(0,120);
}

async function exportarWord(){
  const btn=document.getElementById("word"); const txt=btn?btn.textContent:"";
  try{
    if(btn){ btn.textContent="Gerando..."; btn.disabled=true; }
    const blob = docxBlob();
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download=nomeArquivo()+".docx"; document.body.appendChild(a); a.click();
    setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},2000);
  }catch(err){
    if(err && err.code!=="declined") alert("Não foi possível exportar: "+((err&&err.message)||(err&&err.code)||err));
  }finally{
    if(btn){ btn.textContent=txt||"Exportar para Word (.docx)"; btn.disabled=false; }
  }
}


function imprimir(){
  window.print();
}

/* ---------- integração com a plataforma ---------- */
const TEMPLATE = `
<div class="tabs">
  <button data-tab="edit" class="on">Configurar</button>
  <button data-tab="prev">Visualizar</button>
</div>
<div class="app">
  <aside class="rail" id="rail"></aside>
  <main class="stage">
    <div class="stagebar">
      <div class="zoom">Pré-visualização A4</div>
      <div>
        <button id="zout" aria-label="Diminuir zoom">−</button><button id="zin" aria-label="Aumentar zoom">+</button>
        <button id="print">Imprimir / salvar PDF</button>
      </div>
    </div>
    <div class="papers" id="papers"></div>
  </main>
</div>`;

function mount(el){
  root = el;
  root.className = "mod-propostas m-edit";
  root.innerHTML = TEMPLATE;
  zoom = 1;
  if(!iniciado){ carregar(); iniciado = true; }
  ouvintes.forEach(([t,fn]) => root.addEventListener(t, fn));
  painel();
  renderPapers();
}

function unmount(){
  if(!root) return;
  ouvintes.forEach(([t,fn]) => root.removeEventListener(t, fn));
  root = null;
}

Platform.register({
  id: "propostas",
  menu: "Propostas",
  nome: "Gerador de propostas",
  descricao: "Monte a proposta de um cliente, confira os valores e gere o PDF ou o arquivo Word.",
  icone: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/>',
  mount, unmount
});

})();
