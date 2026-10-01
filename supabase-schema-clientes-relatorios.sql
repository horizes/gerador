-- Clientes, postos, alocações e relatório mensal de recebimentos. Execute UMA VEZ,
-- após os scripts de uniformes e cargos unificados. Não depende de ponto/visitas.
begin;
create table public.operacao_clientes (
 id uuid primary key default gen_random_uuid(), nome text not null check(length(trim(nome)) between 2 and 150),
 documento text not null default '', contato text not null default '', email text not null default '', telefone text not null default '',
 ativo boolean not null default true, criado_em timestamptz not null default now()
);
create table public.operacao_postos (
 id uuid primary key default gen_random_uuid(), cliente_id uuid not null references public.operacao_clientes(id) on delete restrict,
 nome text not null check(length(trim(nome)) between 2 and 150), endereco text not null default '',
 ativo boolean not null default true, criado_em timestamptz not null default now()
);
create table public.operacao_alocacoes (
 id uuid primary key default gen_random_uuid(), usuario_id uuid not null references auth.users(id) on delete restrict,
 posto_id uuid not null references public.operacao_postos(id) on delete restrict,
 inicio date not null, fim date, criado_por uuid not null references auth.users(id) on delete restrict,
 criado_em timestamptz not null default now(), check(fim is null or fim>=inicio)
);
create table public.operacao_auditoria (
 id bigint generated always as identity primary key, ator uuid not null references auth.users(id) on delete restrict,
 acao text not null, dados jsonb not null, criado_em timestamptz not null default now()
);
alter table uniforme_recebimentos add column posto_id uuid references operacao_postos(id) on delete restrict;
alter table uniforme_recebimentos add column cliente_id uuid references operacao_clientes(id) on delete restrict;
alter table uniforme_recebimentos add column posto_nome text;
alter table uniforme_recebimentos add column cliente_nome text;
alter table uniforme_recebimentos add column associado_em timestamptz;
alter table uniforme_recebimentos add column associado_por uuid references auth.users(id) on delete restrict;
create index operacao_alocacoes_usuario on operacao_alocacoes(usuario_id,inicio);
create index uniforme_recebimentos_mes_posto on uniforme_recebimentos(criado_em,posto_id);
alter table operacao_clientes enable row level security;
alter table operacao_postos enable row level security;
alter table operacao_alocacoes enable row level security;
alter table operacao_auditoria enable row level security;
create policy clientes_leitura on operacao_clientes for select to authenticated using(tem_acesso_modulo('clientes') or tem_acesso_modulo('uniforme_relatorios'));
create policy postos_leitura on operacao_postos for select to authenticated using(tem_acesso_modulo('clientes') or tem_acesso_modulo('uniforme_relatorios'));
create policy alocacoes_leitura on operacao_alocacoes for select to authenticated using(tem_acesso_modulo('clientes') or (usuario_id=auth.uid() and tem_acesso_modulo('uniforme_solicitar')));
create policy operacao_auditoria_leitura on operacao_auditoria for select to authenticated using(tem_acesso_modulo('clientes') or tem_acesso_modulo('uniforme_relatorios'));
revoke all on operacao_clientes,operacao_postos,operacao_alocacoes,operacao_auditoria from anon,authenticated;
grant select on operacao_clientes,operacao_postos,operacao_alocacoes,operacao_auditoria to authenticated;
create function public.operacao_equipe() returns table(id uuid,nome text) language plpgsql security definer set search_path=public as $$
begin
 if not tem_acesso_modulo('clientes') then raise exception 'Sem acesso ao cadastro de clientes.'; end if;
 return query select p.id,p.nome from perfis p where p.ativo order by p.nome,p.id;
end; $$;
create function public.operacao_salvar(p_tipo text,p_id uuid,p_dados jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare novo uuid;
begin
 if not tem_acesso_modulo('clientes') then raise exception 'Sem acesso ao cadastro.'; end if;
 if p_tipo='cliente' then
 if p_id is null then
 insert into operacao_clientes(nome,documento,contato,email,telefone,ativo) values(trim(p_dados->>'nome'),coalesce(p_dados->>'documento',''),coalesce(p_dados->>'contato',''),coalesce(p_dados->>'email',''),coalesce(p_dados->>'telefone',''),coalesce((p_dados->>'ativo')::boolean,true)) returning id into novo;
 else
 update operacao_clientes set nome=trim(p_dados->>'nome'),documento=coalesce(p_dados->>'documento',''),contato=coalesce(p_dados->>'contato',''),email=coalesce(p_dados->>'email',''),telefone=coalesce(p_dados->>'telefone',''),ativo=coalesce((p_dados->>'ativo')::boolean,true) where id=p_id returning id into novo;
 end if;
 elsif p_tipo='posto' then
 if p_id is null then
 insert into operacao_postos(cliente_id,nome,endereco,ativo) values((p_dados->>'cliente_id')::uuid,trim(p_dados->>'nome'),coalesce(p_dados->>'endereco',''),coalesce((p_dados->>'ativo')::boolean,true)) returning id into novo;
 else
 -- Troca de cliente não é permitida: crie outro posto, preservando o histórico.
 update operacao_postos set nome=trim(p_dados->>'nome'),endereco=coalesce(p_dados->>'endereco',''),ativo=coalesce((p_dados->>'ativo')::boolean,true) where id=p_id and cliente_id=(p_dados->>'cliente_id')::uuid returning id into novo;
 end if;
 else raise exception 'Tipo de cadastro inválido.';
 end if;
 if novo is null then raise exception 'Cadastro inexistente ou alteração de cliente não permitida.'; end if;
 insert into operacao_auditoria(ator,acao,dados) values(auth.uid(),'salvar_'||p_tipo,p_dados||jsonb_build_object('id',novo));return novo;
end; $$;
create function public.operacao_alocar(p_usuario uuid,p_posto uuid,p_inicio date) returns uuid language plpgsql security definer set search_path=public as $$
declare novo uuid;
begin
 if not tem_acesso_modulo('clientes') then raise exception 'Sem acesso às alocações.'; end if;
 if p_inicio is null or not exists(select 1 from perfis where id=p_usuario and ativo) then raise exception 'Colaborador ou data inválidos.'; end if;
 if not exists(select 1 from operacao_postos p join operacao_clientes c on c.id=p.cliente_id where p.id=p_posto and p.ativo and c.ativo) then raise exception 'Posto ou cliente inativo.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_usuario::text,0));
 if exists(select 1 from operacao_alocacoes where usuario_id=p_usuario and inicio>=p_inicio) then raise exception 'A nova alocação deve começar depois das alocações já cadastradas.'; end if;
 update operacao_alocacoes set fim=p_inicio-1 where usuario_id=p_usuario and (fim is null or fim>=p_inicio);
 insert into operacao_alocacoes(usuario_id,posto_id,inicio,criado_por) values(p_usuario,p_posto,p_inicio,auth.uid()) returning id into novo;
 insert into operacao_auditoria(ator,acao,dados) values(auth.uid(),'alocacao',jsonb_build_object('usuario',p_usuario,'posto',p_posto,'inicio',p_inicio));return novo;
end; $$;
-- A alocação é fixada no RECEBIMENTO, e não calculada a partir do posto atual ao exportar.
create function public.uniforme_fixar_posto() returns trigger language plpgsql security definer set search_path=public as $$
declare p operacao_postos; c operacao_clientes;
begin
 select po.* into p from operacao_alocacoes a join operacao_postos po on po.id=a.posto_id
 where a.usuario_id=new.usuario_id and a.inicio<=(new.criado_em at time zone 'America/Sao_Paulo')::date
 and (a.fim is null or a.fim>=(new.criado_em at time zone 'America/Sao_Paulo')::date) order by a.inicio desc limit 1;
 if not found then raise exception 'Solicite à gestão o cadastro do seu posto antes de confirmar o recebimento.'; end if;
 select * into c from operacao_clientes where id=p.cliente_id;
 new.posto_id:=p.id;new.cliente_id:=c.id;new.posto_nome:=p.nome;new.cliente_nome:=c.nome;new.associado_em:=clock_timestamp();new.associado_por:=auth.uid();return new;
end; $$;
create trigger uniforme_recebimento_posto before insert on uniforme_recebimentos for each row execute function uniforme_fixar_posto();
-- Registros antigos não são atribuídos automaticamente ao posto atual.
create function public.uniforme_associar_antigo(p_recebimento uuid,p_posto uuid,p_motivo text) returns void language plpgsql security definer set search_path=public as $$
declare p operacao_postos; c operacao_clientes;
begin
 if not tem_acesso_modulo('uniforme_relatorios') then raise exception 'Sem acesso aos relatórios.'; end if;
 if length(trim(p_motivo))<5 then raise exception 'Justifique a associação histórica.'; end if;
 select * into p from operacao_postos where id=p_posto; if not found then raise exception 'Posto inexistente.'; end if;
 select * into c from operacao_clientes where id=p.cliente_id;
 update uniforme_recebimentos set posto_id=p.id,cliente_id=c.id,posto_nome=p.nome,cliente_nome=c.nome,associado_em=clock_timestamp(),associado_por=auth.uid() where id=p_recebimento and posto_id is null;
 if not found then raise exception 'Recebimento inexistente ou já associado.'; end if;
 insert into operacao_auditoria(ator,acao,dados) values(auth.uid(),'associacao_historica',jsonb_build_object('recebimento',p_recebimento,'posto',p_posto,'motivo',p_motivo));
end; $$;
create function public.uniforme_resumo_mensal(p_mes date,p_posto uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare inicio timestamptz; fim timestamptz; resultado jsonb;
begin
 if not tem_acesso_modulo('uniforme_relatorios') then raise exception 'Sem acesso aos relatórios mensais.'; end if;
 if p_mes is null then raise exception 'Selecione o mês.'; end if;
 inicio:=date_trunc('month',p_mes::timestamp) at time zone 'America/Sao_Paulo';
 fim:=(date_trunc('month',p_mes::timestamp)+interval '1 month') at time zone 'America/Sao_Paulo';
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'pedido_id',r.pedido_id,'nome',p.solicitante_nome,'cargo',p.cargo_nome,'criado_em',r.criado_em,'metodo',r.metodo,'foto_path',r.foto_path,'posto_id',r.posto_id,'posto_nome',r.posto_nome,'cliente_id',r.cliente_id,'cliente_nome',r.cliente_nome,'itens',(select coalesce(jsonb_agg(jsonb_build_object('nome',i.tipo_nome,'categoria',i.categoria,'tamanho',i.tamanho,'quantidade',i.quantidade) order by i.tipo_nome),'[]'::jsonb) from uniforme_itens i where i.recebimento_id=r.id)) order by r.criado_em,r.id),'[]'::jsonb) into resultado
 from uniforme_recebimentos r join uniforme_pedidos p on p.id=r.pedido_id where r.criado_em>=inicio and r.criado_em<fim and (p_posto is null or r.posto_id=p_posto);
 return resultado;
end; $$;
create policy "relatorios fotos recebimentos" on storage.objects for select to authenticated using(bucket_id='uniforme-assinaturas' and tem_acesso_modulo('uniforme_relatorios') and exists(select 1 from uniforme_recebimentos r where r.foto_path=name));
create function public.uniforme_meu_posto() returns jsonb language plpgsql security definer set search_path=public as $$
declare resultado jsonb;
begin
 if not tem_acesso_modulo('uniforme_solicitar') then raise exception 'Sem acesso aos recebimentos.'; end if;
 select jsonb_build_object('posto',p.nome,'cliente',c.nome) into resultado from operacao_alocacoes a join operacao_postos p on p.id=a.posto_id join operacao_clientes c on c.id=p.cliente_id
 where a.usuario_id=auth.uid() and a.inicio<=(clock_timestamp() at time zone 'America/Sao_Paulo')::date and (a.fim is null or a.fim>=(clock_timestamp() at time zone 'America/Sao_Paulo')::date) order by a.inicio desc limit 1;
 return resultado;
end; $$;
revoke execute on function uniforme_meu_posto() from public,anon;
grant execute on function uniforme_meu_posto() to authenticated;
-- Apenas RPCs verificadas. Função de trigger não é uma API de cliente.
revoke execute on function uniforme_fixar_posto() from public,anon,authenticated;
revoke execute on function operacao_equipe(),operacao_salvar(text,uuid,jsonb),operacao_alocar(uuid,uuid,date),uniforme_associar_antigo(uuid,uuid,text),uniforme_resumo_mensal(date,uuid) from public,anon;
grant execute on function operacao_equipe(),operacao_salvar(text,uuid,jsonb),operacao_alocar(uuid,uuid,date),uniforme_associar_antigo(uuid,uuid,text),uniforme_resumo_mensal(date,uuid) to authenticated;
-- A policy de fotos acima usa esta leitura mínima para verificar vínculo com um recebimento.
create policy "relatorios leem recebimentos" on uniforme_recebimentos for select to authenticated using(tem_acesso_modulo('uniforme_relatorios'));
commit;
