/* Execute: node --test tests/propostas-valores.test.cjs
   Executa o módulo real, sem banco, rede ou alterações em contas. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/modules/propostas.js'),'utf8');
function app(){
  const window={Imperium:{hojeLocal:()=>'2026-11-02'}};
  const hooks='window.__propostasTeste={estadoBase,extrairPadrao,estadoComPadrao,valorPosto,quantidadePessoas,totalCargo,totalServicos,totalEquipamentos,totalMensal,cargoCard,pgTabelas,pgAceite,docBody,atualizarFinais,ouvintes,setState(value){S=value;root=null;},setRoot(value){root=value;}};\n';
  vm.runInNewContext(source.replace('Platform.register({',hooks+'Platform.register({'),{window,document:{},Platform:{register(){}}});
  const api=window.__propostasTeste;
  const state=api.estadoBase();
  api.setState(state);
  return {api,state,cargo:state.cargos.aux};
}
function currency(text){return text.replace(/\u00a0/g,' ');}

test('valor fixo multiplica todas as pessoas, mesmo com um único posto',()=>{
  const {api,cargo}=app();
  Object.assign(cargo,{on:true,posto:5798.25,func:2,postos:1});
  assert.equal(api.valorPosto(cargo),5798.25);
  assert.equal(api.totalCargo(cargo),11596.50);
  assert.equal(api.totalServicos(),11596.50);
});
test('quantidade de postos descreve a operação sem repetir a cobrança por pessoa',()=>{
  const {api,cargo}=app();
  Object.assign(cargo,{on:true,posto:2500,func:4,postos:2});
  assert.equal(api.totalServicos(),10000);
  cargo.postos=8;
  assert.equal(api.totalServicos(),10000);
});
test('salário, adicionais e fator legado não mudam o preço fixo informado',()=>{
  const {api,state,cargo}=app();
  Object.assign(cargo,{on:true,posto:4200,func:3,insal:1200,acum:true,acumVal:800,salario:5000});
  state.salMin=2000;state.fator=9;
  assert.equal(api.valorPosto(cargo),4200);
  assert.equal(api.totalServicos(),12600);
});
test('3x por semana aparece selecionada nos cargos do catálogo e personalizados',()=>{
  const {api,state,cargo}=app();
  Object.assign(cargo,{on:true,posto:1800,func:2,escala:'3x por semana'});
  state.extras.push({...cargo,nome:'Cargo personalizado'});
  for(const [key,c] of [['aux',cargo],['x0',state.extras[0]]]){
    assert.match(api.cargoCard(key,c),/<option selected>3x por semana<\/option>/);
    assert.equal(api.totalCargo(c),3600);
  }
});
test('preferências preservam a escala 3x por semana e o preço fixo',()=>{
  const {api,state,cargo}=app();
  cargo.escala='3x por semana';cargo.posto=1950.35;state.fator=7;
  const saved=api.extrairPadrao(state);
  const restored=api.estadoComPadrao(saved);
  assert.equal(restored.cargos.aux.escala,'3x por semana');
  assert.equal(restored.cargos.aux.posto,1950.35);
  assert.equal(Object.hasOwn(saved,'fator'),false);
});
test('soma cargos ativos e personalizados usando o total de pessoas de cada serviço',()=>{
  const {api,state,cargo}=app();
  Object.assign(cargo,{on:true,posto:2000,func:2});
  Object.assign(state.cargos.port,{on:true,posto:3000,func:3,postos:2});
  Object.assign(state.cargos.jard,{on:false,posto:99999,func:30});
  state.extras.push({...cargo,posto:1250,func:2});
  assert.equal(api.totalServicos(),15500);
});
test('equipamentos somam sua quantidade própria, incluindo cortesia, uma vez por proposta',()=>{
  const {api,cargo}=app();
  Object.assign(cargo,{on:true,posto:1000,func:3,equipamentos:[
    {nome:'Equipamento pago',quantidade:2,valor:75,on:true},
    {nome:'Cortesia',quantidade:4,valor:0,on:true},
    {nome:'Desmarcado',quantidade:1,valor:999,on:false}
  ]});
  assert.equal(api.totalEquipamentos(),150);
  assert.equal(api.totalMensal(),3150);
});
test('valores monetários são arredondados por unidade e no total mensal',()=>{
  const {api,state,cargo}=app();
  Object.assign(cargo,{on:true,posto:0.10,func:3});
  Object.assign(state.cargos.port,{on:true,posto:0.20,func:1});
  assert.equal(api.totalServicos(),0.50);
  cargo.posto=19.995;cargo.func=2;state.cargos.port.on=false;
  assert.equal(api.totalServicos(),40);
});
test('valores e quantidades inválidas não produzem totais negativos ou infinitos',()=>{
  const {api,cargo}=app();
  for(const value of [-1,NaN,Infinity]){cargo.posto=value;assert.equal(api.valorPosto(cargo),0);}
  cargo.posto=100;
  for(const value of [-1,NaN,Infinity,'']){cargo.func=value;assert.equal(api.totalCargo(cargo),0);}
  cargo.func=2.9;assert.equal(api.quantidadePessoas(cargo),2);
});
test('prévia usada pelo PDF e aceite exibem escala, pessoas e o mesmo total fixo',()=>{
  const {api,cargo}=app();
  Object.assign(cargo,{on:true,posto:1234.56,func:3,postos:2,escala:'3x por semana',insal:900,acum:true,acumVal:700});
  const html=currency(api.pgTabelas()),aceite=currency(api.pgAceite());
  assert.match(html,/<th>Valor por pessoa<\/th>/);
  assert.match(html,/3x por semana/);
  assert.match(html,/>3<\/td>/);
  assert.match(html,/R\$ 1\.234,56/);
  assert.match(html,/R\$ 3\.703,68/);
  assert.match(aceite,/R\$ 3\.703,68/);
  assert.match(aceite,/3 pessoa\(s\), em 2 posto\(s\)/);
});
test('Word usa o mesmo preço fixo, total de pessoas e escala da prévia',()=>{
  const {api,cargo}=app();
  Object.assign(cargo,{on:true,posto:1234.56,func:3,postos:2,escala:'3x por semana',insal:900,acum:true,acumVal:700});
  const xml=currency(api.docBody());
  assert.match(xml,/Valor por pessoa/);
  assert.match(xml,/3x por semana/);
  assert.match(xml,/R\$ 1\.234,56/);
  assert.match(xml,/R\$ 3\.703,68/);
  assert.match(xml,/3 pessoa\(s\), em 2 posto\(s\)/);
});
test('resumo do editor mostra valor fixo vezes pessoas e o total mensal',()=>{
  const {api,cargo}=app();
  Object.assign(cargo,{on:true,posto:2500,func:4,postos:2});
  const label={textContent:''};
  api.setRoot({querySelector:selector=>selector==='[data-final="aux"]'?label:null});
  api.atualizarFinais();
  assert.equal(currency(label.textContent),'R$ 2.500,00 por pessoa × 4 pessoas = R$ 10.000,00 / mês');
});
test('edição usa pessoas inteiras e permite escolher 3x por semana pelo evento real',()=>{
  const {api,cargo}=app();
  cargo.on=true;cargo.posto=800;
  const target={dataset:{c:'aux.func'},type:'number',value:'2.9'};
  api.ouvintes.find(([event])=>event==='input')[1]({target});
  assert.equal(cargo.func,2);assert.equal(target.value,'2');
  api.ouvintes.find(([event])=>event==='change')[1]({target:{dataset:{c:'aux.escala'},type:'select-one',tagName:'SELECT',value:'3x por semana'}});
  assert.equal(cargo.escala,'3x por semana');assert.equal(api.totalServicos(),1600);
});
test('proposta sem cargos selecionados começa com total zero',()=>{
  const {api}=app();assert.equal(api.totalServicos(),0);assert.equal(api.totalMensal(),0);
});
