-- Padrão de propostas individual por conta. Execute após os scripts de perfis/permissões.
begin;
create table if not exists public.proposta_padroes (
  usuario_id uuid primary key references public.perfis(id) on delete cascade,
  configuracao jsonb not null check (jsonb_typeof(configuracao) = 'object'),
  atualizado_em timestamptz not null default now()
);
alter table public.proposta_padroes enable row level security;
revoke all on public.proposta_padroes from public, anon;
grant select, insert, update, delete on public.proposta_padroes to authenticated;

drop policy if exists "proposta padrao le proprio" on public.proposta_padroes;
create policy "proposta padrao le proprio" on public.proposta_padroes for select to authenticated
  using (usuario_id = auth.uid() and public.tem_acesso_modulo('propostas'));
drop policy if exists "proposta padrao cria proprio" on public.proposta_padroes;
create policy "proposta padrao cria proprio" on public.proposta_padroes for insert to authenticated
  with check (usuario_id = auth.uid() and public.tem_acesso_modulo('propostas'));
drop policy if exists "proposta padrao atualiza proprio" on public.proposta_padroes;
create policy "proposta padrao atualiza proprio" on public.proposta_padroes for update to authenticated
  using (usuario_id = auth.uid() and public.tem_acesso_modulo('propostas'))
  with check (usuario_id = auth.uid() and public.tem_acesso_modulo('propostas'));
drop policy if exists "proposta padrao remove proprio" on public.proposta_padroes;
create policy "proposta padrao remove proprio" on public.proposta_padroes for delete to authenticated
  using (usuario_id = auth.uid() and public.tem_acesso_modulo('propostas'));

create or replace function public.proposta_padrao_data()
returns trigger language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;
drop trigger if exists proposta_padrao_data on public.proposta_padroes;
create trigger proposta_padrao_data before update on public.proposta_padroes
  for each row execute function public.proposta_padrao_data();
revoke all on function public.proposta_padrao_data() from public, anon, authenticated;
commit;
