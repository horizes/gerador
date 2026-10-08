/* Central de pendências: consultas de leitura às ferramentas já autorizadas.
   Nenhuma aprovação, confirmação ou alteração é feita por esta página. */
(function(){
'use strict';
const sb=()=>window.Imperium.supabase;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const grupos={uniformes:'Uniformes e EPI',ponto:'Ponto',acessos:'Acessos',financeiro:'Financeiro'};
const ouvintes=new Set();
let estado={itens:[],falhas:[],carregando:false,consultado:false,atualizado:null,categorias:[]};
let assinatura='',execucao=null,geracao=0,iniciado=false;
function permissoes(){
 const p=window.Imperium.perfil;
 if(!p)return null;
 const pode=id=>!!(p.admin||p.podeVer(id));
 return {id:p.id,admin:!!p.admin,sol:pode('uniforme_solicitar'),ges:pode('uniforme_gestao'),meu:pode('ponto_meu'),ponto:pode('ponto_gestao'),fluxo:pode('fluxo')};
}
function chave(p){return JSON.stringify(p);}
function categorias(p){return Object.keys(grupos).filter(id=>id==='uniformes'?(p.sol||p.ges):id==='ponto'?(p.meu||p.ponto):id==='acessos'?p.admin:p.fluxo);}
function resultado(){
 const p=permissoes();
 return p&&chave(p)===assinatura?estado:{itens:[],falhas:[],carregando:false,consultado:false,atualizado:null,categorias:p?categorias(p):[]};
}
function emitir(){
 window.Platform.setBadge('pendencias',resultado().itens.filter(i=>i.situacao==='acao').length);
 ouvintes.forEach(fn=>fn(resultado()));
}
function observar(fn){ouvintes.add(fn);fn(resultado());return ()=>ouvintes.delete(fn);}
async function ler(criar){return window.Imperium.lerTodas(criar);}
async function rpc(nome){const r=await sb().rpc(nome);if(r.error)throw r.error;return r.data||[];}
function href(modulo,params={}){const qs=new URLSearchParams(params).toString();return '#/'+modulo+(qs?'?'+qs:'');}
function item(id,categoria,titulo,detalhe,data,situacao,acao,destino,extra={}){return {id,categoria,titulo,detalhe,data,situacao,acao,href:destino,...extra};}
async function uniformes(p){
 const pedidos=await ler(()=>{
  let q=sb().from('uniforme_pedidos').select('id,solicitante_id,solicitante_nome,status,criado_em').in('status',['pendente','pronto','parcial']).order('criado_em').order('id');
  if(!p.ges)q=q.eq('solicitante_id',p.id);
  return q;
 });
 return pedidos.flatMap(r=>{
  const meu=r.solicitante_id===p.id,nome=r.solicitante_nome||'Colaborador';
  if(r.status==='pendente'&&p.ges)return [item('uniforme:'+r.id,'uniformes','Pedido aguardando atendimento',nome,r.criado_em,'acao','Atender pedido',href('uniforme_gestao',{pedido:r.id}))];
  if(meu&&p.sol&&['pronto','parcial'].includes(r.status))return [item('uniforme:'+r.id,'uniformes',r.status==='parcial'?'Confirme os itens restantes':'Uniforme e EPI pronto para retirada','Retire os itens e confirme o recebimento.',r.criado_em,'acao','Confirmar recebimento',href('uniforme_solicitar',{categoria:'andamento',pedido:r.id}))];
  if(meu&&p.sol&&r.status==='pendente')return [item('uniforme:'+r.id,'uniformes','Seu pedido aguarda atendimento','Acompanhe a resposta da gestão.',r.criado_em,'aguardando','Acompanhar pedido',href('uniforme_solicitar',{categoria:'pedidos',pedido:r.id}))];
  if(p.ges&&['pronto','parcial'].includes(r.status))return [item('uniforme:'+r.id,'uniformes','Aguardando confirmação de recebimento',nome,r.criado_em,'aguardando','Acompanhar entrega',href('uniforme_gestao',{filtro:'entrega',pedido:r.id}))];
  return [];
 });
}
async function ponto(p){
 const [solicitacoes,decisoes,vinculos]=await Promise.all([
  ler(()=>{let q=sb().from('ponto_solicitacoes').select('id,vinculo_id,usuario_id,tipo,motivo,criado_em').order('criado_em').order('id');return p.ponto?q:q.eq('usuario_id',p.id);}),
  ler(()=>sb().from('ponto_decisoes').select('id,solicitacao_id').order('id')),
  ler(()=>{let q=sb().from('ponto_vinculos').select('id,usuario_id,nome,criado_em').order('criado_em').order('id');return p.ponto?q:q.eq('usuario_id',p.id);})
 ]);
 const resolvidos=new Set(decisoes.map(d=>d.solicitacao_id)),nomes=new Map(vinculos.map(v=>[v.id,v.nome]));
 return solicitacoes.filter(s=>!resolvidos.has(s.id)&&(p.ponto||s.usuario_id===p.id)).map(s=>item('ponto:'+s.id,'ponto',p.ponto?'Ajuste de ponto para análise':'Seu ajuste de ponto aguarda análise',
  (nomes.get(s.vinculo_id)||'Colaborador')+' · '+(s.tipo==='incluir'?'Inclusão de horário':'Desconsideração de batida')+' · '+s.motivo,
  s.criado_em,p.ponto?'acao':'aguardando',p.ponto?'Analisar ajuste':'Acompanhar ajuste',href(p.ponto?'ponto_gestao':'ponto_meu',{categoria:'ajustes',pedido:s.id})));
}
async function convites(){
 const rows=await ler(()=>sb().from('convites_pendentes').select('token,nome,criado_em').is('usado_em',null).order('criado_em').order('token'));
 return rows.map(r=>{
  const expirou=Date.now()-new Date(r.criado_em).getTime()>=7*86400000;
  return item('convite:'+r.token,'acessos',expirou?'Convite expirado':'Convite ainda não concluído',r.nome||'Pessoa convidada',r.criado_em,expirou?'acao':'aguardando',expirou?'Gerar novo convite':'Ver convite',href('usuarios',{categoria:'convites'}));
 });
}
async function cadastros(){
 const [perfis,senhas]=await Promise.all([rpc('admin_listar_perfis'),rpc('admin_listar_estado_senha')]);
 const mapa=new Map(senhas.map(s=>[s.id,s.senha_definida]));
 if(perfis.some(p=>p.ativo&&p.email_confirmado_em&&typeof mapa.get(p.id)!=='boolean'))throw Error('Estado da senha indisponível.');
 return perfis.filter(p=>p.ativo&&(!p.email_confirmado_em||mapa.get(p.id)===false)).map(p=>item('cadastro:'+p.id,'acessos','Cadastro incompleto',
  (p.nome||p.email||'Colaborador')+' · '+(!p.email_confirmado_em?'E-mail não confirmado':'Senha ainda não criada'),p.criado_em,'aguardando','Ver pessoa',href('usuarios',{categoria:'pessoas',pessoa:p.id})));
}
async function financeiro(){
 const rows=await ler(()=>sb().from('fluxo_lancamentos').select('id,data,tipo,categoria,descricao,valor,status').eq('status','pendente').order('data').order('id'));
 return rows.filter(r=>r.status==='pendente').map(r=>item('financeiro:'+r.id,'financeiro',r.tipo==='entrada'?'Recebimento pendente':'Pagamento pendente',
  [r.descricao||r.categoria,r.categoria&&r.descricao?r.categoria:''].filter(Boolean).join(' · '),r.data,'acao','Conferir lançamento',href('fluxo',{lancamento:r.id}),{valor:Number(r.valor),dataRotulo:'Data do lançamento'}));
}
async function atualizar(){
 const p=permissoes();if(!p)return;
 const sig=chave(p);
 if(execucao&&assinatura===sig)return execucao;
 const g=++geracao;
 if(sig!==assinatura){assinatura=sig;estado={itens:[],falhas:[],carregando:false,consultado:false,atualizado:null,categorias:categorias(p)};}
 estado={...estado,carregando:true};emitir();
 const fontes=[];
 if(p.sol||p.ges)fontes.push({nome:'Uniformes e EPI',carregar:()=>uniformes(p)});
 if(p.meu||p.ponto)fontes.push({nome:'Ajustes de ponto',carregar:()=>ponto(p)});
 if(p.admin)fontes.push({nome:'Convites',carregar:convites},{nome:'Cadastros incompletos',carregar:cadastros});
 if(p.fluxo)fontes.push({nome:'Financeiro',carregar:financeiro});
 const trabalho=(async()=>{
  const res=await Promise.allSettled(fontes.map(f=>f.carregar()));
  if(g!==geracao||chave(permissoes())!==sig)return;
  const itens=[],falhas=[];
  res.forEach((r,i)=>r.status==='fulfilled'?itens.push(...r.value):falhas.push(fontes[i].nome));
  itens.sort((a,b)=>(a.situacao==='acao'?0:1)-(b.situacao==='acao'?0:1)||String(a.data||'').localeCompare(String(b.data||''))||a.id.localeCompare(b.id));
  estado={itens,falhas,carregando:false,consultado:true,atualizado:new Date(),categorias:categorias(p)};emitir();
 })();
 execucao=trabalho;
 try{await trabalho;}finally{if(g===geracao)execucao=null;}
}
function iniciar(){
 if(iniciado)return;iniciado=true;
 atualizar();
 setInterval(()=>{if(!document.hidden)atualizar();},120000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)atualizar();});
}
function htmlHome(){
 const e=resultado();
 if(!e.consultado)return '';
 if(!e.itens.length&&!e.falhas.length)return '';
 return `<div class="home-attention-head"><span class="home-attention-dot" aria-hidden="true"></span><h2>Central de pendências</h2></div>
 <div class="home-attention-list">${e.categorias.map(cat=>{
  const itens=e.itens.filter(i=>i.categoria===cat);if(!itens.length)return '';
  const acao=itens.filter(i=>i.situacao==='acao').length;
  return `<a href="${href('pendencias',{categoria:cat})}" class="home-attention-item"><span><b>${itens.length} · ${grupos[cat]}</b><small>${acao} para resolver · ${itens.length-acao} aguardando retorno</small></span><span aria-hidden="true">→</span></a>`;
 }).join('')}</div>${e.falhas.length?'<p class="pc-home-erro">Algumas pendências não puderam ser consultadas. Abra a central para tentar novamente.</p>':''}
 <a class="btn ghost pc-home-link" href="#/pendencias">Abrir central de pendências</a>`;
}
window.ImperiumPendencias={atualizar,estado:resultado,observar,htmlHome};

/* Página: filtros permanecem durante a atualização e a troca de categorias. */
let pagina=null;
const semAcento=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function dataTexto(s){
 if(!s)return '';
 const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T12:00:00':s);
 return Number.isNaN(d.getTime())?'':d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
}
function card(i){
 const data=dataTexto(i.data);
 const valor=Number.isFinite(i.valor)?`<span class="pc-valor">${i.valor.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</span>`:'';
 return `<li class="pc-item"><div class="pc-item-conteudo"><div class="pc-item-top"><span class="pc-grupo">${grupos[i.categoria]}</span><span class="pc-status ${i.situacao}">${i.situacao==='acao'?'Para resolver':'Aguardando retorno'}</span></div><h2>${esc(i.titulo)}</h2><p>${esc(i.detalhe)}</p><div class="pc-item-meta">${data?`<span>${esc(i.dataRotulo||'Desde')} ${data}</span>`:''}${valor}</div></div><a class="btn ghost" href="${esc(i.href)}">${esc(i.acao)} <span aria-hidden="true">→</span></a></li>`;
}
function render(s){
 if(pagina!==s)return;
 const e=resultado(),q=sel=>s.el.querySelector(sel);
 q('[data-atualizar]').disabled=e.carregando;
 q('[data-atualizar]').textContent=e.carregando?'Atualizando…':'Atualizar';
 q('[data-consulta]').textContent=e.carregando?'Consultando pendências…':e.atualizado?'Atualizado às '+e.atualizado.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'';
 const aviso=q('[data-falhas]');aviso.hidden=!e.falhas.length;aviso.textContent=e.falhas.length?'Não foi possível consultar: '+e.falhas.join(', ')+'. As outras pendências continuam disponíveis. Toque em Atualizar para tentar novamente.':'';
 q('[data-total]').textContent=e.itens.length;q('[data-acoes]').textContent=e.itens.filter(i=>i.situacao==='acao').length;q('[data-aguardando]').textContent=e.itens.filter(i=>i.situacao==='aguardando').length;
 const termo=semAcento(q('[name=busca]').value.trim()),situacao=q('[name=situacao]').value;
 const filtrados=e.itens.filter(i=>(situacao==='todas'||i.situacao===situacao)&&(!termo||semAcento([i.titulo,i.detalhe,grupos[i.categoria]].join(' ')).includes(termo)));
 ['todas',...s.categorias].forEach(cat=>{
  s.nav.contagem(cat,cat==='todas'?e.itens.length:e.itens.filter(i=>i.categoria===cat).length);
  const lista=filtrados.filter(i=>cat==='todas'||i.categoria===cat),limite=s.limites[cat]||40,area=q(`[data-lista="${cat}"]`);
  const vazio=!e.consultado?'Consultando pendências…':e.falhas.length?'Não há itens nos dados que foi possível consultar.':termo||situacao!=='todas'?'Nenhuma pendência corresponde aos filtros.':cat==='todas'?'Tudo em dia. Nenhuma pendência encontrada.':'Nenhuma pendência nesta categoria.';
  area.innerHTML=lista.length?`<ul class="pc-lista">${lista.slice(0,limite).map(card).join('')}</ul>${lista.length>limite?`<div class="pc-mais"><span>${limite} de ${lista.length} pendências</span><button class="btn ghost" data-mais="${cat}" type="button">Mostrar mais</button></div>`:''}`:`<div class="pc-vazio"><p>${vazio}</p></div>`;
 });
}
async function mount(el){
 unmount();const e=resultado(),cats=e.categorias;
 const s={el,categorias:cats,limites:{}};pagina=s;
 el.innerHTML=`<main class="pc"><header class="pc-header"><div><h1>Central de pendências</h1><p>Resolva o que precisa de ação e acompanhe o que está aguardando retorno.</p></div><button class="btn ghost" data-atualizar type="button">Atualizar</button></header>
 <p data-consulta class="pc-consulta" role="status" aria-live="polite"></p><p data-falhas class="pc-falhas" role="status" hidden></p>
 <div class="pc-resumo"><div><b data-total>0</b><span>Pendências</span></div><div><b data-acoes>0</b><span>Para resolver</span></div><div><b data-aguardando>0</b><span>Aguardando retorno</span></div></div>
 <div data-categorias-nav></div><div class="pc-filtros"><label>Buscar<input name="busca" type="search" placeholder="Nome, descrição ou pendência" autocomplete="off"></label><label>Situação<select name="situacao"><option value="todas">Todas</option><option value="acao">Para resolver</option><option value="aguardando">Aguardando retorno</option></select></label></div>
 ${['todas',...cats].map(cat=>`<section data-categoria-painel="${cat}" hidden><div data-lista="${cat}"></div></section>`).join('')}
 ${cats.includes('financeiro')?'<p class="pc-nota">Financeiro: são exibidos os lançamentos com status pendente. A data do lançamento não é tratada como vencimento.</p>':''}</main>`;
 s.nav=window.ImperiumCategorias.montar(el,{id:'central-pendencias',rotulo:'Categorias de pendências',inicial:window.Platform.parametrosRota().get('categoria')||'todas',itens:[{id:'todas',nome:'Todas'},...cats.map(id=>({id,nome:grupos[id]}))]});
 s.click=event=>{const b=event.target.closest('button');if(!b)return;if(b.hasAttribute('data-atualizar'))atualizar();if(b.dataset.mais){const cat=b.dataset.mais,anterior=s.limites[cat]||40;s.limites[cat]=anterior+40;render(s);const foco=el.querySelector(`[data-mais="${cat}"]`)||el.querySelector(`[data-categoria-painel="${cat}"] .pc-item:nth-child(${anterior+1}) a`);foco?.focus({preventScroll:true});}};
 s.filtrar=()=>{s.limites={};render(s);};
 s.input=event=>{if(event.target.matches('[name=busca]'))s.filtrar();};
 s.change=event=>{if(event.target.matches('[name=situacao]'))s.filtrar();};
 el.addEventListener('click',s.click);el.addEventListener('input',s.input);el.addEventListener('change',s.change);
 s.desobservar=observar(()=>render(s));
 await atualizar();
}
function unmount(){if(!pagina)return;const s=pagina;pagina=null;s.desobservar();s.nav.destruir();s.el.removeEventListener('click',s.click);s.el.removeEventListener('input',s.input);s.el.removeEventListener('change',s.change);}
window.Platform.register({id:'pendencias',categoria:'rotina',menu:'Central de pendências',nome:'Central de pendências',descricao:'Resolva pendências e acompanhe seus pedidos em um só lugar.',sempreVisivel:true,configuravel:false,
 icone:'<path d="M9 3h6l1 2h3v16H5V5h3z"/><path d="M9 3v4h6V3M9 12h6M9 16h4"/>',aoIniciar:iniciar,mount,unmount});
})();
