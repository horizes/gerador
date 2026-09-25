-- Rode este script UMA VEZ no SQL Editor do Supabase (depois do supabase-schema.sql). Pode rodar
-- mais de uma vez sem problema.
--
-- Ele existe por causa de um detalhe: a coluna fluxo_lancamentos.criado_por aponta para o login da
-- pessoa (auth.users) sem dizer o que fazer se esse login for apagado — e o padrão do Postgres
-- nesse caso é BLOQUEAR a exclusão ("Não é possível excluir: existe um lançamento apontando pra
-- essa conta"). Isso troca o comportamento para "apagou o login, o lançamento continua no
-- histórico, só o 'quem lançou' fica em branco" — exatamente como já funciona hoje nas solicitações
-- de Uniformes/EPI (supabase-schema-uniformes.sql).
--
-- Sem rodar este script, o botão "Excluir conta" da tela "Usuários" ainda funciona para quem nunca
-- lançou nada no Fluxo de Caixa, mas falha com um erro claro para quem já lançou.

alter table fluxo_lancamentos drop constraint if exists fluxo_lancamentos_criado_por_fkey;
alter table fluxo_lancamentos add constraint fluxo_lancamentos_criado_por_fkey
  foreign key (criado_por) references auth.users(id) on delete set null;
