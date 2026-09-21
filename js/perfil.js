/* Perfil do usuário logado — papel (admin/usuário), nível e módulos permitidos.
   Carregado por js/auth.js logo depois do login, antes de abrir a plataforma:
   é o que decide quais ferramentas aparecem no menu e na tela inicial de cada pessoa
   (o admin configura tudo isso na tela "Usuários"). Veja supabase-schema-permissoes.sql. */
(function(){
"use strict";

const sb = () => window.Imperium.supabase;

/* Retorna:
   - objeto do perfil (admin: bool, ativo: bool, nome, modulos: Set<string>) se deu tudo certo
   - null se a conta não tem perfil, está desativada, ou deu erro — nesses casos não deixa entrar */
async function carregarPerfil(){
  const { data: { user } } = await sb().auth.getUser();
  if(!user) return null;

  const { data: perfil, error: e1 } = await sb().from("perfis")
    .select("nome,papel,nivel_id,ativo").eq("id", user.id).maybeSingle();
  if(e1 || !perfil || !perfil.ativo) return null;

  let modulos = new Set();
  if(perfil.papel !== "admin" && perfil.nivel_id){
    const { data: nm } = await sb().from("nivel_modulos").select("modulo_id").eq("nivel_id", perfil.nivel_id);
    modulos = new Set((nm||[]).map(r => r.modulo_id));
  }

  const obj = {
    id: user.id, email: user.email, nome: perfil.nome || user.email,
    admin: perfil.papel === "admin", modulos,
    podeVer(moduloId){ return this.admin || this.modulos.has(moduloId); }
  };
  window.Imperium.perfil = obj;
  return obj;
}

window.Imperium = window.Imperium || {};
window.Imperium.carregarPerfil = carregarPerfil;

})();
