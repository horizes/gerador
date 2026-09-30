-- Aplicar POR ÚLTIMO, antes de publicar os arquivos e as Edge Functions atualizadas.
begin;

-- Anexos financeiros privados; as policies existentes continuam controlando o acesso.
insert into storage.buckets (id, name, public) values ('anexos', 'anexos', false)
on conflict (id) do update set public = false;

-- Reserva definitiva: duas chamadas concorrentes nunca recebem o mesmo convite.
-- Se o cadastro falhar/interromper, o administrador emite outro convite.
create or replace function reservar_convite(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.convites_pendentes%rowtype;
begin
  update public.convites_pendentes set usado_em = now()
  where token = p_token and usado_em is null and criado_em >= now() - interval '7 days'
  returning * into v;
  if not found then raise exception 'Convite inválido, expirado ou já utilizado.'; end if;
  return jsonb_build_object('nome', v.nome, 'papel', v.papel, 'cargo_id', v.cargo_id);
end;
$$;
revoke all on function reservar_convite(uuid) from public, anon, authenticated;
grant execute on function reservar_convite(uuid) to service_role;

-- Um cancelamento não concede UPDATE arbitrário no pedido.
drop policy if exists "uniforme pedidos solicitante cancela" on uniforme_pedidos;
create or replace function uniforme_cancelar_pedido(p_pedido uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not tem_acesso_modulo('uniforme_solicitar') then raise exception 'Sem permissão para cancelar.'; end if;
  update uniforme_pedidos set status = 'cancelado'
  where id = p_pedido and solicitante_id = auth.uid() and status = 'pendente';
  return found;
end;
$$;
revoke all on function uniforme_cancelar_pedido(uuid) from public, anon;
grant execute on function uniforme_cancelar_pedido(uuid) to authenticated;

-- Marca de importação e lançamento são gravados na mesma transação.
create or replace function importar_movimentacoes(p_conta text, p_usuario uuid, p_linhas jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare r jsonb; v_id text; v_n integer := 0;
begin
  if jsonb_typeof(p_linhas) <> 'array' then raise exception 'Movimentações inválidas.'; end if;
  for r in select value from jsonb_array_elements(p_linhas) loop
    v_id := null;
    insert into banco_transacoes(id, conta_id) values (r->>'banco_transacao_id', p_conta)
    on conflict (id) do nothing returning id into v_id;
    if v_id is not null then
      insert into fluxo_lancamentos(data, tipo, categoria, descricao, forma, status, valor, banco_transacao_id, criado_por)
      values ((r->>'data')::date, r->>'tipo', r->>'categoria', r->>'descricao', r->>'forma', 'pago',
              (r->>'valor')::numeric, v_id, p_usuario);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function importar_movimentacoes(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function importar_movimentacoes(text, uuid, jsonb) to service_role;

-- Retorno JSON único: os totais não dependem do limite de linhas da API.
create or replace function fluxo_dados_painel()
returns jsonb language sql security invoker set search_path = public stable as $$
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
    select to_char(data, 'YYYY-MM') || '-01' as data, tipo, categoria, status, sum(valor) as valor
    from fluxo_lancamentos group by to_char(data, 'YYYY-MM'), tipo, categoria, status
  ) t;
$$;
revoke all on function fluxo_dados_painel() from public, anon;
grant execute on function fluxo_dados_painel() to authenticated;

create or replace function fluxo_resumo(p_mes text default '', p_tipo text default 'todos', p_categoria text default '')
returns jsonb language sql security invoker set search_path = public stable as $$
  with periodo as (
    select * from fluxo_lancamentos
    where (p_mes = '' or to_char(data, 'YYYY-MM') = p_mes)
      and (p_tipo = 'todos' or tipo = p_tipo)
      and (p_categoria = '' or categoria = p_categoria)
  ), categorias as (
    select tipo, categoria, sum(valor) as total from periodo group by tipo, categoria
  )
  select jsonb_build_object(
    'saldoAtual', (select coalesce(sum(case when tipo = 'entrada' then valor else -valor end), 0) from fluxo_lancamentos where status = 'pago'),
    'entradas', (select coalesce(sum(valor), 0) from periodo where tipo = 'entrada'),
    'saidas', (select coalesce(sum(valor), 0) from periodo where tipo = 'saida'),
    'categorias', (select coalesce(jsonb_agg(to_jsonb(c) order by total desc), '[]'::jsonb) from categorias c)
  );
$$;
revoke all on function fluxo_resumo(text, text, text) from public, anon;
grant execute on function fluxo_resumo(text, text, text) to authenticated;
commit;
