-- Rode este script no SQL Editor do Supabase, DEPOIS do supabase-schema.sql e do
-- supabase-schema-permissoes.sql. Pode rodar mais de uma vez sem problema.
--
-- O que ele faz:
--   1) cria a tabela perfil_modulos: permissões DIRETAS por pessoa (ferramenta a ferramenta),
--      além do que a pessoa já recebe pelo nível dela;
--   2) faz as regras de segurança (RLS) do Fluxo de Caixa reconhecerem essas permissões diretas;
--   3) refaz admin_listar_perfis(), que a tela "Usuários" usa para listar todo mundo que tem conta,
--      agora com: último acesso, e-mail confirmado?, suspenso no Supabase? e as permissões diretas.
--      Também cria o perfil de qualquer conta que ainda não tenha um (assim ninguém fica invisível).

-- 1) Permissões diretas por pessoa ---------------------------------------------------------------
create table if not exists perfil_modulos (
  perfil_id uuid not null references perfis(id) on delete cascade,
  modulo_id text not null,     -- o "id" da ferramenta em js/modules/*.js (hoje: "propostas", "fluxo")
  primary key (perfil_id, modulo_id)
);

alter table perfil_modulos enable row level security;

drop policy if exists "le as proprias permissoes ou admin le todas" on perfil_modulos;
create policy "le as proprias permissoes ou admin le todas" on perfil_modulos
  for select using (perfil_id = auth.uid() or eh_admin(auth.uid()));

drop policy if exists "admin concede permissoes" on perfil_modulos;
create policy "admin concede permissoes" on perfil_modulos
  for insert with check (eh_admin(auth.uid()));

drop policy if exists "admin revoga permissoes" on perfil_modulos;
create policy "admin revoga permissoes" on perfil_modulos
  for delete using (eh_admin(auth.uid()));

-- 2) Acesso a um módulo = admin OU nível da pessoa libera OU permissão direta ----------------------
-- (mesmo nome e assinatura de antes, então as policies do Fluxo de Caixa continuam valendo)
create or replace function tem_acesso_modulo(mod text)
returns boolean language sql security definer set search_path = public stable as $$
  select
    exists(select 1 from perfis where id = auth.uid() and papel = 'admin' and ativo)
    or exists(
      select 1 from perfis p join nivel_modulos nm on nm.nivel_id = p.nivel_id
      where p.id = auth.uid() and p.ativo and nm.modulo_id = mod
    )
    or exists(
      select 1 from perfis p join perfil_modulos pm on pm.perfil_id = p.id
      where p.id = auth.uid() and p.ativo and pm.modulo_id = mod
    );
$$;

-- 3) Listagem para a tela "Usuários" -------------------------------------------------------------
-- (o tipo de retorno mudou, por isso é preciso apagar a versão antiga antes)
drop function if exists admin_listar_perfis();

create function admin_listar_perfis()
returns table(
  id uuid,
  email text,
  nome text,
  papel text,
  nivel_id uuid,
  ativo boolean,
  criado_em timestamptz,
  ultimo_acesso timestamptz,
  email_confirmado_em timestamptz,
  suspenso_ate timestamptz,
  modulos text[]
)
language plpgsql security definer set search_path = public as $$
begin
  -- só admin ativo enxerga a lista; para qualquer outra pessoa, volta vazio
  if not eh_admin(auth.uid()) then
    return;
  end if;

  -- garante que toda conta do Supabase tenha um perfil (caso o gatilho tenha falhado alguma vez)
  insert into perfis (id, nome)
    select u.id, split_part(u.email, '@', 1)
    from auth.users u
    where not exists (select 1 from perfis px where px.id = u.id)
  on conflict do nothing;

  return query
    select
      p.id,
      u.email::text,
      p.nome,
      p.papel,
      p.nivel_id,
      p.ativo,
      p.criado_em,
      u.last_sign_in_at,
      u.email_confirmed_at,
      u.banned_until,
      array(select pm.modulo_id from perfil_modulos pm where pm.perfil_id = p.id order by pm.modulo_id)
    from perfis p
    join auth.users u on u.id = p.id
    order by p.criado_em asc;
end;
$$;

-- só quem está logado pode chamar (e a própria função ainda confere se é admin)
revoke all on function admin_listar_perfis() from public;
grant execute on function admin_listar_perfis() to authenticated;
