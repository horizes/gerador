/* Perfil do usuário logado — papel (admin/usuário), cargo e módulos permitidos.
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
    .select("nome,papel,cargo_id,ativo").eq("id", user.id).maybeSingle();
  if(e1 || !perfil || !perfil.ativo) return null;

  // Ferramentas liberadas = as do CARGO da pessoa (tabela cargo_modulos, criada por
  // supabase-schema-cargos-unificados.sql) + as permissões diretas dela (tabela perfil_modulos,
  // criada por supabase-schema-usuarios.sql). Se essa tabela ainda não existir, só o cargo vale.
  let modulos = new Set();
  if(perfil.papel !== "admin"){
    if(perfil.cargo_id){
      const { data: cm } = await sb().from("cargo_modulos").select("modulo_id").eq("cargo_id", perfil.cargo_id);
      (cm||[]).forEach(r => modulos.add(r.modulo_id));
    }
    const { data: pm } = await sb().from("perfil_modulos").select("modulo_id").eq("perfil_id", user.id);
    (pm||[]).forEach(r => modulos.add(r.modulo_id));
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
