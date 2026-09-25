-- Rode este script UMA VEZ no SQL Editor do Supabase, DEPOIS do supabase-schema.sql.
-- Ele cria o sistema de hierarquia por usuário:
--   perfis         -> 1 linha por pessoa (nome, papel admin/usuário, nível, ativo/inativo)
--   niveis         -> os "níveis de permissão" que você cria e nomeia (ex.: Financeiro, Comercial)
--   nivel_modulos  -> quais ferramentas cada nível libera (ex.: nível Financeiro -> "fluxo")
-- Depois de rodar, o próprio site (tela "Usuários", visível só para admin) cuida do resto —
-- você não precisa voltar aqui para criar níveis ou trocar o nível de alguém.

create table if not exists perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null default '',
  papel text not null default 'usuario' check (papel in ('admin','usuario')),
  nivel_id uuid,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists niveis (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  criado_em timestamptz not null default now()
);

alter table perfis add constraint perfis_nivel_id_fkey
  foreign key (nivel_id) references niveis(id) on delete set null;

-- modulo_id = o "id" de cada ferramenta registrada em js/modules/*.js (hoje: "propostas", "fluxo")
create table if not exists nivel_modulos (
  nivel_id uuid not null references niveis(id) on delete cascade,
  modulo_id text not null,
  primary key (nivel_id, modulo_id)
);

alter table perfis enable row level security;
alter table niveis enable row level security;
alter table nivel_modulos enable row level security;

-- Função auxiliar: é admin ativo? (security definer para não recair em recursão nas policies de "perfis")
create or replace function eh_admin(uid uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists(select 1 from perfis where id = uid and papel = 'admin' and ativo);
$$;

-- Função auxiliar: o usuário logado tem acesso a um módulo? (admin sempre tem)
create or replace function tem_acesso_modulo(mod text)
returns boolean language sql security definer set search_path = public stable as $$
  select
    exists(select 1 from perfis where id = auth.uid() and papel = 'admin' and ativo)
    or exists(
      select 1 from perfis p join nivel_modulos nm on nm.nivel_id = p.nivel_id
      where p.id = auth.uid() and p.ativo and nm.modulo_id = mod
    );
$$;

-- perfis: cada um lê o próprio; admin lê/edita todo mundo
create policy "le o proprio perfil ou admin le todos" on perfis
  for select using (id = auth.uid() or eh_admin(auth.uid()));
create policy "admin edita perfis" on perfis
  for update using (eh_admin(auth.uid()));

-- niveis / nivel_modulos: qualquer autenticado lê (precisa pra filtrar o menu); só admin edita
create policy "autenticados leem niveis" on niveis for select using (auth.role() = 'authenticated');
create policy "admin edita niveis" on niveis for insert with check (eh_admin(auth.uid()));
create policy "admin atualiza niveis" on niveis for update using (eh_admin(auth.uid()));
create policy "admin apaga niveis" on niveis for delete using (eh_admin(auth.uid()));

create policy "autenticados leem nivel_modulos" on nivel_modulos for select using (auth.role() = 'authenticated');
create policy "admin edita nivel_modulos" on nivel_modulos for insert with check (eh_admin(auth.uid()));
create policy "admin apaga nivel_modulos" on nivel_modulos for delete using (eh_admin(auth.uid()));

-- cria automaticamente um "perfil" (sem nível, sem acesso a nada) quando o admin cria um login
-- em Authentication > Users — assim a pessoa já aparece na tela "Usuários" pra você configurar.
create or replace function criar_perfil_novo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into perfis (id, nome) values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_perfil on auth.users;
create trigger on_auth_user_created_perfil
  after insert on auth.users
  for each row execute function criar_perfil_novo_usuario();

-- gera um perfil para quem já tinha conta antes desta migração
insert into perfis (id, nome)
  select u.id, split_part(u.email,'@',1) from auth.users u
  left join perfis p on p.id = u.id where p.id is null;

-- função que a tela "Usuários" chama para listar as pessoas com e-mail (auth.users não é
-- acessível direto pelo cliente); só funciona para quem já é admin.
create or replace function admin_listar_perfis()
returns table(id uuid, email text, nome text, papel text, nivel_id uuid, ativo boolean, criado_em timestamptz)
language sql security definer set search_path = public stable as $$
  select p.id, u.email, p.nome, p.papel, p.nivel_id, p.ativo, p.criado_em
  from perfis p join auth.users u on u.id = p.id
  where eh_admin(auth.uid())
  order by p.criado_em asc;
$$;

-- IMPORTANTE — faça você mesmo o primeiro admin (troque o e-mail abaixo e rode só esta linha):
-- update perfis set papel = 'admin' where id = (select id from auth.users where email = 'seu-email@imperium.com');

-- Reforça as permissões dos módulos que já existem: agora só quem tem acesso ao módulo "fluxo"
-- (pelo nível, ou por ser admin) consegue ler/gravar no Fluxo de Caixa — antes bastava estar logado.
drop policy if exists "autenticados leem categorias" on fluxo_categorias;
drop policy if exists "autenticados inserem categorias" on fluxo_categorias;
drop policy if exists "autenticados apagam categorias" on fluxo_categorias;
create policy "acesso ao modulo fluxo leem categorias"    on fluxo_categorias  for select using (tem_acesso_modulo('fluxo'));
create policy "acesso ao modulo fluxo inserem categorias" on fluxo_categorias  for insert with check (tem_acesso_modulo('fluxo'));
create policy "acesso ao modulo fluxo apagam categorias"  on fluxo_categorias  for delete using (tem_acesso_modulo('fluxo'));

drop policy if exists "autenticados leem lancamentos" on fluxo_lancamentos;
drop policy if exists "autenticados inserem lancamentos" on fluxo_lancamentos;
drop policy if exists "autenticados atualizam lancamentos" on fluxo_lancamentos;
drop policy if exists "autenticados apagam lancamentos" on fluxo_lancamentos;
create policy "acesso ao modulo fluxo leem lancamentos"    on fluxo_lancamentos for select using (tem_acesso_modulo('fluxo'));
create policy "acesso ao modulo fluxo inserem lancamentos" on fluxo_lancamentos for insert with check (tem_acesso_modulo('fluxo'));
create policy "acesso ao modulo fluxo atualizam lancamentos" on fluxo_lancamentos for update using (tem_acesso_modulo('fluxo'));
create policy "acesso ao modulo fluxo apagam lancamentos"  on fluxo_lancamentos for delete using (tem_acesso_modulo('fluxo'));

drop policy if exists "autenticados leem anexos" on storage.objects;
drop policy if exists "autenticados enviam anexos" on storage.objects;
drop policy if exists "autenticados apagam anexos" on storage.objects;
create policy "acesso ao modulo fluxo leem anexos"   on storage.objects for select using (bucket_id = 'anexos' and tem_acesso_modulo('fluxo'));
create policy "acesso ao modulo fluxo enviam anexos" on storage.objects for insert with check (bucket_id = 'anexos' and tem_acesso_modulo('fluxo'));
create policy "acesso ao modulo fluxo apagam anexos" on storage.objects for delete using (bucket_id = 'anexos' and tem_acesso_modulo('fluxo'));
