/* Execute: node --test tests/auth-flow.test.cjs
   Executa o auth.js real com DOM e Supabase simulados; não envia e-mails. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/auth.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const pendingKey = 'imperium_verificacao_pendente';
const passwordKey = 'imperium_senha_token_pendente';
const tick = () => new Promise(resolve => setImmediate(resolve));

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: k => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k), values };
}
function element(id) {
  const listeners = {};
  return { id, value: '', textContent: '', disabled: false, readOnly: false,
    hidden: false, dataset: {}, style: {}, focused: false,
    classList: { toggle() {} }, focus() { this.focused = true; },
    addEventListener(event, fn) { listeners[event] = fn; },
    querySelector() { return this.button ||= element(id + '-submit'); },
    fire(event) { return listeners[event]?.({ preventDefault() {} }); } };
}
async function app(options = {}) {
  const elements = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], element(m[1])]));
  const calls = { verify: [], reset: [], invite: [], password: [], rpc: [], signOut: 0, platform: 0 };
  const sessionStore = options.storage || storage();
  const location = { hash: options.hash || '', search: '', pathname: '/plataforma/', reload() {} };
  let now = Date.now(), domReady, authListener;
  let user = { id: 'conta-nova', email: 'pessoa@exemplo.com', email_confirmed_at: '2026-10-07T12:00:00Z',
    user_metadata: { convite_senha_pendente: true }, ...options.user };
  let session = options.session || null;
  let passwordSet = !!options.passwordSet;
  const responses = { verifyError: null, resetError: null, userError: null, rpcError: null,
    passwordError: null, inviteError: null };
  const sb = { auth: {
    async verifyOtp(data) {
      calls.verify.push(data);
      if(options.verifyGate) await options.verifyGate;
      if(responses.verifyError) return { data: null, error: responses.verifyError };
      session = { user };
      authListener?.('SIGNED_IN', session);
      return { data: { session }, error: null };
    },
    async resetPasswordForEmail(email) { calls.reset.push(email); return { error: responses.resetError }; },
    async getUser() { return { data: { user }, error: responses.userError }; },
    async getSession() { return { data: { session } }; },
    onAuthStateChange(fn) { authListener = fn; },
    async updateUser(data) {
      calls.password.push(data);
      if(responses.passwordError) return { error: responses.passwordError };
      passwordSet = true;
      user = { ...user, user_metadata: { ...user.user_metadata, ...data.data } };
      session = { user };
      authListener?.('USER_UPDATED', session);
      return { data: { user }, error: null };
    },
    async signOut() { calls.signOut++; session = null; authListener?.('SIGNED_OUT', null); return { error: null }; },
    async signInWithPassword() { session = { user }; authListener?.('SIGNED_IN', session); return { error: null }; }
  }, functions: { async invoke(name, args) {
    calls.invite.push({ name, ...args });
    return { data: { ok: true, confirmacao_pendente: true, tipo_verificacao: 'invite' }, error: responses.inviteError };
  } }, async rpc(name) { calls.rpc.push(name); return { data: passwordSet, error: responses.rpcError }; } };
  const scheduled = [];
  const FakeDate = class extends Date { static now() { return now; } };
  const context = vm.createContext({ window: { Imperium: { supabase: sb,
    manterConectado: { ler: () => true, definir() {} }, carregarPerfil: async () => ({ id: user.id }) },
    Platform: { iniciar() { calls.platform++; } } },
    document: { getElementById: id => elements[id], querySelectorAll: () => [],
      addEventListener(event, fn) { if(event === 'DOMContentLoaded') domReady = fn; } },
    sessionStorage: sessionStore, location, URLSearchParams, Date: FakeDate,
    history: { replaceState(_, __, url) { location.hash = ''; location.search = new URL(url, 'https://exemplo.com').search; } },
    setTimeout(fn, delay) { if(!delay) scheduled.push(fn); return 1; }, clearTimeout() {} });
  vm.runInContext(source, context);
  await domReady();
  async function flush() { for(let i = 0; i < 6; i++) { while(scheduled.length) scheduled.shift()(); await tick(); } }
  await flush();
  return { elements, calls, responses, storage: sessionStore,
    visible: id => elements[id].style.display !== 'none', flush,
    session: () => session, advance(ms) { now += ms; },
    async event(id, event = 'click') { await elements[id].fire(event); await flush(); },
    async verify(code = '012345') { elements.verificacaoToken.value = code; await elements.verificacaoForm.fire('submit'); await flush(); } };
}
const inviteHash = '#/completar-convite?token=7a92ea9b-9e81-4a15-99b2-f2d043bd08f1&nome=Pessoa';
async function invited(options = {}) {
  const a = await app({ hash: inviteHash, ...options });
  a.elements.cadastroEmail.value = ' Pessoa@Exemplo.COM ';
  await a.event('cadastroForm', 'submit');
  return a;
}

test('primeiro código de convite usa invite, preserva zeros e pede a senha antes de entrar', async () => {
  const a = await invited();
  assert.equal(a.visible('verificacao'), true);
  assert.equal(a.elements.verificacaoEmail.value, 'pessoa@exemplo.com');
  assert.equal(a.elements.verificacaoEmail.readOnly, true);
  assert.equal(a.elements.verificacaoToken.focused, true);
  await a.verify('012345');
  assert.equal(a.calls.verify[0].type, 'invite');
  assert.equal(a.calls.verify[0].token, '012345');
  assert.equal(a.visible('senha'), true);
  assert.equal(a.calls.platform, 0);
  a.elements.senhaNova.value = a.elements.senhaConfirma.value = 'SenhaNova123';
  await a.event('senhaForm', 'submit');
  assert.equal(a.calls.password.length, 1);
  assert.equal(a.visible('shell'), true);
  assert.equal(a.calls.platform, 1);
  assert.equal(a.storage.getItem(passwordKey), null);
});
test('código com 8 ou 10 dígitos não é truncado', async () => {
  for(const code of ['00123456', '0012345678']) {
    const a = await invited(); await a.verify(code);
    assert.equal(a.calls.verify[0].token, code);
    assert.equal(a.visible('senha'), true);
  }
  assert.match(html, /pattern="\[0-9\]\{6,10\}"/);
  assert.doesNotMatch(html, /id="verificacaoToken"[^>]*maxlength="6"/);
});
test('colar código com espaços e hífens normaliza sem perder zeros', async () => {
  const a = await invited(); a.elements.verificacaoToken.value = '01 23-45';
  await a.event('verificacaoToken', 'input');
  assert.equal(a.elements.verificacaoToken.value, '012345');
  await a.verify(a.elements.verificacaoToken.value);
  assert.equal(a.visible('senha'), true);
});
test('recarregar depois do envio retoma o mesmo e-mail, tipo e espera para reenvio', async () => {
  const a = await invited();
  const b = await app({ storage: a.storage });
  assert.equal(b.visible('verificacao'), true);
  assert.equal(b.elements.verificacaoEmail.value, 'pessoa@exemplo.com');
  assert.equal(b.elements.verificacaoReenviar.disabled, true);
  await b.verify(); assert.equal(b.calls.verify[0].type, 'invite');
});
test('reenvio usa recovery, permanece recovery após recarregar e não consome outro convite', async () => {
  const a = await invited(); a.advance(61000);
  await a.event('verificacaoReenviar');
  assert.equal(a.calls.reset.length, 1);
  assert.equal(a.calls.invite.length, 1);
  const b = await app({ storage: a.storage }); await b.verify('111222');
  assert.equal(b.calls.verify[0].type, 'recovery');
  assert.equal(b.visible('senha'), true);
});
test('não duplica reenvio durante os 60 segundos de espera', async () => {
  const a = await invited(); await a.event('verificacaoReenviar');
  assert.equal(a.calls.reset.length, 0);
  a.advance(61000); await a.event('verificacaoReenviar'); await a.event('verificacaoReenviar');
  assert.equal(a.calls.reset.length, 1);
});
test('falha no reenvio preserva tipo do primeiro código', async () => {
  const a = await invited(); a.advance(61000);
  a.responses.resetError = { status: 503 }; await a.event('verificacaoReenviar');
  await a.verify(); assert.equal(a.calls.verify[0].type, 'invite');
});
test('código incorreto mantém etapa e permite corrigir sem reenviar automaticamente', async () => {
  const a = await invited(); a.responses.verifyError = { code: 'otp_expired' };
  await a.verify(); assert.equal(a.visible('verificacao'), true);
  assert.match(a.elements.verificacaoErro.textContent, /Código incorreto/);
  assert.equal(a.elements.verificacaoConfirmar.disabled, false);
  assert.equal(a.calls.reset.length, 0);
  a.responses.verifyError = null; await a.verify('111222');
  assert.equal(a.visible('senha'), true);
});
test('falha de rede depois de consumir o código permite salvar a senha sem validar OTP novamente', async () => {
  const a = await invited(); a.responses.userError = { status: 503 };
  await a.verify(); assert.equal(a.visible('senha'), true);
  assert.equal(a.storage.getItem(passwordKey), 'conta-nova');
  assert.equal(a.calls.signOut, 0);
  a.responses.userError = null;
  a.elements.senhaNova.value = a.elements.senhaConfirma.value = 'SenhaNova123';
  await a.event('senhaForm', 'submit');
  assert.equal(a.visible('shell'), true);
  assert.equal(a.calls.verify.length, 1);
});
test('recarregar depois da confirmação retoma a senha sem solicitar o código consumido', async () => {
  const a = await invited(); await a.verify();
  const b = await app({ storage: a.storage, session: a.session() });
  assert.equal(b.visible('senha'), true); assert.equal(b.calls.verify.length, 0);
});
test('senha divergente e erro de atualização mantêm o acesso bloqueado e permitem tentar novamente', async () => {
  const a = await invited(); await a.verify();
  a.elements.senhaNova.value = 'SenhaNova123'; a.elements.senhaConfirma.value = 'OutraSenha123';
  await a.event('senhaForm', 'submit'); assert.equal(a.calls.password.length, 0);
  a.elements.senhaConfirma.value = a.elements.senhaNova.value;
  a.responses.passwordError = { message: 'Senha recusada' };
  await a.event('senhaForm', 'submit'); assert.equal(a.visible('senha'), true);
  assert.equal(a.calls.platform, 0); assert.equal(a.storage.getItem(passwordKey), 'conta-nova');
});
test('recuperação de senha gera recovery e mostra redefinição', async () => {
  const a = await app({ user: { user_metadata: {} }, passwordSet: true });
  a.elements.loginEmail.value = 'pessoa@exemplo.com'; await a.event('loginEsqueci'); await a.verify();
  assert.equal(a.calls.verify[0].type, 'recovery');
  assert.equal(a.elements.senhaTitulo.textContent, 'Redefina sua senha');
});
test('código recebido em outra aba mantém compatibilidade com tipo email', async () => {
  const a = await app(); a.elements.loginEmail.value = 'pessoa@exemplo.com';
  await a.event('loginCodigo'); await a.verify(); assert.equal(a.calls.verify[0].type, 'email');
});
test('sessão antiga não abre ferramentas ao entrar pelo convite', async () => {
  const old = { user: { id: 'admin-antigo' } };
  const a = await invited({ session: old, passwordSet: true });
  assert.equal(a.calls.platform, 0); assert.equal(a.visible('verificacao'), true);
});
test('conta com e-mail não confirmado não pode criar senha nem abrir ferramentas', async () => {
  const a = await invited({ user: { email_confirmed_at: null } }); await a.verify();
  assert.equal(a.visible('verificacao'), true); assert.equal(a.calls.platform, 0);
  assert.equal(a.storage.getItem(passwordKey), null);
});
test('duplo envio da confirmação só verifica o OTP uma vez', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const a = await invited({ verifyGate: gate }); a.elements.verificacaoToken.value = '012345';
  const first = a.elements.verificacaoForm.fire('submit');
  await a.elements.verificacaoForm.fire('submit'); assert.equal(a.calls.verify.length, 1);
  release(); await first; await a.flush(); assert.equal(a.visible('senha'), true);
});
test('estado pendente não grava código, senha ou tokens de sessão', async () => {
  const a = await invited();
  const saved = JSON.parse(a.storage.getItem(pendingKey));
  assert.deepEqual(Object.keys(saved).sort(), ['criadaEm', 'email', 'reenviarEm', 'tipo']);
});
test('é possível continuar quando o e-mail chega, mas a resposta do envio se perde', async () => {
  const a = await app({ hash: inviteHash });
  a.elements.cadastroEmail.value = 'pessoa@exemplo.com';
  await a.event('cadastroTenhoCodigo');
  assert.equal(a.visible('verificacao'), true);
  assert.equal(a.calls.invite.length, 0);
  await a.verify();
  assert.equal(a.calls.verify[0].type, 'email');
  assert.equal(a.visible('senha'), true);
});
test('solicitar recuperação novamente durante a espera retoma o código sem enviar outro', async () => {
  const a = await app(); a.elements.loginEmail.value = 'pessoa@exemplo.com';
  await a.event('loginEsqueci'); await a.event('verificacaoVoltar');
  await a.event('loginEsqueci');
  assert.equal(a.calls.reset.length, 1); assert.equal(a.visible('verificacao'), true);
});
test('abrir link antigo não troca recovery por invite nem reinicia o reenvio', async () => {
  const a = await app(); a.elements.loginEmail.value = 'pessoa@exemplo.com';
  await a.event('loginEsqueci');
  const b = await app({ hash: '#type=invite&access_token=link-antigo', storage: a.storage });
  assert.equal(b.elements.verificacaoReenviar.disabled, true);
  await b.verify(); assert.equal(b.calls.verify[0].type, 'recovery');
});
test('login normal exige estado de senha no servidor antes de abrir ferramentas', async () => {
  const user = { id: 'conta-nova', email: 'pessoa@exemplo.com', email_confirmed_at: '2026-10-07', user_metadata: {} };
  const a = await app({ user, session: { user }, passwordSet: true });
  assert.equal(a.visible('shell'), true); assert.equal(a.calls.rpc.length > 0, true);
  const b = await app({ user, session: { user }, passwordSet: false });
  assert.equal(b.visible('verificacao'), true); assert.equal(b.calls.platform, 0);
});
