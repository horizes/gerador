/* Datas locais e leitura completa com ordem determinística. */
(function(){
"use strict";
window.Imperium.hojeLocal = function(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
};
window.Imperium.lerTodas = async function(criarConsulta){
  const linhas = [];
  // Avança pela quantidade efetivamente retornada, inclusive se o limite do projeto for menor.
  for(let inicio = 0;;){
    const { data, error } = await criarConsulta().range(inicio, inicio + 499);
    if(error) throw error;
    if(!data || !data.length) return linhas;
    linhas.push(...data);
    inicio += data.length;
  }
};
})();
