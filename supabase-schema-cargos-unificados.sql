-- Rode este script no SQL Editor do Supabase DEPOIS de todos os outros (supabase-schema.sql,
-- permissoes, usuarios, uniformes e convites). Pode rodar mais de uma vez sem problema.
--
-- O que muda: o "NÍVEL de permissão" deixa de existir como coisa separada e passa a ser o próprio
-- CARGO. Cada cargo agora reúne, no mesmo lugar:
--   1) as FERRAMENTAS que ele libera (o que antes era o nível)  -> tabela nova cargo_modulos
--   2) o KIT de uniformes e EPIs (o que já era o cargo)         -> tabela cargo_itens (não muda)
-- Cada pessoa tem UM cargo só (perfis.cargo_id) e o acesso dela passa a ser:
--   admin  OU  ferramentas do cargo  OU  permissão direta (perfil_modulos, como antes).
--
-- O que este script faz:
--   a) cria cargo_modulos (ferramentas liberadas por cada cargo);
--   b) MIGRA o que já existe (uma única vez): cada nível vira um cargo (se já existir um cargo com o
--      mesmo nome, os dois viram um só), as ferramentas do nível passam para o cargo, e quem tinha só
--      nível ganha esse cargo. Quem tinha um nível E um cargo diferente mantém o cargo e recebe as
--      ferramentas do antigo nível como permissão direta — ninguém perde acesso;
--   c) faz a regra de segurança (tem_acesso_modulo) e a lista da tela "Usuários" usarem o cargo;
--   d) convites: o convite passa a guardar o cargo (convites_pendentes.cargo_id);
--   e) só administrador pode APAGAR um cargo (apagar um cargo agora também tira o acesso de quem o tem).
-- As tabelas antigas (niveis, nivel_modulos, perfis.nivel_id) ficam intactas no banco, só que sem uso;
-- depois de conferir que está tudo certo você pode apagá-las.
--
-- IMPORTANTE: se algum dia rodar de novo o supabase-schema-usuarios.sql ou o supabase-schema-uniformes.sql,
-- rode este arquivo outra vez logo depois (aqueles scripts recriam a regra antiga por nível).

-- 0) garantias (caso o script dos uniformes ainda não tenha sido rodado) ---------------------------
create table if not exists cargos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
alter table perfis add column if not exists cargo_id uuid references cargos(id) on delete set null;

-- 1) ferramentas liberadas por cada cargo ------------------------------------------------------------
create table if not exists cargo_modulos (
  cargo_id uuid not null references cargos(id) on delete cascade,
  modulo_id text not null,     -- o "id" da ferramenta em js/modules/*.js (ex.: "propostas", "fluxo", "uniforme_solicitar")
  primary key (cargo_id, modulo_id)
);

alter table cargo_modulos enable row level security;

-- qualquer pessoa logada lê (o menu de cada um é montado a partir disso); só admin altera
drop policy if exists "autenticados leem cargo_modulos" on cargo_modulos;
create policy "autenticados leem cargo_modulos" on cargo_modulos
  for select using (auth.role() = 'authenticated');
drop policy if exists "admin concede cargo_modulos" on cargo_modulos;
create policy "admin concede cargo_modulos" on cargo_modulos
  for insert with check (eh_admin(auth.uid()));
drop policy if exists "admin revoga cargo_modulos" on cargo_modulos;
create policy "admin revoga cargo_modulos" on cargo_modulos
  for delete using (eh_admin(auth.uid()));

-- 2) convites passam a guardar o cargo ----------------------------------------------------------------
alter table if exists convites_pendentes
  add column if not exists cargo_id uuid references cargos(id) on delete set null;

-- 3) migração dos níveis antigos (roda uma vez só) ----------------------------------------------------
create table if not exists migracoes_aplicadas (
  nome text primary key,
  aplicada_em timestamptz not null default now()
);
alter table migracoes_aplicadas enable row level security;   -- sem policies: o site não enxerga essa tabela

do $$
begin
  if exists (select 1 from migracoes_aplicadas where nome = 'cargos_unificados') then
    return;
  end if;

  if to_regclass('public.niveis') is not null and to_regclass('public.nivel_modulos') is not null then
    -- cada nível vira um cargo (nome igual a um cargo que já existe = os dois viram um só)
    insert into cargos (nome) select n.nome from niveis n on conflict (nome) do nothing;

    -- as ferramentas do nível passam para o cargo
    insert into cargo_modulos (cargo_id, modulo_id)
      select c.id, nm.modulo_id
      from nivel_modulos nm
      join niveis n on n.id = nm.nivel_id
      join cargos c on c.nome = n.nome
    on conflict do nothing;

    -- quem tinha nível E outro cargo: fica com o cargo e recebe as ferramentas do nível como permissão direta
    insert into perfil_modulos (perfil_id, modulo_id)
      select p.id, nm.modulo_id
      from perfis p
      join niveis n on n.id = p.nivel_id
      join nivel_modulos nm on nm.nivel_id = n.id
      join cargos cn on cn.nome = n.nome
      where p.cargo_id is not null and p.cargo_id <> cn.id
    on conflict do nothing;

    -- quem tinha só o nível passa a ter o cargo de mesmo nome
    update perfis p set cargo_id = c.id
      from niveis n join cargos c on c.nome = n.nome
      where p.nivel_id = n.id and p.cargo_id is null;

    -- convites ainda não usados
    if to_regclass('public.convites_pendentes') is not null then
      update convites_pendentes cp set cargo_id = c.id
        from niveis n join cargos c on c.nome = n.nome
        where cp.nivel_id = n.id and cp.cargo_id is null;
    end if;
  end if;

  insert into migracoes_aplicadas (nome) values ('cargos_unificados');
end
$$;

-- 4) acesso a uma ferramenta = admin OU ferramentas do cargo OU permissão direta -----------------------
-- (mesmo nome e assinatura de sempre, então todas as policies que usam tem_acesso_modulo continuam valendo)
create or replace function tem_acesso_modulo(mod text)
returns boolean language sql security definer set search_path = public stable as $$
  select
    exists(select 1 from perfis where id = auth.uid() and papel = 'admin' and ativo)
    or exists(
      select 1 from perfis p join cargo_modulos cm on cm.cargo_id = p.cargo_id
      where p.id = auth.uid() and p.ativo and cm.modulo_id = mod
    )
    or exists(
      select 1 from perfis p join perfil_modulos pm on pm.perfil_id = p.id
      where p.id = auth.uid() and p.ativo and pm.modulo_id = mod
    );
$$;

-- 5) listagem da tela "Usuários": agora devolve o cargo (e não mais o nível) ---------------------------
drop function if exists admin_listar_perfis();

create function admin_listar_perfis()
returns table(
  id uuid,
  email text,
  nome text,
  papel text,
  cargo_id uuid,
  ativo boolean,
  criado_em timestamptz,
  ultimo_acesso timestamptz,
  email_confirmado_em timestamptz,
  suspenso_ate timestamptz,
  modulos text[]
)
language plpgsql security definer set search_path = public as $$
begin
  if not eh_admin(auth.uid()) then
    return;
  end if;

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
      p.cargo_id,
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

revoke all on function admin_listar_perfis() from public;
grant execute on function admin_listar_perfis() to authenticated;

-- 6) só admin apaga cargo (apagar tira o acesso de quem tem o cargo; quem gerencia uniformes só edita kits) --
drop policy if exists "uniforme cargos apaga" on cargos;
create policy "uniforme cargos apaga" on cargos for delete
  using (eh_admin(auth.uid()));
