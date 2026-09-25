-- Rode este script no SQL Editor do Supabase (SQL Editor > New query > cole tudo > Run),
-- DEPOIS do supabase-schema.sql, do supabase-schema-permissoes.sql e do supabase-schema-usuarios.sql.
-- Pode rodar mais de uma vez sem problema. Se você já tinha rodado a versão anterior deste arquivo
-- (uniformes sem cargo), rode de novo: ele ATUALIZA o que já existe e não apaga pedidos nem assinaturas.
--
-- O que ele cria (ferramentas "Solicitar uniforme e EPI" e "Solicitações de uniforme e EPI"):
--   uniforme_tipos          -> o catálogo de itens: uniformes (camiseta, calça...) e EPIs (luva, bota...), com tamanhos
--   cargos                  -> os cargos da empresa (Auxiliar de serviços gerais, Jardineiro, Zelador...)
--   cargo_itens             -> o KIT de cada cargo: quais itens e a quantidade MÁXIMA de cada um por pedido
--   perfis.cargo_id         -> o cargo de cada pessoa (definido na tela "Usuários")
--   uniforme_pedidos        -> 1 linha por solicitação (quem pediu, cargo, status, observação, resposta do responsável)
--   uniforme_itens          -> os itens de cada pedido (item, tamanho, quantidade) e se já foram recebidos
--   uniforme_recebimentos   -> cada confirmação de recebimento: foto do rosto, local, data e hora
--   bucket "uniforme-assinaturas" (PRIVADO) -> onde ficam as fotos das assinaturas
--   2 funções (uniforme_criar_pedido e uniforme_confirmar_recebimento) que validam tudo no servidor
--
-- Quem acessa o quê é decidido na tela "Usuários" do site, com os ids de ferramenta:
--   uniforme_solicitar -> pode pedir o kit do próprio cargo e confirmar o recebimento dos próprios pedidos
--   uniforme_gestao    -> é o responsável: vê todos os pedidos, atende/recusa e edita itens, cargos e kits
-- (admin tem os dois automaticamente)

-- 1) Tabelas ---------------------------------------------------------------------------------------
create table if not exists uniforme_tipos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  tamanhos text[] not null default '{}',   -- lista vazia = tamanho único
  ativo boolean not null default true,
  ordem int not null default 0,
  criado_em timestamptz not null default now()
);
-- novidade: cada item é "uniforme" ou "epi"
alter table uniforme_tipos add column if not exists categoria text not null default 'uniforme'
  check (categoria in ('uniforme', 'epi'));

create table if not exists cargos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists cargo_itens (
  cargo_id uuid not null references cargos(id) on delete cascade,
  tipo_id uuid not null references uniforme_tipos(id) on delete cascade,
  quantidade int not null default 1 check (quantidade between 1 and 99),
  primary key (cargo_id, tipo_id)
);

-- o cargo de cada pessoa (quem define é o admin, na tela "Usuários")
alter table perfis add column if not exists cargo_id uuid references cargos(id) on delete set null;

create table if not exists uniforme_pedidos (
  id uuid primary key default gen_random_uuid(),
  solicitante_id uuid references auth.users(id) on delete set null,
  solicitante_nome text not null default '',
  status text not null default 'pendente'
    check (status in ('pendente','pronto','parcial','concluido','recusado','cancelado')),
  observacao text not null default '',
  resposta text not null default '',          -- mensagem do responsável (motivo da recusa, onde retirar...)
  respondido_por uuid references auth.users(id) on delete set null,
  respondido_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table uniforme_pedidos add column if not exists cargo_nome text not null default '';  -- cargo na hora do pedido

create table if not exists uniforme_recebimentos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references uniforme_pedidos(id) on delete cascade,
  usuario_id uuid references auth.users(id) on delete set null,
  foto_path text not null,                    -- caminho no bucket "uniforme-assinaturas"
  metodo text not null default 'camera' check (metodo in ('camera','arquivo')),
  latitude double precision,
  longitude double precision,
  precisao_m real,
  local_texto text not null default '',
  capturado_em timestamptz,                   -- relógio do aparelho (só informativo)
  criado_em timestamptz not null default now() -- hora do SERVIDOR: é a que vale
);

create table if not exists uniforme_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references uniforme_pedidos(id) on delete cascade,
  tipo_id uuid references uniforme_tipos(id) on delete set null,
  tipo_nome text not null,                    -- cópia do nome: o histórico não muda se o item for renomeado/apagado
  tamanho text not null default '',
  quantidade int not null check (quantidade between 1 and 99),
  observacao text not null default '',
  recebimento_id uuid references uniforme_recebimentos(id) on delete set null,
  recebido_em timestamptz
);
alter table uniforme_itens add column if not exists categoria text not null default 'uniforme'
  check (categoria in ('uniforme', 'epi'));

create index if not exists uniforme_pedidos_solicitante_idx on uniforme_pedidos (solicitante_id);
create index if not exists uniforme_pedidos_status_idx on uniforme_pedidos (status);
create index if not exists uniforme_itens_pedido_idx on uniforme_itens (pedido_id);
create index if not exists uniforme_recebimentos_pedido_idx on uniforme_recebimentos (pedido_id);
create index if not exists cargo_itens_tipo_idx on cargo_itens (tipo_id);

create or replace function uniforme_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists uniforme_pedidos_atualizado on uniforme_pedidos;
create trigger uniforme_pedidos_atualizado
  before update on uniforme_pedidos
  for each row execute function uniforme_atualizado_em();

-- 2) Segurança (RLS) ---------------------------------------------------------------------------------
alter table uniforme_tipos        enable row level security;
alter table cargos                enable row level security;
alter table cargo_itens           enable row level security;
alter table uniforme_pedidos      enable row level security;
alter table uniforme_itens        enable row level security;
alter table uniforme_recebimentos enable row level security;

-- Itens, cargos e kits: quem solicita ou gerencia enxerga; só o responsável (uniforme_gestao) ou admin edita
drop policy if exists "uniforme tipos leitura" on uniforme_tipos;
create policy "uniforme tipos leitura" on uniforme_tipos for select
  using (tem_acesso_modulo('uniforme_solicitar') or tem_acesso_modulo('uniforme_gestao'));
drop policy if exists "uniforme tipos insere" on uniforme_tipos;
create policy "uniforme tipos insere" on uniforme_tipos for insert
  with check (tem_acesso_modulo('uniforme_gestao'));
drop policy if exists "uniforme tipos atualiza" on uniforme_tipos;
create policy "uniforme tipos atualiza" on uniforme_tipos for update
  using (tem_acesso_modulo('uniforme_gestao')) with check (tem_acesso_modulo('uniforme_gestao'));
drop policy if exists "uniforme tipos apaga" on uniforme_tipos;
create policy "uniforme tipos apaga" on uniforme_tipos for delete
  using (tem_acesso_modulo('uniforme_gestao'));

drop policy if exists "uniforme cargos leitura" on cargos;
create policy "uniforme cargos leitura" on cargos for select
  using (tem_acesso_modulo('uniforme_solicitar') or tem_acesso_modulo('uniforme_gestao'));
drop policy if exists "uniforme cargos insere" on cargos;
create policy "uniforme cargos insere" on cargos for insert
  with check (tem_acesso_modulo('uniforme_gestao'));
drop policy if exists "uniforme cargos atualiza" on cargos;
create policy "uniforme cargos atualiza" on cargos for update
  using (tem_acesso_modulo('uniforme_gestao')) with check (tem_acesso_modulo('uniforme_gestao'));
drop policy if exists "uniforme cargos apaga" on cargos;
create policy "uniforme cargos apaga" on cargos for delete
  using (tem_acesso_modulo('uniforme_gestao'));

drop policy if exists "uniforme kits leitura" on cargo_itens;
create policy "uniforme kits leitura" on cargo_itens for select
  using (tem_acesso_modulo('uniforme_solicitar') or tem_acesso_modulo('uniforme_gestao'));
drop policy if exists "uniforme kits insere" on cargo_itens;
create policy "uniforme kits insere" on cargo_itens for insert
  with check (tem_acesso_modulo('uniforme_gestao'));
drop policy if exists "uniforme kits atualiza" on cargo_itens;
create policy "uniforme kits atualiza" on cargo_itens for update
  using (tem_acesso_modulo('uniforme_gestao')) with check (tem_acesso_modulo('uniforme_gestao'));
drop policy if exists "uniforme kits apaga" on cargo_itens;
create policy "uniforme kits apaga" on cargo_itens for delete
  using (tem_acesso_modulo('uniforme_gestao'));

-- Pedidos: cada pessoa vê os próprios; o responsável vê todos.
-- Criar pedido e confirmar recebimento só pelas funções lá embaixo (não há insert direto).
drop policy if exists "uniforme pedidos leitura" on uniforme_pedidos;
create policy "uniforme pedidos leitura" on uniforme_pedidos for select
  using (
    (solicitante_id = auth.uid() and tem_acesso_modulo('uniforme_solicitar'))
    or tem_acesso_modulo('uniforme_gestao')
  );
drop policy if exists "uniforme pedidos gestao atualiza" on uniforme_pedidos;
create policy "uniforme pedidos gestao atualiza" on uniforme_pedidos for update
  using (tem_acesso_modulo('uniforme_gestao')) with check (tem_acesso_modulo('uniforme_gestao'));
-- quem pediu só consegue CANCELAR, e só enquanto o pedido está pendente
drop policy if exists "uniforme pedidos solicitante cancela" on uniforme_pedidos;
create policy "uniforme pedidos solicitante cancela" on uniforme_pedidos for update
  using (solicitante_id = auth.uid() and status = 'pendente' and tem_acesso_modulo('uniforme_solicitar'))
  with check (solicitante_id = auth.uid() and status = 'cancelado');

-- Itens e recebimentos: só leitura, e só de pedidos que a pessoa já pode ver
drop policy if exists "uniforme itens leitura" on uniforme_itens;
create policy "uniforme itens leitura" on uniforme_itens for select
  using (exists (select 1 from uniforme_pedidos p where p.id = uniforme_itens.pedido_id));

drop policy if exists "uniforme recebimentos leitura" on uniforme_recebimentos;
create policy "uniforme recebimentos leitura" on uniforme_recebimentos for select
  using (exists (select 1 from uniforme_pedidos p where p.id = uniforme_recebimentos.pedido_id));

-- 3) Função: criar pedido ---------------------------------------------------------------------------
-- A pessoa NÃO escolhe os itens (esses vêm do kit do cargo dela), mas escolhe, para cada item do kit, o
-- tamanho (p_tamanhos = {"<id do item>": "M", ...}) e a quantidade que precisa (p_quantidades =
-- {"<id do item>": 2, ...}), até o limite cadastrado no kit do cargo (cargo_itens.quantidade = máximo
-- permitido por item). Item sem quantidade informada é ignorado (não entra no pedido); item que tem
-- tamanhos e ficou sem tamanho escolhido também é ignorado. Se sobrar nenhum item, o pedido é recusado.
-- (a versão anterior recebia só os tamanhos, com quantidade fixa do kit; por isso apagamos a antiga)
drop function if exists uniforme_criar_pedido(text, jsonb);
drop function if exists uniforme_criar_pedido(text, jsonb, jsonb);

create function uniforme_criar_pedido(p_observacao text, p_tamanhos jsonb, p_quantidades jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_nome text;
  v_cargo_id uuid;
  v_cargo_nome text;
  v_pedido uuid;
  v_mapa jsonb := coalesce(case when jsonb_typeof(p_tamanhos) = 'object' then p_tamanhos end, '{}'::jsonb);
  v_mapa_qtd jsonb := coalesce(case when jsonb_typeof(p_quantidades) = 'object' then p_quantidades end, '{}'::jsonb);
  r record;
  v_tam text;
  v_qtd_txt text;
  v_qtd int;
  v_itens int := 0;
begin
  if v_uid is null or not tem_acesso_modulo('uniforme_solicitar') then
    raise exception 'Você não tem permissão para solicitar uniforme e EPI.';
  end if;

  select pf.cargo_id, coalesce(nullif(pf.nome, ''), u.email) into v_cargo_id, v_nome
    from perfis pf join auth.users u on u.id = pf.id where pf.id = v_uid;

  if v_cargo_id is null then
    raise exception 'Seu cargo ainda não foi definido. Fale com o administrador.';
  end if;
  select nome into v_cargo_nome from cargos where id = v_cargo_id and ativo;
  if not found then
    raise exception 'O cargo do seu perfil está desativado. Fale com o administrador.';
  end if;
  if not exists (
    select 1 from cargo_itens ci join uniforme_tipos t on t.id = ci.tipo_id and t.ativo where ci.cargo_id = v_cargo_id
  ) then
    raise exception 'O kit do seu cargo ainda não foi cadastrado. Fale com o responsável.';
  end if;
  if exists (select 1 from uniforme_pedidos where solicitante_id = v_uid and status = 'pendente') then
    raise exception 'Você já tem um pedido aguardando atendimento.';
  end if;

  insert into uniforme_pedidos (solicitante_id, solicitante_nome, cargo_nome, observacao)
    values (v_uid, coalesce(v_nome, ''), v_cargo_nome, left(coalesce(p_observacao, ''), 500))
    returning id into v_pedido;

  for r in
    select t.id, t.nome, t.categoria, t.tamanhos, ci.quantidade as qtd_max
      from cargo_itens ci join uniforme_tipos t on t.id = ci.tipo_id
      where ci.cargo_id = v_cargo_id and t.ativo
      order by (t.categoria = 'epi'), t.ordem, t.nome
  loop
    if array_length(r.tamanhos, 1) is null then
      v_tam := 'Único';
    else
      v_tam := coalesce(v_mapa ->> (r.id::text), '');
      if v_tam = '' then
        continue;   -- sem tamanho escolhido: o item fica de fora do pedido
      end if;
      if not (v_tam = any(r.tamanhos)) then
        raise exception 'O tamanho escolhido para % não é válido. Atualize a página e escolha de novo.', r.nome;
      end if;
    end if;

    v_qtd_txt := v_mapa_qtd ->> (r.id::text);
    if v_qtd_txt is null or trim(v_qtd_txt) = '' then
      continue;   -- sem quantidade informada: o item fica de fora do pedido
    end if;
    if v_qtd_txt !~ '^[0-9]+$' then
      raise exception 'A quantidade informada para % é inválida.', r.nome;
    end if;
    v_qtd := v_qtd_txt::int;
    if v_qtd < 1 or v_qtd > r.qtd_max then
      raise exception 'A quantidade de % deve ser entre 1 e %.', r.nome, r.qtd_max;
    end if;

    insert into uniforme_itens (pedido_id, tipo_id, tipo_nome, categoria, tamanho, quantidade)
      values (v_pedido, r.id, r.nome, r.categoria, v_tam, v_qtd);
    v_itens := v_itens + 1;
  end loop;

  if v_itens = 0 then
    raise exception 'Informe a quantidade de pelo menos um item para fazer o pedido.';
  end if;

  return v_pedido;
end;
$$;

-- 4) Função: confirmar recebimento (assinatura por foto + local; a hora que vale é a do servidor) ------
create or replace function uniforme_confirmar_recebimento(
  p_pedido uuid,
  p_itens uuid[],
  p_foto_path text,
  p_metodo text,
  p_lat double precision,
  p_lng double precision,
  p_precisao real,
  p_local text,
  p_capturado_em timestamptz
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ped uniforme_pedidos%rowtype;
  v_rec uuid;
  v_validos int;
  v_distintos int;
  v_restantes int;
begin
  if v_uid is null or not tem_acesso_modulo('uniforme_solicitar') then
    raise exception 'Você não tem permissão para confirmar recebimentos.';
  end if;

  select * into v_ped from uniforme_pedidos where id = p_pedido for update;
  if not found or v_ped.solicitante_id is distinct from v_uid then
    raise exception 'Pedido não encontrado.';
  end if;
  if v_ped.status not in ('pronto', 'parcial') then
    raise exception 'Este pedido ainda não foi liberado para retirada.';
  end if;

  if p_itens is null or coalesce(array_length(p_itens, 1), 0) = 0 then
    raise exception 'Selecione pelo menos um item recebido.';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'A localização é obrigatória para assinar.';
  end if;
  if p_foto_path is null or p_foto_path not like (v_uid::text || '/%') then
    raise exception 'Foto de assinatura inválida.';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'uniforme-assinaturas' and name = p_foto_path) then
    raise exception 'A foto não foi enviada. Tente de novo.';
  end if;

  select count(*) into v_validos from uniforme_itens
    where pedido_id = p_pedido and id = any(p_itens) and recebimento_id is null;
  select count(distinct x) into v_distintos from unnest(p_itens) x;
  if v_validos <> v_distintos then
    raise exception 'Algum item selecionado é inválido ou já foi recebido. Atualize a página.';
  end if;

  insert into uniforme_recebimentos
    (pedido_id, usuario_id, foto_path, metodo, latitude, longitude, precisao_m, local_texto, capturado_em)
    values (
      p_pedido, v_uid, p_foto_path,
      case when p_metodo = 'arquivo' then 'arquivo' else 'camera' end,
      p_lat, p_lng, p_precisao, left(coalesce(p_local, ''), 300), p_capturado_em
    )
    returning id into v_rec;

  update uniforme_itens set recebimento_id = v_rec, recebido_em = now()
    where pedido_id = p_pedido and id = any(p_itens) and recebimento_id is null;

  select count(*) into v_restantes from uniforme_itens where pedido_id = p_pedido and recebimento_id is null;
  update uniforme_pedidos
    set status = case when v_restantes = 0 then 'concluido' else 'parcial' end
    where id = p_pedido;

  return v_rec;
end;
$$;

revoke all on function uniforme_criar_pedido(text, jsonb, jsonb) from public, anon;
grant execute on function uniforme_criar_pedido(text, jsonb, jsonb) to authenticated;
revoke all on function uniforme_confirmar_recebimento(uuid, uuid[], text, text, double precision, double precision, real, text, timestamptz) from public, anon;
grant execute on function uniforme_confirmar_recebimento(uuid, uuid[], text, text, double precision, double precision, real, text, timestamptz) to authenticated;

-- 5) Bucket PRIVADO das fotos de assinatura ------------------------------------------------------------
-- Foto do rosto é dado pessoal: o bucket NÃO é público. O site abre as fotos por links temporários (1 hora).
insert into storage.buckets (id, name, public)
  values ('uniforme-assinaturas', 'uniforme-assinaturas', false)
  on conflict (id) do update set public = false;

-- cada pessoa envia só para a própria pasta (<id da pessoa>/arquivo.jpg); não há política de apagar/editar,
-- então uma assinatura já enviada não pode ser removida ou trocada por quem assinou
drop policy if exists "uniforme assinaturas envia" on storage.objects;
create policy "uniforme assinaturas envia" on storage.objects for insert
  with check (
    bucket_id = 'uniforme-assinaturas'
    and tem_acesso_modulo('uniforme_solicitar')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "uniforme assinaturas leitura" on storage.objects;
create policy "uniforme assinaturas leitura" on storage.objects for select
  using (
    bucket_id = 'uniforme-assinaturas'
    and ((storage.foldername(name))[1] = auth.uid()::text or tem_acesso_modulo('uniforme_gestao'))
  );

-- 6) Avisos em tempo real (o responsável vê a solicitação nova na hora) ------------------------------------
do $$
begin
  alter publication supabase_realtime add table uniforme_pedidos;
exception
  when duplicate_object then null;   -- já estava na publicação
  when undefined_object then null;   -- projeto sem Realtime: o site atualiza sozinho a cada 2 minutos
end
$$;

-- 7) Dados iniciais (só na primeira vez, enquanto não existir nenhum cargo) ------------------------------
-- São EXEMPLOS para você ver o sistema funcionando: confira e ajuste os itens, as quantidades e os EPIs de
-- cada cargo dentro do site (aba "Cargos e kits") de acordo com a realidade e as normas da empresa.
do $$
declare
  v_aux uuid;
  v_jar uuid;
  v_zel uuid;
begin
  if exists (select 1 from cargos) then
    return;
  end if;

  insert into uniforme_tipos (nome, categoria, tamanhos, ordem) values
    ('Camiseta',            'uniforme', '{PP,P,M,G,GG,XG}', 1),
    ('Calça',               'uniforme', '{36,38,40,42,44,46,48,50,52}', 2),
    ('Sapato',              'uniforme', '{34,35,36,37,38,39,40,41,42,43,44,45,46}', 3),
    ('Bata',                'uniforme', '{PP,P,M,G,GG,XG}', 4),
    ('Jaqueta',             'uniforme', '{PP,P,M,G,GG,XG}', 5),
    ('Boné',                'uniforme', '{}', 6),
    ('Bota de borracha',    'epi',      '{34,35,36,37,38,39,40,41,42,43,44,45,46}', 20),
    ('Botina de segurança', 'epi',      '{34,35,36,37,38,39,40,41,42,43,44,45,46}', 21),
    ('Luva nitrílica',      'epi',      '{P,M,G,GG}', 22),
    ('Luva de proteção',    'epi',      '{P,M,G,GG}', 23),
    ('Óculos de proteção',  'epi',      '{}', 24),
    ('Protetor auricular',  'epi',      '{}', 25)
  on conflict (nome) do nothing;

  insert into cargos (nome) values ('Auxiliar de serviços gerais'), ('Jardineiro'), ('Zelador');
  select id into v_aux from cargos where nome = 'Auxiliar de serviços gerais';
  select id into v_jar from cargos where nome = 'Jardineiro';
  select id into v_zel from cargos where nome = 'Zelador';

  insert into cargo_itens (cargo_id, tipo_id, quantidade)
    select v_aux, t.id, k.qtd
    from (values ('Camiseta', 2), ('Calça', 2), ('Sapato', 1), ('Luva nitrílica', 2), ('Bota de borracha', 1)) as k(nome, qtd)
    join uniforme_tipos t on t.nome = k.nome;

  insert into cargo_itens (cargo_id, tipo_id, quantidade)
    select v_jar, t.id, k.qtd
    from (values ('Camiseta', 2), ('Calça', 2), ('Boné', 1), ('Botina de segurança', 1), ('Luva de proteção', 2),
                 ('Óculos de proteção', 1), ('Protetor auricular', 1)) as k(nome, qtd)
    join uniforme_tipos t on t.nome = k.nome;

  insert into cargo_itens (cargo_id, tipo_id, quantidade)
    select v_zel, t.id, k.qtd
    from (values ('Camiseta', 2), ('Calça', 2), ('Sapato', 1), ('Luva de proteção', 1)) as k(nome, qtd)
    join uniforme_tipos t on t.nome = k.nome;
end
$$;
