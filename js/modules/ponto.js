/* Ponto em homologação: não substitui um REP-P regularizado. */
(function(){
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sb=()=>window.Imperium.supabase;
const fmt=s=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'medium'}).format(new Date(s));
const ico='<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
let raiz=null,timer=null,navegacao=null,gerencia=false,dados=null,requisicao=null,requisicaoUsuario=null,epoca=0,referencia=0,sincronizado=0,versao=0;
async function rpc(nome,args){const r=await sb().rpc(nome,args);if(r.error)throw new Error(r.error.message);return r.data;}
function aviso(texto,erro=false){if(!raiz)return;const el=raiz.querySelector('[data-aviso]');el.textContent=texto;el.className='pt-aviso'+(erro?' erro':'');}
function baixar(nome,conteudo,tipo='application/json'){const url=URL.createObjectURL(new Blob([conteudo],{type:tipo}));const a=document.createElement('a');a.href=url;a.download=nome;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function comprovante(b){return {ambiente:'HOMOLOGAÇÃO — SEM VALIDADE COMO COMPROVANTE REP-P',empregador_cnpj:'62249653000166',sistema:'Imperium Ponto',registro:b.id,numero_interno:b.numero,colaborador:b.nome,cpf:b.cpf,matricula:b.matricula,instante:b.instante,recebido_em:b.recebido_em,hash_interno:b.hash,hash_anterior:b.hash_anterior,assinatura_icp_brasil:null};}
function tratamento(batidas,solicitacoes,decisoes){
 const aprovadas=new Set(decisoes.filter(d=>d.resultado==='aprovado').map(d=>d.solicitacao_id));
 const excluidas=new Set(solicitacoes.filter(s=>aprovadas.has(s.id)&&s.tipo==='desconsiderar').map(s=>s.batida_id));
 const eventos=batidas.filter(b=>!excluidas.has(b.id)).map(b=>({id:b.id,instante:b.instante,origem:'Original',natureza:'',motivo:''}));
 for(const s of solicitacoes)if(aprovadas.has(s.id)&&s.tipo==='incluir')eventos.push({id:s.id,instante:s.instante,origem:'Inclusão aprovada',natureza:s.natureza,motivo:s.motivo});
 return eventos.sort((a,b)=>new Date(a.instante)-new Date(b.instante));
}
window.ImperiumPonto={tratamento,comprovante};
function linhasBatidas(){return dados.batidas.map(b=>`<tr><td>${esc(b.nome)}<small>${esc(b.matricula)}</small></td><td>${esc(fmt(b.instante))}</td><td>#${esc(b.numero)}</td><td><button data-recibo="${esc(b.id)}">Registro</button>${!gerencia?` <button data-ajuste="${esc(b.id)}">Pedir ajuste</button>`:''}</td></tr>`).join('')||'<tr><td colspan="4">Nenhuma batida no período selecionado.</td></tr>';}
function linhasSolicitacoes(){return dados.solicitacoes.map(s=>{
 const d=dados.decisoes.find(x=>x.solicitacao_id===s.id),v=dados.vinculos.find(x=>x.id===s.vinculo_id),b=dados.batidas.find(x=>x.id===s.batida_id);
 return `<tr data-solicitacao="${esc(s.id)}"><td>${esc(v?.nome||'Colaborador')}<small>${esc(s.tipo==='incluir'?'Inclusão '+s.natureza:'Desconsideração')} · ${esc(fmt(s.criado_em))}</small></td><td>${esc(s.instante?fmt(s.instante):b?fmt(b.instante):s.batida_id)}<small>${esc(s.motivo)}</small></td><td>${d?`${esc(d.resultado)}<small>${esc(d.motivo)}</small>`:gerencia?`<button data-decidir="${esc(s.id)}" data-resultado="aprovado">Aprovar</button> <button data-decidir="${esc(s.id)}" data-resultado="negado">Negar</button>`:'Aguardando análise'}</td></tr>`;
}).join('')||'<tr><td colspan="3">Nenhum pedido de ajuste.</td></tr>';}
function tabela(titulos,linhas){return `<div class="pt-tabela"><table><thead><tr>${titulos.map(t=>`<th>${t}</th>`).join('')}</tr></thead><tbody>${linhas}</tbody></table></div>`;}
async function carregar(){
 const atual=++versao;
 const inicio=raiz.querySelector('[name=inicio]').value,fim=raiz.querySelector('[name=fim]').value;
 if(!inicio||!fim||inicio>fim)throw new Error('Informe um período válido.');
 const fimDate=new Date(fim+'T00:00:00-03:00');fimDate.setUTCDate(fimDate.getUTCDate()+1);
 const todas=window.Imperium.lerTodas;
 const [vinculos,batidas,solicitacoes,decisoes,colaboradores]=await Promise.all([
 todas(()=>sb().from('ponto_vinculos').select('*').order('criado_em')),
 todas(()=>sb().from('ponto_batidas').select('*').gte('instante',inicio+'T00:00:00-03:00').lt('instante',fimDate.toISOString()).order('numero',{ascending:false})),
 todas(()=>sb().from('ponto_solicitacoes').select('*').order('criado_em',{ascending:false})),
 todas(()=>sb().from('ponto_decisoes').select('*').order('criado_em',{ascending:false})),
 gerencia?rpc('ponto_colaboradores'):Promise.resolve([])]);
 if(!raiz||atual!==versao)return;
 dados={vinculos,batidas,solicitacoes,decisoes};
 if(gerencia){const sel=raiz.querySelector('[name=usuario]'),antes=sel.value;sel.innerHTML='<option value="">Selecione o colaborador</option>'+colaboradores.map(c=>`<option value="${esc(c.id)}">${esc(c.nome||c.id)}</option>`).join('');sel.value=antes;}
 const inicioPeriodo=new Date(inicio+'T00:00:00-03:00'),fimPeriodo=fimDate;
 const tratados=vinculos.flatMap(v=>tratamento(batidas.filter(b=>b.vinculo_id===v.id),solicitacoes.filter(s=>s.vinculo_id===v.id),decisoes).filter(t=>new Date(t.instante)>=inicioPeriodo&&new Date(t.instante)<fimPeriodo).map(t=>({...t,nome:v.nome})));
 tratados.sort((a,b)=>new Date(b.instante)-new Date(a.instante));
 raiz.querySelector('[data-tratados]').innerHTML=tabela(['Colaborador','Horário de Brasília','Origem / justificativa'],tratados.map(t=>`<tr><td>${esc(t.nome)}</td><td>${esc(fmt(t.instante))}${t.natureza?' · '+esc(t.natureza==='E'?'Entrada':'Saída'):''}</td><td>${esc(t.origem)}<small>${esc(t.motivo)}</small></td></tr>`).join('')||'<tr><td colspan="3">Nenhum registro tratado no período.</td></tr>');
 raiz.querySelector('[data-batidas]').innerHTML=tabela(['Colaborador','Horário de Brasília','Nº interno','Ações'],linhasBatidas());
 raiz.querySelector('[data-solicitacoes]').innerHTML=tabela(['Pedido','Horário / justificativa','Situação'],linhasSolicitacoes());
 const meu=vinculos.find(v=>v.usuario_id===window.Imperium.perfil.id&&v.ativo);
 const vinc=raiz.querySelector('[data-vinculo]');if(vinc)vinc.textContent=meu?`${meu.nome} · ${meu.escala}${meu.horarios?' · '+meu.horarios:''}`:'Seu vínculo ainda não foi cadastrado pela gestão.';
 const btn=raiz.querySelector('[data-bater]');if(btn)btn.disabled=!meu;
 if(gerencia)raiz.querySelector('[data-vinculos]').innerHTML=tabela(['Colaborador','Matrícula / escala','Horários / convenção'],vinculos.map(v=>`<tr><td>${esc(v.nome)}</td><td>${esc(v.matricula)} · ${esc(v.escala)}</td><td>${esc(v.horarios||'Não informados')}<small>${esc(v.convencao||'Convenção não informada')}</small></td></tr>`).join('')||'<tr><td colspan="3">Cadastre os vínculos para iniciar os testes.</td></tr>');
 navegacao?.contagem('batidas',batidas.length);navegacao?.contagem('ajustes',solicitacoes.length);navegacao?.contagem('tratados',tratados.length);if(gerencia)navegacao?.contagem('vinculos',vinculos.length);
}
async function sincronizar(){const inicio=performance.now();const t=await rpc('ponto_agora');if(!raiz)return;epoca=new Date(t).getTime();referencia=(inicio+performance.now())/2;sincronizado=performance.now();}
function relogio(){if(!raiz)return;const el=raiz.querySelector('[data-relogio]');if(el)el.textContent=epoca?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',timeStyle:'medium'}).format(new Date(epoca+performance.now()-referencia)):'Sincronizando…';}
function abrirFormulario(html){navegacao?.ativar('ajustes');raiz.querySelector('[data-formulario]').innerHTML=html;raiz.querySelector('[data-formulario] input, [data-formulario] textarea')?.focus();}
async function click(e){const b=e.target.closest('button');if(!b||!raiz)return;
 try{
 if(b.hasAttribute('data-filtrar')){await carregar();aviso('Período atualizado.');}
 if(b.hasAttribute('data-bater')){
 b.disabled=true;aviso('Enviando a batida ao servidor…');
 const usuario=window.Imperium.perfil.id;if(requisicaoUsuario!==usuario){requisicao=null;requisicaoUsuario=usuario;}
 requisicao=requisicao||crypto.randomUUID();
 try {const resposta=await rpc('ponto_registrar',{p_requisicao:requisicao});const batida=Array.isArray(resposta)?resposta[0]:resposta;if(!batida?.id||!batida?.instante)throw new Error('Servidor não devolveu um registro confirmado.');requisicao=null;aviso('Batida de teste registrada às '+fmt(batida.instante)+'.');baixar('registro-teste-'+batida.numero+'.json',JSON.stringify(comprovante(batida),null,2));}
 catch(err){aviso('A confirmação não chegou. Tente novamente: o reenvio usa o mesmo identificador para evitar duplicação. '+err.message,true);}
 finally{b.disabled=false;}
 await carregar();
 }
 if(b.dataset.recibo){const registro=dados.batidas.find(x=>x.id===b.dataset.recibo);baixar('registro-teste-'+registro.numero+'.json',JSON.stringify(comprovante(registro),null,2));}
 if(b.hasAttribute('data-incluir')||b.dataset.ajuste){abrirFormulario(`<form data-pedido><h3>${b.dataset.ajuste?'Desconsiderar batida':'Incluir horário esquecido'}</h3><input type="hidden" name="batida" value="${esc(b.dataset.ajuste||'')}">${!b.dataset.ajuste?'<label>Horário de Brasília<input name="instante" type="datetime-local" required></label><label>Natureza<select name="natureza"><option value="E">Entrada</option><option value="S">Saída</option></select></label>':''}<label>Justificativa<textarea name="motivo" minlength="10" maxlength="150" required></textarea></label><button type="submit">Enviar para análise</button> <button type="button" data-fechar>Cancelar</button></form>`);}
 if(b.dataset.decidir){abrirFormulario(`<form data-decisao><h3>${b.dataset.resultado==='aprovado'?'Aprovar':'Negar'} pedido</h3><input type="hidden" name="solicitacao" value="${esc(b.dataset.decidir)}"><input type="hidden" name="resultado" value="${esc(b.dataset.resultado)}"><label>Justificativa da decisão<textarea name="motivo" minlength="10" maxlength="150" required></textarea></label><button type="submit">Confirmar decisão</button> <button type="button" data-fechar>Cancelar</button></form>`);}
 if(b.hasAttribute('data-fechar'))abrirFormulario('');
 if(b.hasAttribute('data-exportar')){
 const pacote={ambiente:'HOMOLOGAÇÃO',nao_e_afd_aej:true,gerado_em:await rpc('ponto_agora'),periodo:{inicio:raiz.querySelector('[name=inicio]').value,fim:raiz.querySelector('[name=fim]').value},...dados};
 baixar('ponto-homologacao.json',JSON.stringify(pacote,null,2));aviso('Exportação interna. Este arquivo não é AFD nem AEJ.');
 }
 }catch(err){aviso(err.message,true);}
}
async function submit(e){const f=e.target;if(!f.matches('form'))return;e.preventDefault();const btn=f.querySelector('[type=submit]');btn.disabled=true;const x=Object.fromEntries(new FormData(f));
 try{
 if(f.hasAttribute('data-pedido'))await rpc('ponto_solicitar',{p_tipo:x.batida?'desconsiderar':'incluir',p_batida:x.batida||null,p_instante:x.batida?null:new Date(x.instante+':00-03:00').toISOString(),p_natureza:x.batida?null:x.natureza,p_motivo:x.motivo});
 if(f.hasAttribute('data-decisao'))await rpc('ponto_decidir',{p_solicitacao:x.solicitacao,p_resultado:x.resultado,p_motivo:x.motivo});
 if(f.hasAttribute('data-cadastro'))await rpc('ponto_cadastrar_vinculo',{p_usuario:x.usuario,p_nome:x.nome,p_cpf:x.cpf,p_matricula:x.matricula,p_escala:x.escala,p_horarios:x.horarios,p_convencao:x.convencao});
 if(!f.hasAttribute('data-cadastro'))abrirFormulario('');else f.reset();
 await carregar();aviso('Operação registrada. As batidas originais foram preservadas.');
 }catch(err){aviso(err.message,true);}finally{if(btn.isConnected)btn.disabled=false;}
}
async function mount(el,gestao){unmount();raiz=el;gerencia=gestao;
 const hoje=window.Imperium.hojeLocal(),rota=window.Platform.parametrosRota?.()||new URLSearchParams();
 el.innerHTML=`<div class="pt"><header><h1>${gestao?'Gestão de ponto':'Meu ponto'}</h1><p>Registro da jornada e ajustes com histórico.</p></header><div class="pt-alerta"><strong>Homologação — uso oficial bloqueado</strong><p>CNPJ 62.249.653/0001-66. Continue utilizando seu ponto oficial. Faltam o registro no INPI, as assinaturas ICP-Brasil e a validação técnica do REP-P.</p></div><p class="pt-aviso" data-aviso role="status" aria-live="polite"></p><div data-categorias-nav></div>
 ${!gestao?'<section class="pt-card" data-categoria-painel="registrar"><div data-relogio class="pt-relogio">Sincronizando…</div><small>Horário do servidor · Brasília</small><p data-vinculo></p><button class="pt-principal" data-bater disabled>Registrar batida de teste</button><p>A confirmação só aparece após o servidor salvar. Nenhuma batida é bloqueada pela escala ou pelo horário.</p></section>':''}
 <section class="pt-card" data-visivel-em="batidas ajustes tratados" hidden><div class="pt-filtros"><label>De<input type="date" name="inicio" value="${hoje.slice(0,8)}01"></label><label>Até<input type="date" name="fim" value="${hoje}"></label><button data-filtrar>Consultar</button><button data-exportar>Exportar histórico de teste</button>${!gestao?'<button data-incluir>Informar horário esquecido</button>':''}</div></section>
 <section class="pt-card" data-categoria-painel="batidas" hidden><h2>Batidas originais</h2><p>Horários recebidos pelo servidor. Ajustes não modificam esses registros.</p><div data-batidas></div></section><section class="pt-card" data-categoria-painel="ajustes" hidden><h2>Pedidos de ajuste</h2><div data-solicitacoes></div><div data-formulario></div></section><section class="pt-card" data-categoria-painel="tratados" hidden><h2>Registros após os ajustes</h2><p>Inclusões aprovadas e batidas originais que não foram desconsideradas. Não é um espelho regulamentar nem um cálculo de folha.</p><div data-tratados></div></section>
 ${gestao?'<section class="pt-card" data-categoria-painel="vinculos" hidden><h2>Vínculos e jornadas</h2><div data-vinculos></div><details><summary>Cadastrar vínculo para testes</summary><form data-cadastro class="pt-form"><label>Colaborador<select name="usuario" required><option value="">Carregando…</option></select></label><label>Nome completo<input name="nome" minlength="2" maxlength="150" required></label><label>CPF<input name="cpf" required maxlength="14"></label><label>Matrícula<input name="matricula" maxlength="30" required></label><label>Escala<select name="escala"><option>5x2</option><option>6x1</option><option>12x36</option><option>Outra</option></select></label><label>Horários contratados<input name="horarios" placeholder="Ex.: 08:00–12:00 / 13:00–17:00"></label><label>Sindicato / convenção coletiva<input name="convencao"></label><button type="submit">Cadastrar vínculo</button></form></details><p>Escalas encontradas nas propostas do projeto. Horários, sindicato e convenção precisam ser confirmados por vínculo. Adicionais e banco de horas não são calculados automaticamente.</p></section>':''}</div>`;
 navegacao=window.ImperiumCategorias.montar(el,{id:gestao?'ponto-gestao':'ponto-meu',rotulo:'Categorias de ponto',inicial:rota.get('categoria')||(gestao?'batidas':'registrar'),itens:[
 ...(!gestao?[{id:'registrar',nome:'Registrar ponto'}]:[]),{id:'batidas',nome:'Batidas'},{id:'ajustes',nome:'Ajustes'},{id:'tratados',nome:'Registros tratados'},...(gestao?[{id:'vinculos',nome:'Vínculos e jornadas'}]:[])
 ]});
 el.addEventListener('click',click);el.addEventListener('submit',submit);
 try{await Promise.all([carregar(),sincronizar()]);if(raiz!==el)return;window.Platform.destacarRegistro?.(el,'data-solicitacao',rota.get('pedido'));relogio();timer=setInterval(()=>{relogio();if(performance.now()-sincronizado>60000){sincronizado=performance.now();sincronizar().catch(()=>{});}},1000);}catch(err){aviso('Não foi possível carregar o ponto. Confira a instalação do SQL e suas permissões. '+err.message,true);}
}
function unmount(){navegacao?.destruir();navegacao=null;++versao;clearInterval(timer);timer=null;if(raiz){raiz.removeEventListener('click',click);raiz.removeEventListener('submit',submit);}raiz=null;dados=null;epoca=0;}
window.Platform.register({id:'ponto_meu',categoria:'rotina',menu:'Meu ponto',nome:'Meu ponto',descricao:'Registre batidas de teste e acompanhe seus pedidos de ajuste.',icone:ico,mount:el=>mount(el,false),unmount});
window.Platform.register({id:'ponto_gestao',categoria:'operacao',menu:'Gestão de ponto',nome:'Gestão de ponto',descricao:'Cadastre vínculos e analise ajustes preservando as batidas originais.',icone:ico,mount:el=>mount(el,true),unmount});
})();
