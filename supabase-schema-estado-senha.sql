-- Rode no SQL Editor ANTES de publicar os arquivos da correção de e-mail no celular.
-- Consultas de leitura: não mudam contas, senhas, cargos ou papéis.
-- O navegador recebe apenas um booleano; o hash da senha nunca sai do banco.
begin;

create or replace function public.minha_senha_definida()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from auth.users as u
    where u.id = auth.uid()
      and coalesce(u.encrypted_password, '') <> ''
  );
$$;

revoke all on function public.minha_senha_definida() from public, anon;
grant execute on function public.minha_senha_definida() to authenticated;

-- Mantém admin_listar_perfis() intacta. A lista junta esta informação por ID.
create or replace function public.admin_listar_estado_senha()
returns table (id uuid, senha_definida boolean)
language sql stable security definer set search_path = '' as $$
  select u.id, coalesce(u.encrypted_password, '') <> ''
  from auth.users as u
  where public.eh_admin(auth.uid());
$$;

revoke all on function public.admin_listar_estado_senha() from public, anon;
grant execute on function public.admin_listar_estado_senha() to authenticated;

notify pgrst, 'reload schema';
commit;
