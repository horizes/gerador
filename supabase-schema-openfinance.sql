-- Open Finance no Fluxo de Caixa — rode UMA VEZ no SQL Editor do Supabase (depois dos outros scripts).
-- Guarda as conexões bancárias (via Pluggy), as contas com saldo e o registro de cada movimentação
-- já importada (para nunca importar duas vezes, mesmo que você apague o lançamento na planilha).
-- Só a Edge Function "open-finance" grava aqui (service role); quem tem acesso ao Fluxo só lê.

create table if not exists banco_conexoes (
  id uuid primary key default gen_random_uuid(),
  item_id text not null unique,              -- id da conexão no Pluggy
  instituicao text not null default '',
  status text not null default '',
  ultima_sincronizacao timestamptz,
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now()
);

create table if not exists banco_contas (
  id text primary key,                       -- id da conta no Pluggy
  conexao_id uuid not null references banco_conexoes(id) on delete cascade,
  nome text not null default '',
  tipo text not null default '',             -- BANK (conta) ou CREDIT (cartão)
  saldo numeric(14,2) not null default 0,
  atualizado_em timestamptz not null default now()
);

create table if not exists banco_transacoes (
  id text primary key,                       -- id da movimentação no Pluggy
  conta_id text not null references banco_contas(id) on delete cascade,
  importado_em timestamptz not null default now()
);

alter table fluxo_lancamentos add column if not exists banco_transacao_id text;

alter table banco_conexoes  enable row level security;
alter table banco_contas    enable row level security;
alter table banco_transacoes enable row level security;

drop policy if exists "fluxo le conexoes" on banco_conexoes;
drop policy if exists "fluxo le contas"   on banco_contas;
create policy "fluxo le conexoes" on banco_conexoes for select using (tem_acesso_modulo('fluxo'));
create policy "fluxo le contas"   on banco_contas    for select using (tem_acesso_modulo('fluxo'));
-- banco_transacoes: sem policy de propósito (só a Edge Function, com service role, usa)
