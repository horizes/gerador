/* Clientes/postos e fechamento mensal para encaminhamento à contabilidade. */
(function(){'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sb=()=>window.Imperium.supabase,uid=()=>window.Imperium.perfil.id;
const fmt=s=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(s));
const slug=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w-]+/g,'-').slice(0,65);
const meses=()=>window.Imperium.hojeLocal().slice(0,7);
// WhatsApp: Bootstrap Icons (MIT); licença em assets/licenses/bootstrap-icons.txt.
const WHATSAPP_ICONE='<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.601 2.326A7.85 7.85 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.9 7.9 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.9 7.9 0 0 0 13.6 2.326zM7.994 14.521a6.6 6.6 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.56 6.56 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592m3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.73.73 0 0 0-.529.247c-.182.198-.691.677-.691 1.654s.71 1.916.81 2.049c.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232"/></svg>';
let atual=null;
async function rpc(n,a){const r=await sb().rpc(n,a);if(r.error)throw Error(r.error.message);return r.data;}
async function ler(t){return window.Imperium.lerTodas(()=>sb().from(t).select('*').order('criado_em'));}
function alerta(s,t,erro=false){if(!s.el.isConnected)return;const el=s.el.querySelector('[data-msg]');el.textContent=t;el.className='op-msg'+(erro?' erro':'');}
function download(nome,blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=nome;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function opcoes(lista,valor='',vazio='Selecione'){return `<option value="">${vazio}</option>`+lista.map(x=>`<option value="${esc(x.id)}" ${x.id===valor?'selected':''}>${esc(x.nome)}</option>`).join('');}
function campo(nome,rotulo,valor='',tipo='text',extra=''){return `<label>${rotulo}<input name="${nome}" type="${tipo}" value="${esc(valor)}" ${extra}></label>`;}
function contatoCliente(c){
 const telefone=String(c.telefone??'').trim();let numero=telefone.replace(/\D/g,'');
 if(!/^\+?[\d\s().-]+$/.test(telefone))numero='';
 else if(!telefone.startsWith('+')&&(numero.length===10||numero.length===11))numero='55'+numero;
 if(!/^[1-9]\d{7,14}$/.test(numero)||(numero.startsWith('55')&&!/^55\d{10,11}$/.test(numero))||(!telefone.startsWith('+')&&!/^55\d{10,11}$/.test(numero)))numero='';
 return `<div class="op-contato"><span>${esc(c.contato)}<small>${esc([c.email,telefone].filter(Boolean).join(' · '))}</small></span>${numero?`<a class="btn ghost op-whatsapp" href="https://wa.me/${numero}" target="_blank" rel="noopener noreferrer" aria-label="${esc('Chamar '+(c.contato||c.nome)+' no WhatsApp')}">${WHATSAPP_ICONE}Chamar no WhatsApp</a>`:''}</div>`;
}
function enderecoPosto(p){
 const endereco=String(p.endereco??'').trim();if(!endereco)return '<span class="op-endereco-vazio">Endereço não informado</span>';
 const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const url=new URL(ios?'https://maps.apple.com/':'https://www.google.com/maps/search/');
 if(!ios)url.searchParams.set('api','1');url.searchParams.set(ios?'q':'query',endereco);
 return `<div class="op-endereco"><span>${esc(endereco)}</span><a class="btn ghost op-mapa" href="${esc(url.href)}" target="_blank" rel="noopener noreferrer" aria-label="${esc('Abrir endereço de '+p.nome+' no mapa')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>Abrir no mapa</a></div>`;
}
function resumo(registros){const grupos=new Map();for(const r of registros){if(!r.posto_id)continue;let g=grupos.get(r.posto_id);if(!g){g={id:r.posto_id,cliente:r.cliente_nome,posto:r.posto_nome,registros:[],pecas:0};grupos.set(r.posto_id,g);}g.registros.push(r);g.pecas+=r.itens.reduce((n,i)=>n+Number(i.quantidade),0);}return [...grupos.values()].sort((a,b)=>(a.cliente+a.posto).localeCompare(b.cliente+b.posto,'pt-BR'));}
window.ImperiumRelatorios={resumo};
async function carregar(s){const [clientes,postos]=await Promise.all([ler('operacao_clientes'),ler('operacao_postos')]);if(atual!==s)return;s.clientes=clientes;s.postos=postos;
if(s.tipo==='clientes'){const [equipe,alocacoes]=await Promise.all([rpc('operacao_equipe'),ler('operacao_alocacoes')]);if(atual!==s)return;s.equipe=equipe;s.alocacoes=alocacoes;renderCadastros(s);}else{const mes=s.el.querySelector('[name=mes]').value;if(!/^\d{4}-\d{2}$/.test(mes))throw Error('Selecione o mês.');s.mes=mes;s.registros=await rpc('uniforme_resumo_mensal',{p_mes:mes+'-01',p_posto:null});if(atual!==s)return;renderRelatorios(s);}}
function lista(titulos,linhas){return `<div class="op-table"><table><thead><tr>${titulos.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${linhas||`<tr><td colspan="${titulos.length}">Nenhum cadastro.</td></tr>`}</tbody></table></div>`;}
function mudarAba(s,aba,focar=false){
 if(!['clientes','postos'].includes(aba))return;s.aba=aba;
 s.el.querySelectorAll('[data-aba]').forEach(b=>{const ativa=b.dataset.aba===aba;b.classList.toggle('on',ativa);b.setAttribute('aria-selected',String(ativa));b.tabIndex=ativa?0:-1;if(ativa&&focar)b.focus({preventScroll:true});});
 s.el.querySelectorAll('[data-painel]').forEach(p=>p.hidden=p.dataset.painel!==aba);
}
function renderCadastros(s){const el=s.el.querySelector('[data-conteudo]');el.innerHTML=`<div id="opPainel-clientes" role="tabpanel" aria-labelledby="opAba-clientes" data-painel="clientes"><div data-form="cliente"></div><section class="op-card"><div class="op-top"><h2>Clientes</h2><button class="btn" data-novo="cliente">Cadastrar cliente</button></div>${lista(['Cliente','Contato','Situação',''],s.clientes.map(c=>`<tr><td>${esc(c.nome)}<small>${esc(c.documento)}</small></td><td>${contatoCliente(c)}</td><td>${c.ativo?'Ativo':'Inativo'}</td><td><button class="btn ghost" data-editar="cliente" data-id="${c.id}">Editar</button></td></tr>`).join(''))}</section></div>
<div id="opPainel-postos" role="tabpanel" aria-labelledby="opAba-postos" data-painel="postos" hidden><div data-form="posto"></div><section class="op-card"><div class="op-top"><h2>Postos de trabalho</h2><button class="btn" data-novo="posto">Cadastrar posto</button></div>${lista(['Posto / cliente','Endereço','Situação',''],s.postos.map(p=>`<tr><td>${esc(p.nome)}<small>${esc(s.clientes.find(c=>c.id===p.cliente_id)?.nome)}</small></td><td>${enderecoPosto(p)}</td><td>${p.ativo?'Ativo':'Inativo'}</td><td><button class="btn ghost" data-editar="posto" data-id="${p.id}">Editar</button></td></tr>`).join(''))}</section>
<section class="op-card"><h2>Colaboradores por posto</h2><p>Ao transferir alguém, a alocação anterior é encerrada no dia anterior. Recebimentos já registrados mantêm o posto original.</p><form data-alocar class="op-form"><label>Colaborador<select name="usuario" required>${opcoes(s.equipe)}</select></label><label>Posto<select name="posto" required>${opcoes(s.postos.filter(p=>p.ativo&&s.clientes.find(c=>c.id===p.cliente_id)?.ativo).map(p=>({...p,nome:(s.clientes.find(c=>c.id===p.cliente_id)?.nome||'')+' · '+p.nome})))}</select></label>${campo('inicio','Vigente a partir de',window.Imperium.hojeLocal(),'date','required')}<button class="btn" type="submit">Salvar alocação</button></form>${lista(['Colaborador','Posto','Vigência'],s.alocacoes.slice().reverse().map(a=>`<tr><td>${esc(s.equipe.find(x=>x.id===a.usuario_id)?.nome||'Conta inativa')}</td><td>${esc(s.postos.find(x=>x.id===a.posto_id)?.nome)}</td><td>${esc(a.inicio)} até ${esc(a.fim||'atualmente')}</td></tr>`).join(''))}</section></div>`;s.el.querySelector('[data-conta-clientes]').textContent=s.clientes.length;s.el.querySelector('[data-conta-postos]').textContent=s.postos.length;mudarAba(s,s.aba);}
function formCadastro(s,tipo,id){const obj=(tipo==='cliente'?s.clientes:s.postos).find(x=>x.id===id)||{};const area=s.el.querySelector(`[data-form="${tipo}"]`);area.innerHTML=`<section class="op-card"><h2>${id?'Editar':'Cadastrar'} ${tipo}</h2><form data-cadastro data-tipo="${tipo}" data-id="${id||''}" class="op-form">${campo('nome','Nome',obj.nome||'','text','required maxlength="150" minlength="2"')}${tipo==='cliente'?campo('documento','CNPJ / identificação',obj.documento)+campo('contato','Responsável / síndico',obj.contato)+campo('email','E-mail de contato',obj.email,'email')+campo('telefone','Telefone / WhatsApp (com DDD)',obj.telefone,'tel'):`<label>Cliente<select name="cliente_id" required>${opcoes(s.clientes,obj.cliente_id)}</select></label>${campo('endereco','Endereço',obj.endereco)}`}<label>Situação<select name="ativo"><option value="true" ${obj.ativo!==false?'selected':''}>Ativo</option><option value="false" ${obj.ativo===false?'selected':''}>Inativo</option></select></label><button class="btn" type="submit">Salvar</button><button class="btn ghost" type="button" data-fechar>Cancelar</button></form></section>`;area.querySelector('input').focus();area.scrollIntoView({behavior:'smooth',block:'start'});}
function renderRelatorios(s){
 s.grupos=resumo(s.registros);
 for(const posto of s.postos){const cliente=s.clientes.find(c=>c.id===posto.cliente_id);if(posto.ativo&&cliente?.ativo&&!s.grupos.some(g=>g.id===posto.id))s.grupos.push({id:posto.id,cliente:cliente.nome,posto:posto.nome,registros:[],pecas:0});}
 s.grupos.sort((a,b)=>(a.cliente+a.posto).localeCompare(b.cliente+b.posto,'pt-BR'));
 const pendentes=s.registros.filter(r=>!r.posto_id);
 s.el.querySelector('[data-conteudo]').innerHTML=`
 <div data-categoria-painel="resumo"><section class="op-card"><h2>Fechamento de ${esc(s.mes)}</h2>
 <p>São considerados recebimentos confirmados no mês, pelo horário do servidor em Brasília. Pedidos ainda não recebidos não entram.</p>
 <div class="op-kpis"><div><b>${s.registros.length}</b><span>recebimentos</span></div><div><b>${s.grupos.length}</b><span>postos</span></div><div><b>${s.grupos.reduce((n,g)=>n+g.pecas,0)}</b><span>peças identificadas</span></div></div>
 <p>Escolha um resumo geral de todos os postos ou o relatório de um posto específico. O PDF inclui os resumos e os comprovantes de recebimento.</p>
 <form class="op-form" data-exportar><label>Tipo de resumo<select name="tipo_pdf"><option value="geral">Resumo geral — todos os postos</option><option value="posto">Por posto</option></select></label><label data-escolher-posto hidden>Posto<select name="posto_pdf" disabled>${opcoes(s.grupos.map(g=>({id:g.id,nome:g.cliente+' · '+g.posto})))}</select></label><button class="btn" type="submit">Baixar PDF</button></form>
 ${pendentes.length?`<p class="op-alerta">${pendentes.length} recebimento(s) sem posto. Associe os registros antigos antes de gerar o resumo geral. Os PDFs dos postos identificados continuam disponíveis.</p><button class="btn ghost" type="button" data-abrir-categoria="pendentes">Identificar recebimentos pendentes</button>`:''}
 </section></div>
 <div data-categoria-painel="postos" hidden>
 ${s.grupos.map(g=>`<section class="op-card"><div class="op-top"><div><h2>${esc(g.posto)}</h2><p>${esc(g.cliente)} · ${g.registros.length} recebimentos · ${g.pecas} peças</p></div><button class="btn" data-pdf="${g.id}">Baixar PDF do posto</button></div>${lista(['Colaborador','Recebimento','Itens'],g.registros.map(r=>`<tr><td>${esc(r.nome)}<small>${esc(r.cargo)}</small></td><td>${esc(fmt(r.criado_em))}</td><td>${r.itens.map(i=>`${i.quantidade} × ${esc(i.nome)}${i.tamanho?' ('+esc(i.tamanho)+')':''}`).join('<br>')}</td></tr>`).join(''))}</section>`).join('')||'<section class="op-card">Nenhum posto disponível no mês selecionado.</section>'}
 ${!s.registros.length?'<section class="op-card">Nenhum recebimento confirmado no mês selecionado.</section>':''}
 </div>
 <div data-categoria-painel="pendentes" hidden><section class="op-card"><h2>Identificar recebimentos antigos</h2>
 ${pendentes.length?pendentes.map(r=>`<form class="op-form" data-associar data-id="${r.id}"><span>${esc(r.nome)} · ${esc(fmt(r.criado_em))}</span><label>Posto na época<select name="posto" required>${opcoes(s.postos)}</select></label>${campo('motivo','Justificativa','','text','required minlength="5"')}<button class="btn ghost" type="submit">Associar registro</button></form>`).join(''):'<p>Nenhum recebimento sem posto no mês selecionado.</p>'}
 </section></div>`;
 if(!s.categorias)s.categorias=window.ImperiumCategorias.montar(s.el,{id:'resumo-mensal',rotulo:'Categorias do resumo mensal',inicial:'resumo',itens:[{id:'resumo',nome:'Resumo e exportação'},{id:'postos',nome:'Recebimentos por posto'},{id:'pendentes',nome:'Pendências'}]});
 else s.categorias.atualizar();
 s.categorias.contagem('postos',s.grupos.length);s.categorias.contagem('pendentes',pendentes.length);
 atualizarExportacao(s);
}
function atualizarExportacao(s){
 const form=s.el.querySelector('[data-exportar]');if(!form)return;
 const porPosto=form.querySelector('[name=tipo_pdf]').value==='posto',posto=form.querySelector('[name=posto_pdf]');
 form.querySelector('[data-escolher-posto]').hidden=!porPosto;posto.required=porPosto;
 form.querySelector('[name=tipo_pdf]').disabled=!!s.exportando;posto.disabled=!porPosto||!!s.exportando;
 form.querySelector('[type=submit]').disabled=!!s.exportando||!s.grupos.length||(!porPosto&&s.registros.some(r=>!r.posto_id));
}
async function exportarPdf(s,b,postoId=null){
 if(s.exportando)return;
 const grupos=postoId?s.grupos.filter(g=>g.id===postoId):s.grupos,mes=s.mes;
 if(!grupos.length)throw Error('Selecione um posto disponível para gerar o PDF.');
 if(!postoId&&s.registros.some(r=>!r.posto_id))throw Error('Identifique os recebimentos sem posto antes de gerar o resumo geral.');
 s.exportando=true;b.disabled=true;atualizarExportacao(s);s.el.querySelectorAll('[data-pdf]').forEach(el=>el.disabled=true);
 alerta(s,'Preparando resumos e comprovantes…');
 try{
  const blob=await pdf(grupos,mes,g=>alerta(s,'Gerando: '+g.cliente+' · '+g.posto));
  const nome=postoId?mes+'-'+slug(grupos[0].posto)+'-'+grupos[0].id.slice(0,8)+'.pdf':'uniformes-epi-resumo-geral-'+mes+'.pdf';
  download(nome,blob);alerta(s,'PDF gerado.');
 }finally{s.exportando=false;if(b.isConnected)b.disabled=false;s.el.querySelectorAll('[data-pdf]').forEach(el=>el.disabled=false);atualizarExportacao(s);}
}
let libPromise;
function carregarPdf(){if(window.PDFLib)return Promise.resolve(window.PDFLib);if(!libPromise)libPromise=new Promise((resolve,reject)=>{const sc=document.createElement('script');sc.src='js/vendor/pdf-lib.min.js';sc.onload=()=>window.PDFLib?resolve(window.PDFLib):reject(Error('Biblioteca PDF indisponível.'));sc.onerror=()=>{libPromise=null;sc.remove();reject(Error('Não foi possível carregar a biblioteca PDF. Tente novamente.'));};document.head.appendChild(sc);});return libPromise;}
async function fotoBase64(path){const r=await sb().storage.from('uniforme-assinaturas').createSignedUrl(path,300);if(r.error||!r.data?.signedUrl)throw Error('Não foi possível acessar uma assinatura. Nenhum PDF incompleto foi gerado.');const response=await fetch(r.data.signedUrl);if(!response.ok)throw Error('Uma assinatura está indisponível. Confira o armazenamento.');const blob=await response.blob();return new Promise((ok,no)=>{const reader=new FileReader();reader.onload=()=>ok(reader.result);reader.onerror=no;reader.readAsDataURL(blob);});}
async function pdf(alvos,mes,aoProgresso){
const lib=await carregarPdf(),doc=await lib.PDFDocument.create(),regular=await doc.embedFont(lib.StandardFonts.Helvetica),bold=await doc.embedFont(lib.StandardFonts.HelveticaBold);let page,y,g,font=regular;
const cor=(r,g,b)=>lib.rgb(r/255,g/255,b/255);
const limpar=t=>String(t??'').replace(/[^\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D]/g,' ');
function linha(t,x,top,size=10,c=cor(30,30,30),f=font){page.drawText(limpar(t),{x,y:841.89-top,size,font:f,color:c});}
function header(titulo){page=doc.addPage([595.28,841.89]);page.drawRectangle({x:0,y:773.89,width:595.28,height:68,color:cor(21,19,15)});linha('IMPERIUM',40,43,19,cor(215,178,71),bold);linha(titulo,40,99,16);y=121;texto('Cliente: '+g.cliente);texto('Posto: '+g.posto);texto('Competência: '+mes);y+=10;}
function wrap(t){const linhas=[];let atual='';for(const palavra of limpar(t).split(/\s+/)){const candidata=atual?atual+' '+palavra:palavra;if(font.widthOfTextAtSize(candidata,10)>515&&atual){linhas.push(atual);atual=palavra;}else atual=candidata;while(font.widthOfTextAtSize(atual,10)>515){let corte=atual.length;while(corte>1&&font.widthOfTextAtSize(atual.slice(0,corte),10)>515)corte--;linhas.push(atual.slice(0,corte));atual=atual.slice(corte);}}if(atual)linhas.push(atual);return linhas;}
function texto(t){for(const l of wrap(t)){if(y>770)header('Resumo mensal — continuação');linha(l,40,y);y+=14;}}
for(const grupo of (Array.isArray(alvos)?alvos:[alvos])){g=grupo;if(aoProgresso)aoProgresso(g);
header('Recebimentos de uniforme e EPI');texto(g.registros.length+' recebimento(s) · '+g.pecas+' peça(s)');if(!g.registros.length)texto('Não houve recebimentos confirmados neste posto no mês selecionado.');y+=12;
for(const r of g.registros){if(y>680)header('Resumo mensal — continuação');font=bold;texto(r.nome+' — '+fmt(r.criado_em));font=regular;for(const i of r.itens)texto(i.quantidade+' × '+i.nome+' | '+i.categoria+(i.tamanho?' | tamanho '+i.tamanho:''));texto('Registro: '+r.id);y+=12;}
for(const r of g.registros){let image=await fotoBase64(r.foto_path);header('Comprovação do recebimento');texto('Colaborador: '+r.nome);texto('Cargo: '+r.cargo);texto('Confirmação no servidor: '+fmt(r.criado_em));texto('Registro: '+r.id);texto('Pedido: '+r.pedido_id);texto('Método: '+(r.metodo==='arquivo'?'Foto enviada pelo aparelho':'Captura por câmera'));y+=10;
if(!/^data:image\/(jpeg|png);/i.test(image)){const img=new Image();img.src=image;await img.decode();const cv=document.createElement('canvas');cv.width=img.naturalWidth;cv.height=img.naturalHeight;cv.getContext('2d').drawImage(img,0,0);image=cv.toDataURL('image/jpeg',.92);}
const emb=image.startsWith('data:image/png')?await doc.embedPng(image):await doc.embedJpg(image);const w=Math.min(515,(765-y)*emb.width/emb.height),h=w*emb.height/emb.width;page.drawImage(emb,{x:40,y:841.89-y-h,width:w,height:h});}
}
const pages=doc.getPages();pages.forEach((p,i)=>{page=p;page.drawLine({start:{x:40,y:37},end:{x:555,y:37},thickness:1,color:cor(215,178,71)});linha('Imperium · CNPJ 62.249.653/0001-66 · '+mes,40,820,8,cor(90,90,90));linha((i+1)+'/'+pages.length,532,820,8,cor(90,90,90));});return new Blob([await doc.save()],{type:'application/pdf'});
}
async function click(s,e){const b=e.target.closest('button');if(!b)return;try{
if(b.dataset.aba){mudarAba(s,b.dataset.aba,true);return;}
if(b.dataset.novo||b.dataset.editar)formCadastro(s,b.dataset.novo||b.dataset.editar,b.dataset.id);
if(b.hasAttribute('data-fechar'))b.closest('[data-form]').innerHTML='';
if(b.hasAttribute('data-consultar')){await carregar(s);alerta(s,'Mês atualizado.');}
if(b.dataset.pdf)await exportarPdf(s,b,b.dataset.pdf);
}catch(err){alerta(s,err.message,true);}}
async function submit(s,e){const f=e.target;if(!f.matches('form'))return;e.preventDefault();const x=Object.fromEntries(new FormData(f)),b=f.querySelector('[type=submit]');b.disabled=true;try{if(f.hasAttribute('data-exportar')){if(x.tipo_pdf==='posto'&&!x.posto_pdf)throw Error('Selecione um posto.');await exportarPdf(s,b,x.tipo_pdf==='posto'?x.posto_pdf:null);return;}if(f.hasAttribute('data-cadastro')){x.ativo=x.ativo==='true';await rpc('operacao_salvar',{p_tipo:f.dataset.tipo,p_id:f.dataset.id||null,p_dados:x});f.closest('[data-form]').innerHTML='';}if(f.hasAttribute('data-alocar'))await rpc('operacao_alocar',{p_usuario:x.usuario,p_posto:x.posto,p_inicio:x.inicio});if(f.hasAttribute('data-associar'))await rpc('uniforme_associar_antigo',{p_recebimento:f.dataset.id,p_posto:x.posto,p_motivo:x.motivo});await carregar(s);alerta(s,'Cadastro salvo.');}catch(err){alerta(s,err.message,true);}finally{if(b.isConnected)b.disabled=false;if(f.hasAttribute('data-exportar'))atualizarExportacao(s);}}
async function mount(el,tipo){const s={el,tipo,aba:'clientes'};atual=s;el.innerHTML=`<div class="op"><h1>${tipo==='clientes'?'Clientes e postos':'Resumo mensal de uniformes e EPI'}</h1><p>${tipo==='clientes'?'Organize clientes, postos e a alocação dos colaboradores.':'Exporte um resumo geral ou por posto, com os comprovantes de recebimento.'}</p><p data-msg class="op-msg" role="status" aria-live="polite"></p>${tipo!=='clientes'?`<section class="op-card op-form"><label>Competência<input name="mes" type="month" value="${meses()}"></label><button class="btn" data-consultar>Consultar mês</button></section>`:''}${tipo==='clientes'?`<div class="op-abas" role="tablist" aria-label="Categorias de clientes e postos"><button type="button" role="tab" id="opAba-clientes" data-aba="clientes" aria-controls="opPainel-clientes" aria-selected="true" class="on">Clientes <span data-conta-clientes>0</span></button><button type="button" role="tab" id="opAba-postos" data-aba="postos" aria-controls="opPainel-postos" aria-selected="false" tabindex="-1">Postos <span data-conta-postos>0</span></button></div>`:'<div data-categorias-nav></div>'}<div data-conteudo>Carregando…</div></div>`;s.click=e=>click(s,e);s.submit=e=>submit(s,e);s.change=e=>{if(e.target.matches('[name=tipo_pdf]'))atualizarExportacao(s);};s.keydown=e=>{if(!e.target.matches('.op-abas [role=tab]')||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();mudarAba(s,e.key==='Home'?'clientes':e.key==='End'?'postos':s.aba==='clientes'?'postos':'clientes',true);};el.addEventListener('keydown',s.keydown);el.addEventListener('change',s.change);el.addEventListener('click',s.click);el.addEventListener('submit',s.submit);try{await carregar(s);}catch(err){alerta(s,'Confira a instalação do módulo e suas permissões. '+err.message,true);}}
function unmount(){atual?.categorias?.destruir();if(atual){atual.el.removeEventListener('keydown',atual.keydown);atual.el.removeEventListener('click',atual.click);atual.el.removeEventListener('submit',atual.submit);atual.el.removeEventListener('change',atual.change);}atual=null;}
Platform.register({id:'clientes',categoria:'operacao',nome:'Clientes e postos',menu:'Clientes e postos',descricao:'Cadastre clientes, postos e alocações da equipe.',icone:'<path d="M3 21V3h12v18M15 9h6v12M7 7h4M7 11h4M7 15h4M2 21h20"/>',mount:el=>mount(el,'clientes'),unmount});
Platform.register({id:'uniforme_relatorios',categoria:'operacao',nome:'Resumo mensal de uniformes e EPI',menu:'Resumo mensal',descricao:'Gere documentos com os recebimentos e assinaturas por posto.',icone:'<path d="M6 3h9l3 3v15H6zM9 10h6M9 14h6M9 18h3"/>',mount:el=>mount(el,'relatorios'),unmount});
})();
