/* Categorias das páginas: abas no mesmo padrão de Clientes e Uniformes.
   Alternar abas apenas mostra/oculta os painéis; mantém formulários e dados. */
(function(){
"use strict";
function montar(raiz, opcoes){
  const nav = raiz.querySelector('[data-categorias-nav]');
  if(!nav) throw new Error('Navegação de categorias não encontrada.');
  const itens = opcoes.itens;
  let atual = itens.some(i => i.id === opcoes.inicial) ? opcoes.inicial : itens[0].id;
  const prefixo = opcoes.id;
  const botoes = new Map();
  nav.classList.add('page-categorias');
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', opcoes.rotulo);
  nav.replaceChildren();
  itens.forEach(item => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = `${prefixo}-aba-${item.id}`;
    b.dataset.categoria = item.id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', `${prefixo}-painel-${item.id}`);
    const nome = document.createElement('span');
    nome.textContent = item.nome;
    b.append(nome);
    nav.append(b);
    botoes.set(item.id, b);
  });
  function atualizar(){
    botoes.forEach((b, id) => {
      const ativa = id === atual;
      b.classList.toggle('on', ativa);
      b.setAttribute('aria-selected', String(ativa));
      b.tabIndex = ativa ? 0 : -1;
    });
    raiz.querySelectorAll('[data-categoria-painel]').forEach(p => {
      const id = p.dataset.categoriaPainel;
      if(!botoes.has(id)) return;
      p.id = `${prefixo}-painel-${id}`;
      p.setAttribute('role', 'tabpanel');
      p.setAttribute('aria-labelledby', `${prefixo}-aba-${id}`);
      p.hidden = id !== atual;
    });
    raiz.querySelectorAll('[data-visivel-em]').forEach(el => {
      el.hidden = !el.dataset.visivelEm.split(/\s+/).includes(atual);
    });
  }
  function ativar(id, focar = false){
    if(!botoes.has(id)) return;
    atual = id;
    atualizar();
    if(focar) botoes.get(id).focus({ preventScroll: true });
  }
  function contagem(id, total){
    const b = botoes.get(id), item = itens.find(i => i.id === id);
    if(!b || !Number.isFinite(total)) return;
    let badge = b.querySelector('.page-categoria-total');
    if(!badge){
      badge = document.createElement('span');
      badge.className = 'page-categoria-total';
      badge.setAttribute('aria-hidden', 'true');
      b.append(badge);
    }
    badge.textContent = total;
    b.setAttribute('aria-label', `${item.nome}: ${total}`);
  }
  function click(e){
    const aba = e.target.closest('[data-categoria]');
    if(aba && nav.contains(aba)){ ativar(aba.dataset.categoria, true); return; }
    const atalho = e.target.closest('[data-abrir-categoria]');
    if(atalho && raiz.contains(atalho)) ativar(atalho.dataset.abrirCategoria, true);
  }
  function teclado(e){
    const aba = e.target.closest('[role="tab"]');
    if(!aba || !nav.contains(aba) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const indice = itens.findIndex(i => i.id === aba.dataset.categoria);
    const destino = e.key === 'Home' ? 0 : e.key === 'End' ? itens.length - 1
      : (indice + (e.key === 'ArrowRight' ? 1 : -1) + itens.length) % itens.length;
    ativar(itens[destino].id, true);
  }
  raiz.addEventListener('click', click);
  nav.addEventListener('keydown', teclado);
  atualizar();
  return { ativar, atualizar, contagem, get atual(){ return atual; },
    destruir(){ raiz.removeEventListener('click', click); nav.removeEventListener('keydown', teclado); } };
}
window.ImperiumCategorias = { montar };
})();
