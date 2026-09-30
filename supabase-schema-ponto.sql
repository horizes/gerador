-- Módulo de ponto EM HOMOLOGAÇÃO. Não substitui REP-P oficial.
-- Execute após os scripts existentes, inclusive cargos unificados e melhorias.
begin;
create extension if not exists pgcrypto with schema extensions;
create table public.ponto_empresa (
 id boolean primary key default true check(id), cnpj text not null default '62249653000166',
 nome text not null default '', fuso text not null default 'America/Sao_Paulo',
 modo text not null default 'homologacao' check(modo = 'homologacao'),
 aviso text not null default 'Ambiente de homologação. Não substitui o ponto oficial.'
);
insert into public.ponto_empresa(id) values(true);
create table public.ponto_vinculos (
 id uuid primary key default gen_random_uuid(), usuario_id uuid not null references auth.users(id) on delete restrict,
 nome text not null check(length(trim(nome)) between 2 and 150), cpf text not null check(cpf ~ '^[0-9]{11}$'),
 matricula text not null check(length(trim(matricula)) between 1 and 30),
 escala text not null check(escala in ('5x2','6x1','12x36','Outra')),
 horarios text not null default '', convencao text not null default '',
 ativo boolean not null default true, criado_em timestamptz not null default clock_timestamp(),
 criado_por uuid not null references auth.users(id) on delete restrict
);
create unique index ponto_vinculo_ativo on public.ponto_vinculos(usuario_id) where ativo;
create unique index ponto_matricula on public.ponto_vinculos(matricula);
create table public.ponto_batidas (
 id uuid primary key default gen_random_uuid(), numero bigint generated always as identity unique,
 vinculo_id uuid not null references public.ponto_vinculos(id) on delete restrict,
 usuario_id uuid not null references auth.users(id) on delete restrict,
 instante timestamptz not null, recebido_em timestamptz not null,
 nome text not null, cpf text not null, matricula text not null,
 requisicao uuid not null, hash_anterior text not null, hash text not null,
 unique(usuario_id,requisicao)
);
create table public.ponto_solicitacoes (
 id uuid primary key default gen_random_uuid(), vinculo_id uuid not null references public.ponto_vinculos(id) on delete restrict,
 usuario_id uuid not null references auth.users(id) on delete restrict,
 tipo text not null check(tipo in ('incluir','desconsiderar')),
 batida_id uuid references public.ponto_batidas(id) on delete restrict,
 instante timestamptz, natureza text check(natureza in ('E','S')),
 motivo text not null check(length(trim(motivo)) between 10 and 150),
 criado_em timestamptz not null default clock_timestamp(),
 check ((tipo='incluir' and instante is not null and natureza is not null and batida_id is null)
 or (tipo='desconsiderar' and batida_id is not null and instante is null and natureza is null))
);
create table public.ponto_decisoes (
 id uuid primary key default gen_random_uuid(), solicitacao_id uuid not null unique references public.ponto_solicitacoes(id) on delete restrict,
 resultado text not null check(resultado in ('aprovado','negado')),
 motivo text not null check(length(trim(motivo)) between 10 and 150),
 responsavel_id uuid not null references auth.users(id) on delete restrict,
 criado_em timestamptz not null default clock_timestamp()
);
create table public.ponto_auditoria (
 id bigint generated always as identity primary key, ator uuid not null references auth.users(id) on delete restrict,
 acao text not null, entidade uuid, dados jsonb not null, criado_em timestamptz not null default clock_timestamp()
);
create or replace function public.ponto_imutavel() returns trigger language plpgsql set search_path=public as $$
begin raise exception 'Registro de ponto imutável: não é permitido alterar ou excluir.'; end; $$;
create trigger ponto_batidas_imutaveis before update or delete on public.ponto_batidas for each row execute function public.ponto_imutavel();
create trigger ponto_solicitacoes_imutaveis before update or delete on public.ponto_solicitacoes for each row execute function public.ponto_imutavel();
create trigger ponto_decisoes_imutaveis before update or delete on public.ponto_decisoes for each row execute function public.ponto_imutavel();
create trigger ponto_auditoria_imutavel before update or delete on public.ponto_auditoria for each row execute function public.ponto_imutavel();
-- CPF: cálculo dos dois dígitos verificadores.
create function public.ponto_cpf_valido(valor text) returns boolean language plpgsql immutable set search_path=public as $$
declare s integer; d integer; i integer; etapa integer;
begin
 if valor !~ '^[0-9]{11}$' or valor = repeat(substr(valor,1,1),11) then return false; end if;
 for etapa in 1..2 loop
 s:=0; for i in 1..(8+etapa) loop s:=s+substr(valor,i,1)::integer*(10+etapa-i); end loop;
 d:=(s*10)%11; if d=10 then d:=0; end if;
 if d<>substr(valor,9+etapa,1)::integer then return false; end if;
 end loop; return true;
end; $$;
alter table public.ponto_vinculos add constraint ponto_cpf_verificado check(public.ponto_cpf_valido(cpf));
-- Nenhuma escrita direta por clientes; apenas RPCs autorizadas.
alter table public.ponto_empresa enable row level security;
alter table public.ponto_vinculos enable row level security;
alter table public.ponto_batidas enable row level security;
alter table public.ponto_solicitacoes enable row level security;
alter table public.ponto_decisoes enable row level security;
alter table public.ponto_auditoria enable row level security;
create policy ponto_empresa_leitura on public.ponto_empresa for select to authenticated using(tem_acesso_modulo('ponto_meu') or tem_acesso_modulo('ponto_gestao'));
create policy ponto_vinculos_leitura on public.ponto_vinculos for select to authenticated using((usuario_id=auth.uid() and tem_acesso_modulo('ponto_meu')) or tem_acesso_modulo('ponto_gestao'));
create policy ponto_batidas_leitura on public.ponto_batidas for select to authenticated using((usuario_id=auth.uid() and tem_acesso_modulo('ponto_meu')) or tem_acesso_modulo('ponto_gestao'));
create policy ponto_solicitacoes_leitura on public.ponto_solicitacoes for select to authenticated using((usuario_id=auth.uid() and tem_acesso_modulo('ponto_meu')) or tem_acesso_modulo('ponto_gestao'));
create policy ponto_decisoes_leitura on public.ponto_decisoes for select to authenticated using(tem_acesso_modulo('ponto_gestao') or exists(select 1 from public.ponto_solicitacoes s where s.id=solicitacao_id and s.usuario_id=auth.uid() and tem_acesso_modulo('ponto_meu')));
create policy ponto_auditoria_leitura on public.ponto_auditoria for select to authenticated using(tem_acesso_modulo('ponto_gestao'));
revoke all on public.ponto_empresa,public.ponto_vinculos,public.ponto_batidas,public.ponto_solicitacoes,public.ponto_decisoes,public.ponto_auditoria from anon,authenticated,service_role;
grant select on public.ponto_empresa,public.ponto_vinculos,public.ponto_batidas,public.ponto_solicitacoes,public.ponto_decisoes,public.ponto_auditoria to authenticated;
create function public.ponto_agora() returns timestamptz language plpgsql security definer set search_path=public as $$
begin
 if not (tem_acesso_modulo('ponto_meu') or tem_acesso_modulo('ponto_gestao')) then raise exception 'Sem acesso ao ponto.'; end if;
 return clock_timestamp();
end; $$;
create function public.ponto_cadastrar_vinculo(p_usuario uuid,p_nome text,p_cpf text,p_matricula text,p_escala text,p_horarios text,p_convencao text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 if not tem_acesso_modulo('ponto_gestao') then raise exception 'Sem acesso à gestão de ponto.'; end if;
 if not exists(select 1 from perfis where id=p_usuario and ativo) then raise exception 'Colaborador inexistente ou inativo.'; end if;
 insert into ponto_vinculos(usuario_id,nome,cpf,matricula,escala,horarios,convencao,criado_por)
 values(p_usuario,trim(p_nome),regexp_replace(p_cpf,'[^0-9]','','g'),trim(p_matricula),p_escala,trim(p_horarios),trim(p_convencao),auth.uid()) returning id into v_id;
 insert into ponto_auditoria(ator,acao,entidade,dados) values(auth.uid(),'cadastro_vinculo',v_id,jsonb_build_object('escala',p_escala,'horarios',p_horarios,'convencao',p_convencao));
 return v_id;
end; $$;
create function public.ponto_registrar(p_requisicao uuid) returns public.ponto_batidas language plpgsql security definer set search_path=public,extensions as $$
declare v public.ponto_vinculos; b public.ponto_batidas; anterior text; instante_servidor timestamptz; novo_hash text;
begin
 if not tem_acesso_modulo('ponto_meu') then raise exception 'Sem acesso ao registro de ponto.'; end if;
 if p_requisicao is null then raise exception 'Identificador de requisição obrigatório.'; end if;
 -- Serialize a cadeia e reenvios. Não bloqueia batidas por horário, escala ou quantidade.
 perform pg_advisory_xact_lock(62249653000166);
 select * into b from ponto_batidas where usuario_id=auth.uid() and requisicao=p_requisicao;
 if found then return b; end if;
 select * into v from ponto_vinculos where usuario_id=auth.uid() and ativo;
 if not found then raise exception 'Solicite à gestão o cadastro do seu vínculo.'; end if;
 instante_servidor:=clock_timestamp();
 select hash into anterior from ponto_batidas order by numero desc limit 1;
 anterior:=coalesce(anterior,'');
 -- Hash interno de homologação; não é o hash/NSR regulamentar do AFD.
 novo_hash:=encode(digest(convert_to(concat_ws('|',anterior,v.id::text,auth.uid()::text,to_char(instante_servidor at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),p_requisicao::text),'UTF8'),'sha256'),'hex');
 insert into ponto_batidas(vinculo_id,usuario_id,instante,recebido_em,nome,cpf,matricula,requisicao,hash_anterior,hash)
 values(v.id,auth.uid(),instante_servidor,instante_servidor,v.nome,v.cpf,v.matricula,p_requisicao,anterior,novo_hash) returning * into b;
 return b;
end; $$;
create function public.ponto_solicitar(p_tipo text,p_batida uuid,p_instante timestamptz,p_natureza text,p_motivo text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; s_id uuid;
begin
 if not tem_acesso_modulo('ponto_meu') then raise exception 'Sem acesso ao ponto.'; end if;
 select id into v_id from ponto_vinculos where usuario_id=auth.uid() and ativo;
 if v_id is null then raise exception 'Vínculo não cadastrado.'; end if;
 if p_tipo='desconsiderar' and not exists(select 1 from ponto_batidas where id=p_batida and usuario_id=auth.uid() and vinculo_id=v_id) then raise exception 'Batida não pertence ao seu vínculo.'; end if;
 if p_tipo='incluir' and (p_instante>clock_timestamp() or p_instante<(select criado_em from ponto_vinculos where id=v_id)) then raise exception 'A inclusão deve estar entre o cadastro do vínculo e o momento atual.'; end if;
 insert into ponto_solicitacoes(vinculo_id,usuario_id,tipo,batida_id,instante,natureza,motivo)
 values(v_id,auth.uid(),p_tipo,p_batida,p_instante,p_natureza,trim(p_motivo)) returning id into s_id;
 return s_id;
end; $$;
create function public.ponto_decidir(p_solicitacao uuid,p_resultado text,p_motivo text)
returns uuid language plpgsql security definer set search_path=public as $$
declare s public.ponto_solicitacoes; d_id uuid;
begin
 if not tem_acesso_modulo('ponto_gestao') then raise exception 'Sem acesso à gestão de ponto.'; end if;
 select * into s from ponto_solicitacoes where id=p_solicitacao for update;
 if not found then raise exception 'Solicitação inexistente.'; end if;
 if s.usuario_id=auth.uid() then raise exception 'Outro gestor deve decidir seu próprio ajuste.'; end if;
 if exists(select 1 from ponto_decisoes where solicitacao_id=s.id) then raise exception 'Solicitação já decidida.'; end if;
 if p_resultado='aprovado' and s.tipo='desconsiderar' and exists(select 1 from ponto_solicitacoes x join ponto_decisoes d on d.solicitacao_id=x.id where x.batida_id=s.batida_id and d.resultado='aprovado') then raise exception 'Batida já desconsiderada.'; end if;
 insert into ponto_decisoes(solicitacao_id,resultado,motivo,responsavel_id) values(s.id,p_resultado,trim(p_motivo),auth.uid()) returning id into d_id;
 insert into ponto_auditoria(ator,acao,entidade,dados) values(auth.uid(),'decisao_ajuste',s.id,jsonb_build_object('resultado',p_resultado,'motivo',trim(p_motivo)));
 return d_id;
end; $$;
create function public.ponto_colaboradores() returns table(id uuid,nome text) language plpgsql security definer set search_path=public as $$
begin
 if not tem_acesso_modulo('ponto_gestao') then raise exception 'Sem acesso à gestão de ponto.'; end if;
 return query select p.id,p.nome from perfis p where p.ativo order by p.nome,p.id;
end; $$;
revoke execute on function public.ponto_colaboradores() from public,anon;
grant execute on function public.ponto_colaboradores() to authenticated;
revoke execute on function public.ponto_agora(),public.ponto_cadastrar_vinculo(uuid,text,text,text,text,text,text),public.ponto_registrar(uuid),public.ponto_solicitar(text,uuid,timestamptz,text,text),public.ponto_decidir(uuid,text,text) from public,anon;
grant execute on function public.ponto_agora(),public.ponto_cadastrar_vinculo(uuid,text,text,text,text,text,text),public.ponto_registrar(uuid),public.ponto_solicitar(text,uuid,timestamptz,text,text),public.ponto_decidir(uuid,text,text) to authenticated;
commit;
