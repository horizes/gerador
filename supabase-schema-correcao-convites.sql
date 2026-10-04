-- Correção específica do cadastro por convite. Pode ser reaplicada.
-- Requer os scripts de convites e cargos unificados já instalados.
-- Não altera convites existentes e não reabre links consumidos/expirados.
begin;

do $$
begin
  if nto_regclass('public.convites_pendentes') is null then
    raise exception 'Instale supabase-schema-convites.sql e supabase-schema-cargos-unificados.sql antes desta correção.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'convites_pendentes' and column_name = 'cargo_id'
  ) then
    raise exception 'Instale supabase-schema-cargos-unificados.sql antes desta correção.';
  end if;
end;
$$;

create or replace function public.reservar_convite(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.convites_pendentes%rowtype;
begin
  update public.convites_pendentes set usado_em = now()
  where token = p_token and usado_em is null and criado_em >= now() - interval '7 days'
  returning * into v;
  if not found then
    raise exception using errcode = 'P0002', message = 'Convite inválido, expirado ou já utilizado.';
  end if;
  return jsonb_build_object('nome', v.nome, 'papel', v.papel, 'cargo_id', v.cargo_id);
end;
$$;

revoke all on function public.reservar_convite(uuid) from public, anon, authenticated;
grant execute on function public.reservar_convite(uuid) to service_role;
notify pgrst, 'reload schema';
commit;
