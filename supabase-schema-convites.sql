-- Rode este script no SQL Editor do Supabase, DEPOIS do supabase-schema-usuarios.sql. Pode rodar
-- mais de uma vez sem problema.
--
-- Substitui o fluxo antigo de "criar acesso" (onde o admin digitava e-mail e nome) por um novo:
-- o admin digita o NOME, escolhe de uma vez o PAPEL e o NÍVEL que a pessoa vai receber (Admin, um
-- nível como Financeiro/Comercial, ou nenhum) e gera um link. A pessoa abre o link, escolhe o
-- PRÓPRIO e-mail e a própria senha, e a conta já nasce com o papel/nível escolhido — sem precisar
-- voltar na tela "Usuários" depois para liberar o acesso.
--
-- O que este script faz:
--   1) cria a tabela convites_pendentes: um "convite" é um nome + o papel/nível escolhido + um
--      token aleatório (o link leva esse token, não tem e-mail nenhum guardado até a pessoa
--      preencher, nem o papel/nível — isso fica só no banco, para não dar pra alterar pela URL);
--   2) protege a tabela (RLS): só admin ativo cria, lê e apaga convites pela tela do site — a
--      Edge Function completar-convite (que efetivamente cria a conta) usa a service role key e
--      por isso não passa pelas regras abaixo, então ela sempre consegue ler/gravar.

create table if not exists convites_pendentes (
  token uuid primary key default gen_random_uuid(),
  nome text not null,
  papel text not null default 'usuario' check (papel in ('admin','usuario')),
  nivel_id uuid references niveis(id) on delete set null,
  criado_por uuid not null references perfis(id) on delete cascade,
  criado_em timestamptz not null default now(),
  usado_em timestamptz
);

-- quem já tinha essa tabela de antes (sem papel/nivel_id) ganha as colunas agora, sem perder nada
alter table convites_pendentes add column if not exists papel text not null default 'usuario' check (papel in ('admin','usuario'));
alter table convites_pendentes add column if not exists nivel_id uuid references niveis(id) on delete set null;

alter table convites_pendentes enable row level security;

drop policy if exists "admin cria convites" on convites_pendentes;
create policy "admin cria convites" on convites_pendentes
  for insert with check (eh_admin(auth.uid()));

drop policy if exists "admin le convites" on convites_pendentes;
create policy "admin le convites" on convites_pendentes
  for select using (eh_admin(auth.uid()));

drop policy if exists "admin apaga convites" on convites_pendentes;
create policy "admin apaga convites" on convites_pendentes
  for delete using (eh_admin(auth.uid()));

-- só quem está logado (e a Edge Function, que ignora RLS) mexe nessa tabela
revoke all on convites_pendentes from anon;
grant select, insert, delete on convites_pendentes to authenticated;
