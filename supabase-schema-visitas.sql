-- Instalar UMA VEZ depois de cargos-unificados. Não depende do módulo de ponto.
begin;
create table public.visitas_postos (
 id uuid primary key default gen_random_uuid(), nome text not null check(length(trim(nome)) between 2 and 100),
 cliente text not null check(length(trim(cliente)) between 2 and 150), endereco text not null check(length(trim(endereco)) between 5 and 300),
 contato text not null default '', telefone text not null default '', servico text not null,
 gerente_id uuid not null references auth.users(id) on delete restrict,
 frequencia_dias integer not null default 7 check(frequencia_dias between 1 and 365),
 janela text not null default '', instrucoes text not null default '',
 checklist jsonb not null check(jsonb_typeof(checklist)='array' and jsonb_array_length(checklist) between 1 and 30),
 ativo boolean not null default true, criado_em timestamptz not null default clock_timestamp()
);
create table public.visitas_agenda (
 id uuid primary key default gen_random_uuid(), posto_id uuid not null references public.visitas_postos(id) on delete restrict,
 gerente_id uuid not null references auth.users(id) on delete restrict, dia date not null, hora time not null,
 duracao integer not null check(duracao between 5 and 480), ordem integer not null check(ordem>0),
 status text not null default 'programada' check(status in ('programada','em_andamento','concluida','reagendada','cancelada')),
 posto_nome text not null, cliente text not null, endereco text not null, contato text not null, telefone text not null,
 servico text not null, janela text not null, instrucoes text not null, checklist jsonb not null,
 respostas jsonb, observacoes text not null default '', conversa_cliente text not null default '', conversa_equipe text not null default '',
 iniciada_em timestamptz, concluida_em timestamptz, motivo text not null default '',
 origem_id uuid references public.visitas_agenda(id) on delete restrict, criada_em timestamptz not null default clock_timestamp(),
 unique(gerente_id,dia,ordem) deferrable initially deferred
);
create index visitas_agenda_gerente_dia on public.visitas_agenda(gerente_id,dia);
create index visitas_agenda_posto on public.visitas_agenda(posto_id,dia);
create table public.visitas_acoes (
 id uuid primary key default gen_random_uuid(), visita_id uuid not null references public.visitas_agenda(id) on delete restrict,
 posto_nome text not null, titulo text not null check(length(trim(titulo)) between 3 and 300),
 responsavel_id uuid not null references auth.users(id) on delete restrict, prazo date not null,
 status text not null default 'aberta' check(status in ('aberta','resolvida')),
 resolucao text not null default '', resolvida_em timestamptz, criada_em timestamptz not null default clock_timestamp()
);
create table public.visitas_fotos (
 id uuid primary key default gen_random_uuid(), visita_id uuid not null references public.visitas_agenda(id) on delete restrict,
 caminho text not null unique, criada_em timestamptz not null default clock_timestamp()
);
create table public.visitas_historico (
 id bigint generated always as identity primary key, visita_id uuid references public.visitas_agenda(id) on delete restrict,
 posto_id uuid references public.visitas_postos(id) on delete restrict,
 ator uuid not null references auth.users(id) on delete restrict, evento text not null, dados jsonb not null,
 criado_em timestamptz not null default clock_timestamp()
);
create function public.visitas_usuario_habilitado(p_id uuid) returns boolean language sql security definer set search_path=public stable as $$
 select exists(select 1 from perfis p where p.id=p_id and p.ativo and (p.papel='admin'
 or exists(select 1 from cargo_modulos cm where cm.cargo_id=p.cargo_id and cm.modulo_id in ('visitas_meu','visitas_gestao'))
 or exists(select 1 from perfil_modulos pm where pm.perfil_id=p.id and pm.modulo_id in ('visitas_meu','visitas_gestao'))));
$$;
create function public.visitas_pode_ler(p_id uuid) returns boolean language sql security definer set search_path=public stable as $$
 select tem_acesso_modulo('visitas_gestao') or (tem_acesso_modulo('visitas_meu') and exists(select 1 from visitas_agenda v where v.id=p_id and v.gerente_id=auth.uid()));
$$;
create function public.visitas_pode_posto(p_id uuid) returns boolean language sql security definer set search_path=public stable as $$
 select tem_acesso_modulo('visitas_gestao') or (tem_acesso_modulo('visitas_meu') and
 (exists(select 1 from visitas_postos p where p.id=p_id and p.gerente_id=auth.uid()) or exists(select 1 from visitas_agenda v where v.posto_id=p_id and v.gerente_id=auth.uid())));
$$;
alter table public.visitas_postos enable row level security;
alter table public.visitas_agenda enable row level security;
alter table public.visitas_acoes enable row level security;
alter table public.visitas_fotos enable row level security;
alter table public.visitas_historico enable row level security;
create policy visitas_postos_le on public.visitas_postos for select to authenticated using(public.visitas_pode_posto(id));
create policy visitas_agenda_le on public.visitas_agenda for select to authenticated using(public.visitas_pode_ler(id));
create policy visitas_acoes_le on public.visitas_acoes for select to authenticated using(tem_acesso_modulo('visitas_gestao') or (tem_acesso_modulo('visitas_meu') and (responsavel_id=auth.uid() or public.visitas_pode_ler(visita_id))));
create policy visitas_fotos_le on public.visitas_fotos for select to authenticated using(public.visitas_pode_ler(visita_id));
create policy visitas_historico_le on public.visitas_historico for select to authenticated using((visita_id is not null and public.visitas_pode_ler(visita_id)) or (visita_id is null and posto_id is not null and public.visitas_pode_posto(posto_id)));
revoke all on public.visitas_postos,public.visitas_agenda,public.visitas_acoes,public.visitas_fotos,public.visitas_historico from anon,authenticated,service_role;
grant select on public.visitas_postos,public.visitas_agenda,public.visitas_acoes,public.visitas_fotos,public.visitas_historico to authenticated;

create function public.visitas_equipe() returns table(id uuid,nome text) language plpgsql security definer set search_path=public as $$
begin
 if not (tem_acesso_modulo('visitas_meu') or tem_acesso_modulo('visitas_gestao')) then raise exception 'Sem acesso às visitas.'; end if;
 return query select p.id,p.nome from perfis p where public.visitas_usuario_habilitado(p.id) order by p.nome,p.id;
end; $$;
create function public.visitas_salvar_posto(p_id uuid,p_dados jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare novo uuid; itens jsonb; item jsonb;
begin
 if not tem_acesso_modulo('visitas_gestao') then raise exception 'Sem acesso à gestão de visitas.'; end if;
 if not public.visitas_usuario_habilitado((p_dados->>'gerente_id')::uuid) then raise exception 'Libere Meu roteiro para o gerente antes de atribuir um posto.'; end if;
 itens:=p_dados->'checklist';
 if jsonb_typeof(itens) is distinct from 'array' or jsonb_array_length(itens) not between 1 and 30 then raise exception 'Informe de 1 a 30 itens no checklist.'; end if;
 for item in select value from jsonb_array_elements(itens) loop
 if jsonb_typeof(item)<>'string' or length(trim(item#>>'{}')) not between 3 and 150 then raise exception 'Cada item precisa de 3 a 150 caracteres.'; end if;
 end loop;
 if p_id is null then
 insert into visitas_postos(nome,cliente,endereco,contato,telefone,servico,gerente_id,frequencia_dias,janela,instrucoes,checklist,ativo)
 values(trim(p_dados->>'nome'),trim(p_dados->>'cliente'),trim(p_dados->>'endereco'),coalesce(p_dados->>'contato',''),coalesce(p_dados->>'telefone',''),p_dados->>'servico',(p_dados->>'gerente_id')::uuid,(p_dados->>'frequencia_dias')::integer,coalesce(p_dados->>'janela',''),coalesce(p_dados->>'instrucoes',''),itens,coalesce((p_dados->>'ativo')::boolean,true)) returning id into novo;
 else
 update visitas_postos set nome=trim(p_dados->>'nome'),cliente=trim(p_dados->>'cliente'),endereco=trim(p_dados->>'endereco'),contato=coalesce(p_dados->>'contato',''),telefone=coalesce(p_dados->>'telefone',''),servico=p_dados->>'servico',gerente_id=(p_dados->>'gerente_id')::uuid,frequencia_dias=(p_dados->>'frequencia_dias')::integer,janela=coalesce(p_dados->>'janela',''),instrucoes=coalesce(p_dados->>'instrucoes',''),checklist=itens,ativo=coalesce((p_dados->>'ativo')::boolean,true) where id=p_id returning id into novo;
 if novo is null then raise exception 'Posto não encontrado.'; end if;
 end if;
 insert into visitas_historico(posto_id,ator,evento,dados) values(novo,auth.uid(),case when p_id is null then 'posto_cadastrado' else 'posto_atualizado' end,p_dados);
 return novo;
end; $$;

create function public.visitas_planejar(p_gerente uuid,p_dia date,p_itens jsonb) returns integer language plpgsql security definer set search_path=public as $$
declare p visitas_postos; item jsonb; n integer:=0; pos integer; v_id uuid;
begin
 if not tem_acesso_modulo('visitas_gestao') then raise exception 'Sem acesso à gestão de visitas.'; end if;
 if p_dia is null or not public.visitas_usuario_habilitado(p_gerente) then raise exception 'Data ou gerente inválido.'; end if;
 if jsonb_typeof(p_itens) is distinct from 'array' or jsonb_array_length(p_itens) not between 1 and 30 then raise exception 'Selecione de 1 a 30 postos.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_gerente::text||p_dia::text,0));
 select coalesce(max(ordem),0) into pos from visitas_agenda where gerente_id=p_gerente and dia=p_dia;
 for item in select value from jsonb_array_elements(p_itens) loop
 select * into p from visitas_postos where id=(item->>'posto_id')::uuid and ativo;
 if not found then raise exception 'Posto inválido ou inativo.'; end if;
 if exists(select 1 from visitas_agenda where posto_id=p.id and dia=p_dia and status in ('programada','em_andamento','concluida')) then raise exception 'Já existe visita deste posto no dia selecionado.'; end if;
 if (item->>'hora')::time + make_interval(mins=>(item->>'duracao')::integer) > time '23:59:59' then raise exception 'A duração prevista ultrapassa o dia. Divida a visita.'; end if;
 if exists(select 1 from visitas_agenda v where gerente_id=p_gerente and dia=p_dia and status in ('programada','em_andamento') and
 (p_dia+v.hora,p_dia+v.hora+make_interval(mins=>v.duracao)) overlaps (p_dia+(item->>'hora')::time,p_dia+(item->>'hora')::time+make_interval(mins=>(item->>'duracao')::integer))) then raise exception 'Há sobreposição de horários neste roteiro.'; end if;
 pos:=pos+1;
 insert into visitas_agenda(posto_id,gerente_id,dia,hora,duracao,ordem,posto_nome,cliente,endereco,contato,telefone,servico,janela,instrucoes,checklist)
 values(p.id,p_gerente,p_dia,(item->>'hora')::time,(item->>'duracao')::integer,pos,p.nome,p.cliente,p.endereco,p.contato,p.telefone,p.servico,p.janela,p.instrucoes,p.checklist) returning id into v_id;
 insert into visitas_historico(visita_id,posto_id,ator,evento,dados) values(v_id,p.id,auth.uid(),'programada',item||jsonb_build_object('dia',p_dia,'gerente',p_gerente));
 n:=n+1;
 end loop; return n;
end; $$;

create function public.visitas_iniciar(p_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare v visitas_agenda;
begin
 select * into v from visitas_agenda where id=p_id for update;
 if not found or v.gerente_id<>auth.uid() or not (tem_acesso_modulo('visitas_meu') or tem_acesso_modulo('visitas_gestao')) then raise exception 'Somente o gerente designado pode executar esta visita.'; end if;
 if v.status='em_andamento' then return; end if;
 if v.status<>'programada' then raise exception 'Esta visita não pode ser iniciada.'; end if;
 if exists(select 1 from visitas_agenda where gerente_id=auth.uid() and status='em_andamento') then raise exception 'Conclua sua visita em andamento antes de iniciar outra.'; end if;
 -- Trava por gerente: impede dois inícios simultâneos em visitas diferentes.
 perform pg_advisory_xact_lock(hashtextextended('execucao'||auth.uid()::text,0));
 if exists(select 1 from visitas_agenda where gerente_id=auth.uid() and status='em_andamento') then raise exception 'Você já tem uma visita em andamento.'; end if;
 update visitas_agenda set status='em_andamento',iniciada_em=clock_timestamp() where id=p_id;
 insert into visitas_historico(visita_id,ator,evento,dados) values(p_id,auth.uid(),'iniciada','{}');
end; $$;
create function public.visitas_concluir(p_id uuid,p_respostas jsonb,p_observacoes text,p_cliente text,p_equipe text,p_prazo date) returns void language plpgsql security definer set search_path=public as $$
declare v visitas_agenda; r jsonb; i integer:=0;
begin
 select * into v from visitas_agenda where id=p_id for update;
 if not found or v.gerente_id<>auth.uid() or not (tem_acesso_modulo('visitas_meu') or tem_acesso_modulo('visitas_gestao')) then raise exception 'Somente o gerente designado pode concluir.'; end if;
 if v.status<>'em_andamento' then raise exception 'A visita precisa estar em andamento.'; end if;
 if jsonb_typeof(p_respostas) is distinct from 'array' or jsonb_array_length(p_respostas)<>jsonb_array_length(v.checklist) then raise exception 'Preencha todo o checklist.'; end if;
 for r in select value from jsonb_array_elements(p_respostas) loop
 if coalesce(r->>'status','') not in ('conforme','pendente','nao_aplica') then raise exception 'Resposta inválida no checklist.'; end if;
 if length(coalesce(r->>'nota',''))>1000 then raise exception 'Observação do item muito longa.'; end if;
 if r->>'status'='pendente' then
 if length(trim(coalesce(r->>'nota','')))<3 or p_prazo is null or p_prazo<(clock_timestamp() at time zone 'America/Sao_Paulo')::date then raise exception 'Itens pendentes precisam de descrição e prazo válido.'; end if;
 insert into visitas_acoes(visita_id,posto_nome,titulo,responsavel_id,prazo) values(v.id,v.posto_nome,left((v.checklist->>i)||': '||(r->>'nota'),300),v.gerente_id,p_prazo);
 end if; i:=i+1;
 end loop;
 if greatest(length(p_observacoes),length(p_cliente),length(p_equipe))>5000 then raise exception 'Cada texto admite até 5000 caracteres.'; end if;
 update visitas_agenda set status='concluida',respostas=p_respostas,observacoes=coalesce(p_observacoes,''),conversa_cliente=coalesce(p_cliente,''),conversa_equipe=coalesce(p_equipe,''),concluida_em=clock_timestamp() where id=p_id;
 insert into visitas_historico(visita_id,ator,evento,dados) values(p_id,auth.uid(),'concluida',jsonb_build_object('respostas',p_respostas));
end; $$;

create function public.visitas_reagendar(p_id uuid,p_dia date,p_hora time,p_motivo text,p_cancelar boolean default false) returns uuid language plpgsql security definer set search_path=public as $$
declare v visitas_agenda; nova uuid; pos integer;
begin
 select * into v from visitas_agenda where id=p_id for update;
 if not found or not public.visitas_pode_ler(p_id) then raise exception 'Sem acesso à visita.'; end if;
 if v.status<>'programada' then raise exception 'Somente visitas programadas podem ser reagendadas ou canceladas.'; end if;
 if length(trim(p_motivo)) not between 5 and 500 then raise exception 'Informe um motivo de 5 a 500 caracteres.'; end if;
 if p_cancelar and not tem_acesso_modulo('visitas_gestao') then raise exception 'Somente a gestão pode cancelar.'; end if;
 if not p_cancelar then
 if p_dia is null or p_hora is null then raise exception 'Informe data e horário.'; end if;
 if p_dia=v.dia and p_hora=v.hora then raise exception 'Escolha uma nova data ou horário.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v.gerente_id::text||p_dia::text,0));
 if exists(select 1 from visitas_agenda where posto_id=v.posto_id and dia=p_dia and id<>v.id and status in ('programada','em_andamento','concluida')) then raise exception 'Já existe visita desse posto nesta data.'; end if;
 if (p_dia+p_hora+make_interval(mins=>v.duracao))::date<>p_dia then raise exception 'A duração ultrapassa o dia.'; end if;
 if exists(select 1 from visitas_agenda x where x.gerente_id=v.gerente_id and x.dia=p_dia and x.id<>v.id and x.status in ('programada','em_andamento') and (p_dia+x.hora,p_dia+x.hora+make_interval(mins=>x.duracao)) overlaps (p_dia+p_hora,p_dia+p_hora+make_interval(mins=>v.duracao))) then raise exception 'Há sobreposição de horários.'; end if;
 select coalesce(max(ordem),0)+1 into pos from visitas_agenda where gerente_id=v.gerente_id and dia=p_dia;
 insert into visitas_agenda(posto_id,gerente_id,dia,hora,duracao,ordem,posto_nome,cliente,endereco,contato,telefone,servico,janela,instrucoes,checklist,origem_id)
 values(v.posto_id,v.gerente_id,p_dia,p_hora,v.duracao,pos,v.posto_nome,v.cliente,v.endereco,v.contato,v.telefone,v.servico,v.janela,v.instrucoes,v.checklist,v.id) returning id into nova;
 insert into visitas_historico(visita_id,ator,evento,dados) values(nova,auth.uid(),'criada_por_reagendamento',jsonb_build_object('origem',v.id));
 end if;
 update visitas_agenda set status=case when p_cancelar then 'cancelada' else 'reagendada' end,motivo=trim(p_motivo) where id=v.id;
 insert into visitas_historico(visita_id,ator,evento,dados) values(v.id,auth.uid(),case when p_cancelar then 'cancelada' else 'reagendada' end,jsonb_build_object('motivo',p_motivo,'nova_visita',nova));
 return nova;
end; $$;
create function public.visitas_ordenar(p_id uuid,p_outro uuid) returns void language plpgsql security definer set search_path=public as $$
declare v visitas_agenda; x visitas_agenda;
begin
 select * into v from visitas_agenda where id=p_id;
 if not found or not public.visitas_pode_ler(p_id) then raise exception 'Sem acesso ao roteiro.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v.gerente_id::text||v.dia::text,0));
 select * into v from visitas_agenda where id=p_id for update;
 select * into x from visitas_agenda where id=p_outro for update;
 if not found or x.gerente_id<>v.gerente_id or x.dia<>v.dia or v.id=x.id then raise exception 'As visitas devem pertencer ao mesmo roteiro.'; end if;
 if v.status<>'programada' or x.status<>'programada' then raise exception 'Reordene apenas visitas ainda programadas.'; end if;
 update visitas_agenda set ordem=case when id=v.id then x.ordem else v.ordem end where id in (v.id,x.id);
 insert into visitas_historico(visita_id,ator,evento,dados) values(v.id,auth.uid(),'ordem_alterada',jsonb_build_object('trocada_com',x.id));
end; $$;
create function public.visitas_acao(p_id uuid,p_visita uuid,p_titulo text,p_responsavel uuid,p_prazo date,p_resolucao text) returns uuid language plpgsql security definer set search_path=public as $$
declare v visitas_agenda; a visitas_acoes; novo uuid;
begin
 if p_id is not null then
 select * into a from visitas_acoes where id=p_id for update;
 if not found or not (tem_acesso_modulo('visitas_gestao') or (tem_acesso_modulo('visitas_meu') and a.responsavel_id=auth.uid())) then raise exception 'Somente o responsável ou a gestão pode resolver.'; end if;
 if a.status<>'aberta' then raise exception 'Ação já resolvida.'; end if;
 if length(trim(p_resolucao)) not between 5 and 2000 then raise exception 'Descreva a resolução.'; end if;
 update visitas_acoes set status='resolvida',resolucao=trim(p_resolucao),resolvida_em=clock_timestamp() where id=a.id;
 insert into visitas_historico(visita_id,ator,evento,dados) values(a.visita_id,auth.uid(),'acao_resolvida',jsonb_build_object('acao',a.id,'resolucao',p_resolucao));
 return a.id;
 end if;
 select * into v from visitas_agenda where id=p_visita;
 if not found or not public.visitas_pode_ler(v.id) or v.status not in ('em_andamento','concluida') then raise exception 'Selecione uma visita iniciada ou concluída.'; end if;
 if not public.visitas_usuario_habilitado(p_responsavel) or p_prazo is null then raise exception 'Responsável ou prazo inválido.'; end if;
 insert into visitas_acoes(visita_id,posto_nome,titulo,responsavel_id,prazo) values(v.id,v.posto_nome,trim(p_titulo),p_responsavel,p_prazo) returning id into novo;
 insert into visitas_historico(visita_id,ator,evento,dados) values(v.id,auth.uid(),'acao_criada',jsonb_build_object('acao',novo,'titulo',p_titulo,'responsavel',p_responsavel,'prazo',p_prazo));
 return novo;
end; $$;

-- Fotos opcionais: bucket privado, limite por arquivo de 5 MB. Nenhum rastreamento de localização.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('visitas-fotos','visitas-fotos',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create function public.visitas_foto_acesso(p_caminho text,p_escrita boolean) returns boolean language plpgsql security definer set search_path=public as $$
declare v visitas_agenda; pedacos text[];
begin
 pedacos:=string_to_array(p_caminho,'/');
 if cardinality(pedacos)<>2 or pedacos[1] !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
 select * into v from visitas_agenda where id=pedacos[1]::uuid;
 if not found then return false; end if;
 if p_escrita then return v.gerente_id=auth.uid() and v.status='em_andamento' and (tem_acesso_modulo('visitas_meu') or tem_acesso_modulo('visitas_gestao')); end if;
 return public.visitas_pode_ler(v.id);
end; $$;
create policy visitas_storage_le on storage.objects for select to authenticated using(bucket_id='visitas-fotos' and public.visitas_foto_acesso(name,false));
create policy visitas_storage_insere on storage.objects for insert to authenticated with check(bucket_id='visitas-fotos' and public.visitas_foto_acesso(name,true));
create policy visitas_storage_limpa on storage.objects for delete to authenticated using(bucket_id='visitas-fotos' and public.visitas_foto_acesso(name,true) and not exists(select 1 from public.visitas_fotos f where f.caminho=name));
create function public.visitas_anexar_foto(p_visita uuid,p_caminho text) returns uuid language plpgsql security definer set search_path=public as $$
declare novo uuid; v visitas_agenda;
begin
 select * into v from visitas_agenda where id=p_visita for update;
 if not found or not public.visitas_foto_acesso(p_caminho,true) or split_part(p_caminho,'/',1)<>p_visita::text then raise exception 'Sem acesso à foto desta visita.'; end if;
 if (select count(*) from visitas_fotos where visita_id=p_visita)>=5 then raise exception 'Limite de 5 fotos por visita.'; end if;
 if not exists(select 1 from storage.objects where bucket_id='visitas-fotos' and name=p_caminho) then raise exception 'Arquivo não enviado.'; end if;
 insert into visitas_fotos(visita_id,caminho) values(p_visita,p_caminho) returning id into novo;
 insert into visitas_historico(visita_id,ator,evento,dados) values(p_visita,auth.uid(),'foto_anexada',jsonb_build_object('foto',novo));
 return novo;
end; $$;
-- Histórico nunca é editado por clientes. Relatórios concluídos não possuem RPC de alteração.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'visitas_%' loop
 execute format('revoke execute on function %s from public,anon',f.assinatura);
 execute format('grant execute on function %s to authenticated',f.assinatura);
 end loop;
end; $$;
commit;
