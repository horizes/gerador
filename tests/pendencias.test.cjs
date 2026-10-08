/* Execute: node --test tests/pendencias.test.cjs. Consultas do Supabase simuladas. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/modules/pendencias.js'),'utf8');
const dados=fs.readFileSync(path.join(__dirname,'../js/dados.js'),'utf8');
const hoje='2026-10-08T12:00:00Z';
function app({admin=false,modulos=[],id='eu',tables={},rpcs={}}={}){
 const logs=[],badges=[],falhas=new Set(),falhasRpc=new Set();let gate=null;
 const bases={
  uniforme_pedidos:[{id:'u-1',solicitante_id:'outro',solicitante_nome:'Ana',status:'pendente',criado_em:hoje},
   {id:'u-2',solicitante_id:'eu',solicitante_nome:'Eu',status:'pronto',criado_em:hoje},
   {id:'u-3',solicitante_id:'outro',solicitante_nome:'Bruno',status:'parcial',criado_em:hoje},
   {id:'u-4',solicitante_id:'eu',solicitante_nome:'Eu',status:'pendente',criado_em:hoje},
   {id:'u-5',solicitante_id:'eu',status:'concluido',criado_em:hoje}],
  ponto_solicitacoes:[{id:'s-1',usuario_id:'outro',vinculo_id:'v-1',tipo:'incluir',motivo:'Horário esquecido',criado_em:hoje},
   {id:'s-2',usuario_id:'eu',vinculo_id:'v-2',tipo:'desconsiderar',motivo:'Batida duplicada',criado_em:hoje},
   {id:'s-3',usuario_id:'eu',vinculo_id:'v-2',tipo:'incluir',motivo:'Pedido já analisado',criado_em:hoje}],
  ponto_decisoes:[{id:'d-1',solicitacao_id:'s-3'}],
  ponto_vinculos:[{id:'v-1',usuario_id:'outro',nome:'Ana',criado_em:hoje},{id:'v-2',usuario_id:'eu',nome:'Eu',criado_em:hoje}],
  convites_pendentes:[{token:'c-1',nome:'Pessoa convidada',criado_em:hoje,usado_em:null},
   {token:'c-2',nome:'Convite antigo',criado_em:'2026-09-01T12:00:00Z',usado_em:null},
   {token:'c-3',nome:'Já usado',criado_em:hoje,usado_em:hoje}],
  fluxo_lancamentos:[{id:'f-1',tipo:'saida',data:'2026-10-01',categoria:'Fornecedores',descricao:'Compra',valor:'150.00',status:'pendente'},
   {id:'f-2',tipo:'entrada',data:'2026-10-09',categoria:'Serviços',descricao:'Contrato',valor:'2000',status:'pendente'},
   {id:'f-3',tipo:'saida',data:'2026-10-01',valor:'50',status:'pago'}],...tables
 };
 const rpcData={admin_listar_perfis:[{id:'a-1',ativo:true,nome:'Senha pendente',email:'senha@exemplo.com',email_confirmado_em:hoje,criado_em:hoje},
  {id:'a-2',ativo:true,nome:'E-mail pendente',email:'email@exemplo.com',email_confirmado_em:null,criado_em:hoje},
  {id:'a-3',ativo:false,nome:'Bloqueado',email_confirmado_em:null,criado_em:hoje},
  {id:'eu',ativo:true,nome:'Eu',email_confirmado_em:hoje,criado_em:hoje}],
  admin_listar_estado_senha:[{id:'a-1',senha_definida:false},{id:'a-2',senha_definida:false},{id:'eu',senha_definida:true}],...rpcs};
 function query(table){let filters=[],range=null;const q={
  select(){return q},order(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,values){filters.push(r=>values.includes(r[k]));return q},
  is(k,v){filters.push(r=>r[k]===v);return q},range(a,b){range=[a,b];return q},
  then(resolve,reject){return (async()=>{
   logs.push({table,range});if(gate?.table===table){const g=gate;gate=null;await g.promise;}
   if(falhas.has(table))throw Error('Falha de consulta');
   if(!bases[table])throw Error('Tabela inesperada: '+table);
   let rows=bases[table].filter(r=>filters.every(f=>f(r)));if(range)rows=rows.slice(range[0],range[1]+1);
   return {data:JSON.parse(JSON.stringify(rows)),error:null};
  })().then(resolve,reject)}
 };return q;}
 function perfil(opts={}){const liberados=new Set(opts.modulos||modulos);return {id:opts.id||id,admin:opts.admin??admin,podeVer(m){return liberados.has(m);}};}
 const window={Imperium:{perfil:perfil(),supabase:{from:query,async rpc(name){logs.push({rpc:name});return falhasRpc.has(name)?{error:{message:'RPC indisponível'}}:{data:rpcData[name],error:null};}}},
  Platform:{register(m){window.module=m},setBadge(id,n){badges.push({id,n})},parametrosRota(){return new URLSearchParams()}}};
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[hoje]));}static now(){return new Date(hoje).getTime();}}
 const context=vm.createContext({window,URLSearchParams,Date:FixedDate,document:{hidden:false,addEventListener(){}},setInterval(){}});
 vm.runInContext(dados,context);vm.runInContext(source,context);
 return {api:window.ImperiumPendencias,logs,badges,tables:bases,rpcs:rpcData,falhas,falhasRpc,
  perfil(opts){window.Imperium.perfil=perfil(opts)},pause(table){let release;gate={table,promise:new Promise(r=>release=r)};return release;},module:window.module};
}
const ids=a=>a.api.estado().itens.map(i=>i.id).join(',');
test('sem ferramentas liberadas não consulta dados de outros módulos',async()=>{
 const a=app();await a.api.atualizar();assert.equal(a.logs.length,0);assert.equal(a.api.estado().itens.length,0);assert.equal(a.api.htmlHome(),'');assert.equal(a.module.configuravel,false);assert.equal(a.module.sempreVisivel,true);
});
test('colaborador vê apenas seus pedidos e seus ajustes ainda sem decisão',async()=>{
 const a=app({modulos:['uniforme_solicitar','ponto_meu']});await a.api.atualizar();
 assert.match(ids(a),/uniforme:u-2/);assert.match(ids(a),/uniforme:u-4/);assert.match(ids(a),/ponto:s-2/);
 assert.doesNotMatch(ids(a),/u-1|u-3|u-5|s-1|s-3/);assert.equal(a.logs.some(l=>l.rpc||l.table==='convites_pendentes'||l.table==='fluxo_lancamentos'),false);
 assert.equal(a.api.estado().itens.find(i=>i.id==='ponto:s-2').situacao,'aguardando');assert.equal(a.badges.at(-1).n,1);
});
test('gestão de uniformes inclui atendimento e acompanhamento de entrega sem duplicar pedido próprio',async()=>{
 const a=app({modulos:['uniforme_gestao','uniforme_solicitar']});await a.api.atualizar();
 assert.equal(a.api.estado().itens.length,4);assert.equal(a.api.estado().itens.filter(i=>i.id==='uniforme:u-2').length,1);
 assert.equal(a.api.estado().itens.find(i=>i.id==='uniforme:u-2').acao,'Confirmar recebimento');
 assert.equal(a.api.estado().itens.find(i=>i.id==='uniforme:u-3').situacao,'aguardando');
});
test('gestor de ponto não recebe solicitações que já foram decididas',async()=>{
 const a=app({modulos:['ponto_gestao']});await a.api.atualizar();assert.equal(a.api.estado().itens.length,2);assert.doesNotMatch(ids(a),/s-3/);
 assert.equal(a.api.estado().itens.every(i=>i.situacao==='acao'&&i.href.startsWith('#/ponto_gestao?')),true);
});
test('admin vê convites não usados, convites expirados e cadastros ativos incompletos',async()=>{
 const a=app({admin:true});await a.api.atualizar();assert.match(ids(a),/convite:c-1/);assert.match(ids(a),/convite:c-2/);assert.doesNotMatch(ids(a),/convite:c-3|cadastro:a-3|cadastro:eu/);
 const itens=a.api.estado().itens;assert.equal(itens.find(i=>i.id==='convite:c-2').situacao,'acao');assert.equal(itens.find(i=>i.id==='convite:c-1').situacao,'aguardando');
 assert.equal(itens.filter(i=>i.id.startsWith('cadastro:')).length,2);assert.equal(itens.filter(i=>i.id.startsWith('convite:')).every(i=>!i.href.includes('token')&&!i.href.includes('c-1')),true);
});
test('financeiro mostra somente lançamentos pendentes, sem inferir vencimento pela data',async()=>{
 const a=app({modulos:['fluxo']});await a.api.atualizar();assert.equal(a.api.estado().itens.length,2);assert.equal(a.api.estado().itens.find(i=>i.id==='financeiro:f-1').valor,150);
 assert.equal(a.api.estado().itens.every(i=>i.dataRotulo==='Data do lançamento'&&!i.titulo.includes('atrasado')),true);
 assert.equal(a.logs.every(l=>l.table==='fluxo_lancamentos'),true);
});
test('lê mais de uma página e não perde pendências acima de 500 registros',async()=>{
 const rows=Array.from({length:507},(_,i)=>({id:'f-'+i,tipo:'saida',data:'2026-10-01',status:'pendente',valor:1}));
 const a=app({modulos:['fluxo'],tables:{fluxo_lancamentos:rows}});await a.api.atualizar();assert.equal(a.api.estado().itens.length,507);assert.equal(a.logs.length,3);
});
test('falha em uma fonte mantém as outras e não afirma que tudo está em dia',async()=>{
 const a=app({modulos:['fluxo','ponto_gestao']});a.falhas.add('ponto_decisoes');await a.api.atualizar();assert.equal(a.api.estado().itens.length,2);assert.equal(a.api.estado().falhas.join(','),'Ajustes de ponto');assert.match(a.api.htmlHome(),/não puderam ser consultadas/);
 a.tables.fluxo_lancamentos=[];await a.api.atualizar();assert.equal(a.api.estado().itens.length,0);assert.match(a.api.htmlHome(),/não puderam ser consultadas/);
});
test('estado desconhecido de senha é erro de consulta e não cadastro concluído',async()=>{
 const a=app({admin:true});a.rpcs.admin_listar_estado_senha=[];await a.api.atualizar();assert.match(a.api.estado().falhas.join(','),/Cadastros incompletos/);assert.match(ids(a),/convite:c-1/);
});
test('itens resolvidos desaparecem na consulta seguinte e o contador é atualizado',async()=>{
 const a=app({modulos:['fluxo']});await a.api.atualizar();assert.equal(a.badges.at(-1).n,2);a.tables.fluxo_lancamentos.forEach(r=>r.status='pago');await a.api.atualizar();assert.equal(a.api.estado().itens.length,0);assert.equal(a.badges.at(-1).n,0);assert.equal(a.api.htmlHome(),'');
});
test('erro transitório pode ser consultado novamente sem bloquear a central',async()=>{
 const a=app({modulos:['fluxo']});a.falhas.add('fluxo_lancamentos');await a.api.atualizar();assert.equal(a.api.estado().falhas.length,1);a.falhas.clear();await a.api.atualizar();assert.equal(a.api.estado().falhas.length,0);assert.equal(a.api.estado().itens.length,2);
});
test('consultas simultâneas compartilham a mesma leitura em andamento',async()=>{
 const a=app({modulos:['fluxo']});const release=a.pause('fluxo_lancamentos');const primeiro=a.api.atualizar();const segundo=a.api.atualizar();release();await Promise.all([primeiro,segundo]);assert.equal(a.logs.length,2);
});
test('resposta antiga não reaparece depois de trocar de usuário ou revogar acesso',async()=>{
 const a=app({modulos:['fluxo']});const release=a.pause('fluxo_lancamentos');const antiga=a.api.atualizar();a.perfil({id:'novo',modulos:[]});assert.equal(a.api.estado().itens.length,0);assert.equal(a.api.htmlHome(),'');await a.api.atualizar();release();await antiga;assert.equal(a.api.estado().itens.length,0);assert.equal(a.api.estado().categorias.length,0);
});
test('retirar uma permissão limpa os dados antigos e não consulta a fonte removida',async()=>{
 const a=app({admin:true});await a.api.atualizar();a.logs.length=0;a.perfil({admin:false,modulos:['ponto_meu']});await a.api.atualizar();assert.equal(a.api.estado().categorias.join(','),'ponto');assert.equal(a.logs.some(l=>l.rpc||l.table==='fluxo_lancamentos'||l.table==='convites_pendentes'),false);
});
