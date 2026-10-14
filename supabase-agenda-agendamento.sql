-- Modelo da fila da agenda. Gere a cópia preenchida com scripts/configurar-agenda.cjs.
-- Execute depois de supabase-schema-agenda.sql e do deploy da função agenda.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;
do $$
declare
 destino text := 'COLE_AGENDA_FUNCTION_URL';
 segredo text := 'COLE_AGENDA_CRON_SECRET';
 v_id uuid;
begin
 if destino not like 'https://%/functions/v1/agenda' or length(segredo)<32 or segredo='COLE_AGENDA_CRON_SECRET' then
  raise exception 'Use a cópia preenchida gerada por scripts/configurar-agenda.cjs.';
 end if;
 select id into v_id from vault.secrets where name='imperium_agenda_function_url';
 if v_id is null then perform vault.create_secret(destino,'imperium_agenda_function_url');
 else perform vault.update_secret(v_id,destino,'imperium_agenda_function_url');end if;
 select id into v_id from vault.secrets where name='imperium_agenda_cron_secret';
 if v_id is null then perform vault.create_secret(segredo,'imperium_agenda_cron_secret');
 else perform vault.update_secret(v_id,segredo,'imperium_agenda_cron_secret');end if;
end $$;
create or replace function public.agenda_executar_cron() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare destino text;segredo text;
begin
 if not exists(select 1 from public.agenda_jobs where status='pending' and next_at<=clock_timestamp()
  and (lease_until is null or lease_until<clock_timestamp())) then return;end if;
 select decrypted_secret into destino from vault.decrypted_secrets where name='imperium_agenda_function_url';
 select decrypted_secret into segredo from vault.decrypted_secrets where name='imperium_agenda_cron_secret';
 if destino is null or segredo is null then raise exception 'Configure os segredos da agenda no Vault.';end if;
 perform net.http_post(url:=destino,
  headers:=jsonb_build_object('Content-Type','application/json','x-agenda-key',segredo),
  body:='{"action":"processQueue","payload":{}}'::jsonb,timeout_milliseconds:=30000);
end $$;
revoke all on function public.agenda_executar_cron() from public,anon,authenticated,service_role;
-- Mesmo nome: reaplicar atualiza o agendamento, sem criar outro worker.
select cron.schedule('imperium-agenda-processar','* * * * *','select public.agenda_executar_cron();');
commit;
