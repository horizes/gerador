/* Execute: node --test tests/pwa-install.test.cjs
   Os eventos nativos de instalação são simulados; nenhum aplicativo é instalado. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/pwa.js'), 'utf8');

function app(options = {}) {
  const ids = ['instalarBtn', 'instalacaoInstalar', 'instalacaoTitulo', 'instalacaoDescricao',
    'instalacaoInstrucoesTitulo', 'instalacaoPassos', 'instalacaoOrientacoes', 'instalacaoContinuar', 'instalacaoStatus'];
  function el() { const events = {}; return { hidden: false, disabled: false, textContent: '', children: [],
    addEventListener(name, fn) { events[name] = fn; }, async click() { await events.click?.(); },
    replaceChildren() { this.children = []; }, append(item) { this.children.push(item); },
    focus() { this.focused = true; } }; }
  const elements = Object.fromEntries(ids.map(id => [id, el()]));
  const events = {}; let ready, menuOpened = 0;
  const media = { matches: !!options.installed, addEventListener() {} };
  const context = vm.createContext({ navigator: { userAgent: options.ua || 'Chrome Windows',
    platform: options.platform || '', maxTouchPoints: options.touch || 0 },
    location: { protocol: 'https:', hostname: 'exemplo.com' },
    window: { matchMedia: () => media, addEventListener(name, fn) { events[name] = fn; },
      ImperiumAuth: { abrirInstalacao() { menuOpened++; } } },
    document: { getElementById: id => elements[id], createElement: () => el(),
      addEventListener(name, fn) { if(name === 'DOMContentLoaded') ready = fn; } } });
  vm.runInContext(source, context); ready();
  return { elements, event: (name, data = {}) => events[name]?.(data), menuOpened: () => menuOpened,
    steps: () => elements.instalacaoPassos.children.map(li => li.textContent).join(' ') };
}
test('iPhone mostra instruções reais de Safari e Tela de Início', async () => {
  const a = app({ ua: 'iPhone Safari' });
  assert.match(a.steps(), /Safari/); assert.match(a.steps(), /Adicionar à Tela de Início/);
  assert.equal(a.elements.instalacaoOrientacoes.hidden, true);
  await a.elements.instalacaoInstalar.click(); assert.equal(a.elements.instalacaoOrientacoes.focused, true);
  assert.equal(a.elements.instalacaoOrientacoes.hidden, false);
  assert.equal(a.elements.instalacaoInstalar.hidden, true);
});
test('iPad com identificação de computador continua recebendo instruções para iPad', () => {
  const a = app({ ua: 'Macintosh Safari', platform: 'MacIntel', touch: 5 });
  assert.match(a.steps(), /Tela de Início/);
});
test('Android, Windows e Safari do Mac recebem instruções próprias', () => {
  assert.match(app({ ua: 'Android Chrome' }).steps(), /três pontos/);
  assert.match(app({ ua: 'Windows Chrome' }).steps(), /Microsoft Edge/);
  assert.match(app({ ua: 'Macintosh Safari' }).steps(), /Adicionar ao Dock/);
});
test('convite nativo que chega depois da tela habilita instalação com um clique', async () => {
  const a = app(); let prompts = 0, prevented = false;
  a.event('beforeinstallprompt', { preventDefault() { prevented = true; },
    async prompt() { prompts++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  assert.equal(prevented, true); assert.equal(a.elements.instalacaoOrientacoes.hidden, true);
  assert.equal(a.elements.instalacaoInstalar.textContent, 'Instalar aplicativo');
  await a.elements.instalacaoInstalar.click();
  assert.equal(prompts, 1);
  assert.match(a.elements.instalacaoStatus.textContent, /Finalize a instalação/);
  assert.equal(a.elements.instalacaoTitulo.textContent, 'Instale o aplicativo');
  a.event('appinstalled');
  assert.equal(a.elements.instalacaoTitulo.textContent, 'Aplicativo instalado');
  assert.equal(a.elements.instalacaoInstalar.hidden, true);
  assert.equal(a.elements.instalarBtn.hidden, true);
});
test('cancelamento não tenta reutilizar o mesmo evento nem bloqueia o usuário', async () => {
  const a = app(); let prompts = 0;
  a.event('beforeinstallprompt', { preventDefault() {}, async prompt() { prompts++; },
    userChoice: Promise.resolve({ outcome: 'dismissed' }) });
  await a.elements.instalacaoInstalar.click(); await a.elements.instalacaoInstalar.click();
  assert.equal(prompts, 1); assert.equal(a.elements.instalacaoContinuar.disabled, false);
  assert.match(a.elements.instalacaoStatus.textContent, /continue no navegador/);
});
test('erro de instalação mostra instruções e permite continuar', async () => {
  const a = app();
  a.event('beforeinstallprompt', { preventDefault() {}, async prompt() { throw Error('Indisponível'); } });
  await a.elements.instalacaoInstalar.click();
  assert.equal(a.elements.instalacaoOrientacoes.hidden, false);
  assert.equal(a.elements.instalacaoInstalar.disabled, false);
  assert.match(a.elements.instalacaoStatus.textContent, /não ficou disponível/);
});
test('modo aplicativo não oferece reinstalação', () => {
  const a = app({ installed: true });
  assert.equal(a.elements.instalacaoInstalar.hidden, true);
  assert.equal(a.elements.instalacaoContinuar.textContent, 'Entrar na plataforma');
});
test('botão no menu reabre a tela de instalação', async () => {
  const a = app(); await a.elements.instalarBtn.click(); assert.equal(a.menuOpened(), 1);
});
