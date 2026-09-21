/* Usuários — módulo de administração (só aparece para quem é "admin").
   Duas partes:
   - Níveis de permissão: você cria os nomes que quiser (ex.: "Financeiro", "Comercial") e marca
     quais ferramentas cada nível libera.
   - Pessoas: depois de criar o login da pessoa no painel do Supabase (Authentication > Users),
     ela aparece aqui automaticamente — daí você escolhe o nível dela (ou marca como admin) e
     liga/desliga o acesso, tudo sem precisar voltar ao Supabase.
   Veja supabase-schema-permissoes.sql para o que precisa ser rodado uma vez no banco. */
(function(){
"use strict";

const sb = () => window.Imperium.supabase;
const $ = (id, r) => (r||document).getElementById(id);
const esc = s => String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

let root = null;
let niveis = [];       // [{id,nome}]
let nivelModulos = {}; // { nivel_id: Set(modulo_id) }
let pessoas = [];      // [{id,email,nome,papel,nivel_id,ativo}]
const MODULOS = () => window.Platform.modulosConfiguraveis(); // [{id,nome}]

function skel(){
  return `
  <section class="usr-wrap">
    <h1 class="mod-h">Usuários</h1>
    <p class="mod-sub">Crie níveis de permissão e escolha o que cada pessoa da equipe pode ver.</p>

    <div class="usr-card">
      <h2 class="usr-h">Níveis de permissão</h2>
      <p class="usr-hint">Cada nível libera um conjunto de ferramentas. Uma pessoa marcada como "admin" vê tudo, sem precisar de nível.</p>
      <div id="usrNiveis"></div>
      <form id="usrNovoNivel" class="usr-novo-nivel">
        <input type="text" id="usrNomeNivel" placeholder="Nome do novo nível (ex.: Financeiro)" required maxlength="60">
        <button class="btn ghost" type="submit">+ Criar nível</button>
      </form>
    </div>

    <div class="usr-card">
      <h2 class="usr-h">Pessoas</h2>
      <p class="usr-hint">Contas são criadas no painel do Supabase (Authentication &gt; Users). Depois de criadas, configure o acesso aqui.</p>
      <div class="usr-tbl-wrap"><table class="fx-tbl usr-tbl">
        <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Nível</th><th>Ativo</th><th></th></tr></thead>
        <tbody id="usrPessoas"></tbody>
      </table></div>
    </div>
  </section>`;
}

/* ---------- níveis ---------- */
function htmlNivel(nv){
  const mods = MODULOS();
  const marcados = nivelModulos[nv.id] || new Set();
  return `
  <details class="fx-det usr-nivel" open>
    <summary><span>${esc(nv.nome)}</span><span class="chev">▸</span></summary>
    <div class="body">
      ${mods.length ? mods.map(m => `
        <label class="tg"><input type="checkbox" data-nivel="${nv.id}" data-mod="${m.id}" ${marcados.has(m.id)?"checked":""}><span>${esc(m.nome)}</span></label>
      `).join("") : `<p class="usr-hint">Nenhuma ferramenta registrada ainda.</p>`}
      <button class="btn ghost usr-del-nivel" type="button" data-nivel="${nv.id}">Apagar nível "${esc(nv.nome)}"</button>
    </div>
  </details>`;
}

function renderNiveis(){
  $("usrNiveis", root).innerHTML = niveis.length
    ? niveis.map(htmlNivel).join("")
    : `<p class="usr-hint">Nenhum nível criado ainda — crie um abaixo.</p>`;
}

async function carregarNiveis(){
  const { data: nv } = await sb().from("niveis").select("id,nome").order("nome");
  niveis = nv || [];
  const { data: nm } = await sb().from("nivel_modulos").select("nivel_id,modulo_id");
  nivelModulos = {};
  (nm||[]).forEach(r=>{ (nivelModulos[r.nivel_id] ||= new Set()).add(r.modulo_id); });
  renderNiveis();
}

async function alternarModuloNivel(nivelId, moduloId, ligar){
  if(ligar) await sb().from("nivel_modulos").insert({ nivel_id: nivelId, modulo_id: moduloId });
  else await sb().from("nivel_modulos").delete().eq("nivel_id", nivelId).eq("modulo_id", moduloId);
}

async function criarNivel(nome){
  const { error } = await sb().from("niveis").insert({ nome });
  if(error){ alert(error.message.includes("duplicate") ? "Já existe um nível com esse nome." : error.message); return; }
  await carregarNiveis();
}

async function apagarNivel(id){
  const nv = niveis.find(n=>n.id===id);
  if(!confirm(`Apagar o nível "${nv?nv.nome:""}"? Quem estiver nele fica sem nível (sem acesso a nada) até você escolher outro.`)) return;
  await sb().from("niveis").delete().eq("id", id);
  await Promise.all([carregarNiveis(), carregarPessoas()]);
}

/* ---------- pessoas ---------- */
function optsNiveis(selecionado){
  return `<option value="">— sem nível —</option>` +
    niveis.map(n=>`<option value="${n.id}" ${n.id===selecionado?"selected":""}>${esc(n.nome)}</option>`).join("");
}

function linhaPessoa(p){
  const vocEMesmo = p.id === window.Imperium.perfil.id;
  return `
  <tr data-id="${p.id}">
    <td><input type="text" data-f="nome" value="${esc(p.nome)}"></td>
    <td class="usr-email">${esc(p.email)}</td>
    <td><select data-f="papel" ${vocEMesmo?"disabled title='Você não pode alterar seu próprio papel'":""}>
      <option value="usuario" ${p.papel==="usuario"?"selected":""}>Usuário</option>
      <option value="admin" ${p.papel==="admin"?"selected":""}>Admin</option>
    </select></td>
    <td><select data-f="nivel_id" ${p.papel==="admin"?"disabled":""}>${optsNiveis(p.nivel_id)}</select></td>
    <td><input type="checkbox" data-f="ativo" ${p.ativo?"checked":""} ${vocEMesmo?"disabled title='Você não pode desativar a si mesmo'":""}></td>
    <td><button class="btn ghost usr-salvar" type="button">Salvar</button></td>
  </tr>`;
}

function renderPessoas(){
  $("usrPessoas", root).innerHTML = pessoas.length
    ? pessoas.map(linhaPessoa).join("")
    : `<tr class="vazio"><td colspan="6">Ninguém ainda. Crie contas em Authentication &gt; Users no Supabase.</td></tr>`;
}

async function carregarPessoas(){
  const { data, error } = await sb().rpc("admin_listar_perfis");
  if(error){ $("usrPessoas", root).innerHTML = `<tr class="vazio"><td colspan="6">${esc(error.message)}</td></tr>`; return; }
  pessoas = data || [];
  renderPessoas();
}

async function salvarPessoa(tr){
  const id = tr.dataset.id;
  const nome = tr.querySelector('[data-f="nome"]').value.trim();
  const papel = tr.querySelector('[data-f="papel"]').value;
  const nivel_id = tr.querySelector('[data-f="nivel_id"]').value || null;
  const ativo = tr.querySelector('[data-f="ativo"]').checked;
  const btn = tr.querySelector(".usr-salvar");
  const txt = btn.textContent; btn.disabled = true; btn.textContent = "Salvando…";
  const { error } = await sb().from("perfis").update({
    nome, papel, nivel_id: papel === "admin" ? null : nivel_id, ativo
  }).eq("id", id);
  btn.disabled = false; btn.textContent = txt;
  if(error){ alert(error.message); return; }
  await carregarPessoas();
}

/* ---------- montagem ---------- */
function ligar(){
  root.addEventListener("change", e=>{
    const chk = e.target.closest('input[type="checkbox"][data-nivel]');
    if(chk){ alternarModuloNivel(chk.dataset.nivel, chk.dataset.mod, chk.checked); return; }
    const selPapel = e.target.closest('select[data-f="papel"]');
    if(selPapel){ // some com o nível na hora se virar admin, pra não confundir
      const tr = selPapel.closest("tr");
      tr.querySelector('[data-f="nivel_id"]').disabled = selPapel.value === "admin";
    }
  });
  root.addEventListener("click", e=>{
    if(e.target.closest(".usr-salvar")) salvarPessoa(e.target.closest("tr"));
    const delNv = e.target.closest(".usr-del-nivel");
    if(delNv) apagarNivel(delNv.dataset.nivel);
  });
  $("usrNovoNivel", root).addEventListener("submit", e=>{
    e.preventDefault();
    const input = $("usrNomeNivel", root);
    const nome = input.value.trim();
    if(!nome) return;
    input.value = "";
    criarNivel(nome);
  });
}

function mount(el){
  root = el;
  root.classList.add("mod-usuarios");
  root.innerHTML = skel();
  ligar();
  carregarNiveis();
  carregarPessoas();
}
function unmount(){ root = null; }

window.Platform.register({
  id: "usuarios",
  menu: "Usuários",
  nome: "Usuários",
  descricao: "Crie níveis de permissão e configure o que cada pessoa da equipe pode acessar.",
  soAdmin: true,
  icone: '<path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  mount, unmount
});

})();
