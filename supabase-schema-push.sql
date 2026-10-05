-- Notificações com o site fechado. Rode após os scripts de permissões/cargos/uniformes.
-- Exclusivo de uniformes/EPI; não cria avisos de ponto ou financeiro.
-- A fila é por aparelho: um envio que funcionou não se repete se outro aparelho falhar.
begin;
create table if not exists public.push_aparelhos (
 id uuid primary key default gen_random_uuid(),
 usuario_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique,
 p256dh text not null, auth text not null, vapid_publica text not null,
 atualizado_em timestamptz not null default now()
);
create table if not exists public.push_fila (
 id uuid primary key default gen_random_uuid(),
 aparelho_id uuid not null references public.push_aparelhos(id) on delete cascade,
 usuario_id uuid not null references auth.users(id) on delete cascade,
 modulo text not null check(modulo in ('uniforme_solicitar','uniforme_gestao')), chave text not null, titulo text not null, mensagem text not null,
 estado text not null default 'pendente' check(estado in ('pendente','enviando','enviado','ignorado','falhou')),
 tentativas integer not null default 0, reservado_em timestamptz,
 proxima_tentativa timestamptz not null default now(), criado_em timestamptz not null default now(),
 erro_codigo text, unique(aparelho_id,chave)
);
create index if not exists push_fila_pendentes on public.push_fila(proxima_tentativa) where estado in ('pendente','enviando');
alter table public.push_aparelhos enable row level security;
alter table public.push_fila enable row level security;
revoke all on public.push_aparelhos,public.push_fila from public,anon,authenticated;
grant all on public.push_aparelhos,public.push_fila to service_role;

-- Confere a permissão ATUAL do destinatário, sem usar a sessão de quem gerou o evento.
create or replace function public.push_pode_ver(p_usuario uuid,p_modulo text)
returns boolean language sql stable security definer set search_path=public as $$
 select p_modulo in ('uniforme_solicitar','uniforme_gestao') and exists(select 1 from perfis p where p.id=p_usuario and p.ativo and
 (p.papel='admin' or exists(select 1 from cargo_modulos cm
   where cm.cargo_id=p.cargo_id and cm.modulo_id=p_modulo)
 or exists(select 1 from perfil_modulos pm where pm.perfil_id=p.id and pm.modulo_id=p_modulo)));
$$;
create or replace function public.push_enfileirar(p_modulo text,p_chave text,p_titulo text,p_mensagem text,p_usuario uuid default null,p_excluir uuid default null)
returns void language sql security definer set search_path=public as $$
 insert into push_fila(aparelho_id,usuario_id,modulo,chave,titulo,mensagem)
 select a.id,a.usuario_id,p_modulo,p_chave,p_titulo,p_mensagem from push_aparelhos a
 where (p_usuario is null or a.usuario_id=p_usuario) and (p_excluir is null or a.usuario_id<>p_excluir)
 and push_pode_ver(a.usuario_id,p_modulo)
 on conflict(aparelho_id,chave) do nothing;
$$;

create or replace function public.push_uniforme_evento() returns trigger
language plpgsql security definer set search_path=public as $$
declare evento text;
begin
 if TG_OP='INSERT' and NEW.status='pendente' then
  perform push_enfileirar('uniforme_gestao','uniforme:novo:'||NEW.id,'Novo pedido de uniforme/EPI','Uma solicitação aguarda atendimento.',null,NEW.solicitante_id);
 elsif TG_OP='UPDATE' and NEW.status is distinct from OLD.status then
  evento:='uniforme:'||NEW.id||':'||NEW.status||':'||NEW.atualizado_em;
  if NEW.status in ('pronto','parcial','recusado','cancelado') and NEW.solicitante_id is not null then
   perform push_enfileirar('uniforme_solicitar',evento,'Atualização do seu uniforme/EPI',
    case NEW.status when 'pronto' then 'Seu pedido está pronto para retirada.'
     when 'parcial' then 'Confira a entrega parcial e os itens do seu pedido.'
     when 'recusado' then 'Seu pedido foi recusado. Consulte a resposta na plataforma.'
     else 'Seu pedido foi cancelado.' end,NEW.solicitante_id,auth.uid());
  end if;
  if NEW.status='pendente' then
   perform push_enfileirar('uniforme_gestao',evento,'Pedido de uniforme/EPI reaberto','Um pedido voltou a aguardar atendimento.',null,auth.uid());
  elsif NEW.status='cancelado' then
   perform push_enfileirar('uniforme_gestao',evento||':gestao','Pedido de uniforme/EPI cancelado','Confira a atualização das solicitações.',null,auth.uid());
  end if;
 end if;
 return NEW;
end; $$;
drop trigger if exists push_uniforme_evento on public.uniforme_pedidos;
create trigger push_uniforme_evento after insert or update on public.uniforme_pedidos
 for each row execute function public.push_uniforme_evento();

create or replace function public.push_recebimento_evento() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 perform push_enfileirar('uniforme_gestao','recebimento:'||NEW.id,'Recebimento de uniforme/EPI confirmado','Um colaborador confirmou o recebimento. O comprovante está na plataforma.',null,auth.uid());
 return NEW;
end; $$;
drop trigger if exists push_recebimento_evento on public.uniforme_recebimentos;
create trigger push_recebimento_evento after insert on public.uniforme_recebimentos
 for each row execute function public.push_recebimento_evento();

-- Reserva atômica e recupera tarefas interrompidas. Só o worker pode executar.
create or replace function public.push_reservar(p_limite integer default 20)
returns setof public.push_fila language sql security definer set search_path=public as $$
 update push_fila f set estado='enviando',reservado_em=clock_timestamp(),tentativas=f.tentativas+1
 where f.id in (select id from push_fila where tentativas<5 and criado_em>now()-interval '1 day'
  and ((estado='pendente' and proxima_tentativa<=now()) or (estado='enviando' and reservado_em<now()-interval '5 minutes'))
  order by criado_em for update skip locked limit least(greatest(p_limite,1),20))
 returning f.*;
$$;
create or replace function public.push_limpar() returns void
language plpgsql security definer set search_path=public as $$
begin
 update push_fila set estado='falhou',erro_codigo='limite_ou_expirado'
 where estado in ('pendente','enviando') and (criado_em<now()-interval '1 day' or (tentativas>=5 and reservado_em<now()-interval '5 minutes'));
 delete from push_fila where criado_em<now()-interval '30 days';
end; $$;
revoke all on function public.push_pode_ver(uuid,text),public.push_enfileirar(text,text,text,text,uuid,uuid),public.push_uniforme_evento(),public.push_recebimento_evento(),public.push_reservar(integer),public.push_limpar() from public,anon,authenticated;
grant execute on function public.push_pode_ver(uuid,text),public.push_reservar(integer),public.push_limpar() to service_role;
commit;
