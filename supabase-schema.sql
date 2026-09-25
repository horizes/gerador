-- Rode este script UMA VEZ no seu projeto Supabase: painel > SQL Editor > New query > cole tudo > Run.
-- Ele cria as tabelas do Fluxo de Caixa, protege com RLS (só quem estiver logado acessa)
-- e já cadastra as categorias padrão.

create extension if not exists "pgcrypto";

-- Categorias (compartilhadas entre todos os usuários logados)
create table if not exists fluxo_categorias (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('entrada','saida')),
  nome text not null,
  criado_em timestamptz not null default now(),
  unique (tipo, nome)
);

-- Lançamentos
create table if not exists fluxo_lancamentos (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  tipo text not null check (tipo in ('entrada','saida')),
  categoria text not null,
  descricao text default '',
  forma text default 'Pix',
  status text not null check (status in ('pendente','pago')),
  valor numeric(12,2) not null default 0,
  anexo_nome text,
  anexo_tipo text,
  anexo_path text,               -- caminho do arquivo no Storage (bucket "anexos")
  criado_por uuid references auth.users(id),
  criado_em timestamptz not null default now()
);

alter table fluxo_categorias enable row level security;
alter table fluxo_lancamentos enable row level security;

-- Qualquer pessoa autenticada (que fez login) pode ler e escrever — é uma ferramenta interna
-- de uso compartilhado pela equipe, não há separação de dados por usuário.
create policy "autenticados leem categorias"    on fluxo_categorias  for select using (auth.role() = 'authenticated');
create policy "autenticados inserem categorias" on fluxo_categorias  for insert with check (auth.role() = 'authenticated');
create policy "autenticados apagam categorias"  on fluxo_categorias  for delete using (auth.role() = 'authenticated');

create policy "autenticados leem lancamentos"    on fluxo_lancamentos for select using (auth.role() = 'authenticated');
create policy "autenticados inserem lancamentos" on fluxo_lancamentos for insert with check (auth.role() = 'authenticated');
create policy "autenticados atualizam lancamentos" on fluxo_lancamentos for update using (auth.role() = 'authenticated');
create policy "autenticados apagam lancamentos"  on fluxo_lancamentos for delete using (auth.role() = 'authenticated');

-- Categorias padrão
insert into fluxo_categorias (tipo, nome) values
 ('entrada','Prestação de serviços'),
 ('entrada','Outras receitas'),
 ('saida','Salários e encargos'),
 ('saida','Fornecedores'),
 ('saida','Aluguel'),
 ('saida','Impostos e taxas'),
 ('saida','Combustível e manutenção'),
 ('saida','Outras despesas')
on conflict do nothing;

-- Políticas do bucket de anexos (crie o bucket "anexos" pelo painel antes de rodar isto — ver README)
create policy "autenticados leem anexos"   on storage.objects for select using (bucket_id = 'anexos' and auth.role() = 'authenticated');
create policy "autenticados enviam anexos" on storage.objects for insert with check (bucket_id = 'anexos' and auth.role() = 'authenticated');
create policy "autenticados apagam anexos" on storage.objects for delete using (bucket_id = 'anexos' and auth.role() = 'authenticated');
