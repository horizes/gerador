-- Modelo. O gerador scripts/configurar-push.cjs cria uma cópia com o segredo preenchido,
-- fora da pasta do site. Execute essa cópia no SQL Editor após configurar a Edge Function.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
declare segredo text:='COLE_PUSH_DISPATCH_SECRET'; v_id uuid;
begin
 if segredo='COLE_PUSH_DISPATCH_SECRET' or length(segredo)<32 then
  raise exception 'Use a cópia gerada por scripts/configurar-push.cjs, com o segredo preenchido.';
 end if;
 select id into v_id from vault.secrets where name='imperium_push_dispatch';
 if v_id is null then perform vault.create_secret(segredo,'imperium_push_dispatch');
 else perform vault.update_secret(v_id,segredo,'imperium_push_dispatch'); end if;
end; $$;
-- O cron chama o worker apenas se existir trabalho de uniformes/EPI.
create or replace function public.push_executar_cron() returns void
language plpgsql security definer set search_path=public as $$
declare segredo text;
begin
 perform push_limpar();
 if not exists(select 1 from push_fila where estado in ('pendente','enviando') and proxima_tentativa<=now()) then return; end if;
 select decrypted_secret into segredo from vault.decrypted_secrets where name='imperium_push_dispatch';
 if segredo is null then raise exception 'Segredo do push não configurado no Vault.'; end if;
 perform net.http_post(
  url:='https://abweepruixcyetrzefhk.supabase.co/functions/v1/push-notificacoes',
  headers:=jsonb_build_object('Content-Type','application/json','x-push-secret',segredo),
  body:='{"acao":"despachar"}'::jsonb,timeout_milliseconds:=30000);
end; $$;
revoke all on function public.push_executar_cron() from public,anon,authenticated,service_role;
select cron.schedule('imperium-push','* * * * *','select public.push_executar_cron();');
commit;
