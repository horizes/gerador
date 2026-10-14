-- Agenda Imperium. Execute depois dos scripts de perfis, usuários e cargos unificados.
-- Não depende do módulo de ponto. Pode ser reaplicado; preserva reservas e configurações.
begin;
create table if not exists public.agenda_config (
 id boolean primary key default true check(id), revision uuid not null default gen_random_uuid(),
 weekly_revision uuid not null default gen_random_uuid(), google_connection_id uuid,
 settings jsonb not null default '{"enabled":false,"autoMeet":false,"hostName":"Equipe Imperium","duration":30,"noticeMinutes":60,"onlineLink":"","presentialLocation":""}',
 weekly jsonb not null default '{"gap":0,"modes":["online","presencial"],"days":[{"day":0,"enabled":false,"ranges":[]},{"day":1,"enabled":false,"ranges":[]},{"day":2,"enabled":false,"ranges":[]},{"day":3,"enabled":false,"ranges":[]},{"day":4,"enabled":false,"ranges":[]},{"day":5,"enabled":false,"ranges":[]},{"day":6,"enabled":false,"ranges":[]}]}'
);
insert into agenda_config(id) values(true) on conflict do nothing;
create table if not exists public.agenda_extras (
 id uuid primary key, date date not null, time time not null, duration int not null check(duration in(15,30,45,60,90)),
 modes jsonb not null, start_at timestamptz not null, end_at timestamptz not null check(end_at>start_at), revision uuid not null default gen_random_uuid()
);
create table if not exists public.agenda_holds (
 id uuid primary key, date date not null, start_at timestamptz not null, end_at timestamptz not null check(end_at>start_at),
 reason text not null default '', revision uuid not null default gen_random_uuid()
);
create table if not exists public.agenda_blocked (date date primary key);
create table if not exists public.agenda_bookings (
 id uuid primary key default gen_random_uuid(), attempt uuid not null unique, proof_hash text not null, fingerprint text not null,
 client_hash text not null, email_hash text not null, slot_key text not null, date date not null, time time not null,
 start_at timestamptz not null, end_at timestamptz not null check(end_at>start_at), duration int not null,
 mode text not null check(mode in('online','presencial')), subject text not null, contact_cipher text not null,
 host_name text not null, location text not null default '', online_link text not null default '', protocol text not null unique,
 status text not null default 'confirmed' check(status in('confirmed','canceled','completed')), google jsonb not null default '{"status":"manual"}',
 email_status text not null default 'not_configured', email_meet_status text not null default 'not_requested',
 created_at timestamptz not null default clock_timestamp(), changed_at timestamptz not null default clock_timestamp()
);
create index if not exists agenda_bookings_period on agenda_bookings(start_at,end_at) where status<>'canceled';
create index if not exists agenda_bookings_email on agenda_bookings(email_hash,created_at);
create table if not exists public.agenda_google_client (
 id boolean primary key default true check(id), revision uuid not null default gen_random_uuid(), cipher text not null
);
create table if not exists public.agenda_google_connections (
 id uuid primary key default gen_random_uuid(), email text not null, subject text not null, cipher text not null,
 authorization_required boolean not null default false, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.agenda_google_oauth (
 state_hash text primary key, browser_hash text not null, actor uuid not null references auth.users(id) on delete cascade, client_revision uuid not null,
 verifier_cipher text not null, expires_at timestamptz not null
);
create table if not exists public.agenda_jobs (
 id uuid primary key default gen_random_uuid(), booking_id uuid not null references agenda_bookings(id),
 kind text not null check(kind in('google','email','email_meet')), status text not null default 'pending' check(status in('pending','done','failed')),
 attempts int not null default 0, next_at timestamptz not null default clock_timestamp(), lease_until timestamptz, last_error text not null default ''
);
create unique index if not exists agenda_one_google_job on agenda_jobs(booking_id) where kind='google';
create table if not exists public.agenda_limits (key text not null,bucket bigint not null,count int not null,primary key(key,bucket));
create table if not exists public.agenda_audit (id bigint generated always as identity primary key,actor uuid references auth.users(id) on delete set null,action text not null,entity uuid,created_at timestamptz not null default clock_timestamp());

-- Somente a Edge Function acessa estas tabelas; nenhum visitante consulta contatos ou tokens.
do $$ declare t text;begin
 foreach t in array array['agenda_config','agenda_extras','agenda_holds','agenda_blocked','agenda_bookings','agenda_google_client','agenda_google_connections','agenda_google_oauth','agenda_jobs','agenda_limits','agenda_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant usage,select on sequence agenda_audit_id_seq to service_role;

create or replace function public.agenda_permission(p_actor uuid) returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('admin',coalesce(bool_or(p.papel='admin'),false),'manage',coalesce(bool_or(p.papel='admin'
 or exists(select 1 from cargo_modulos cm where cm.cargo_id=p.cargo_id and cm.modulo_id='agenda_gestao')
 or exists(select 1 from perfil_modulos pm where pm.perfil_id=p.id and pm.modulo_id='agenda_gestao')),false)) from perfis p join auth.users u on u.id=p.id where p.id=p_actor and p.ativo and u.email_confirmed_at is not null and coalesce(length(u.encrypted_password),0)>0;
$$;
create or replace function public.agenda_rate(p_key text,p_window int,p_max int) returns void language plpgsql security definer set search_path=public as $$
declare b bigint;n int;begin
 b:=floor(extract(epoch from clock_timestamp())/p_window);
 insert into agenda_limits(key,bucket,count) values(p_key,b,1) on conflict(key,bucket) do update set count=agenda_limits.count+1 returning count into n;
 if n>p_max then raise exception using errcode='P0001',message='RATE_LIMIT';end if;
 delete from agenda_limits where bucket<floor(extract(epoch from clock_timestamp()-interval '2 days')/greatest(p_window,60)) and key=p_key;
end $$;
create or replace function public.agenda_snapshot(p_from date,p_until date) returns jsonb language plpgsql security definer set search_path=public as $$
declare c agenda_config;begin
 if p_from is null or p_until is null or p_until<p_from or p_until-p_from>400 then raise exception 'VALIDATION';end if;
 select * into c from agenda_config where id;
 return jsonb_build_object('settings',c.settings||jsonb_build_object('revision',c.revision),'weekly',c.weekly||jsonb_build_object('revision',c.weekly_revision),
 'extras',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('time',to_char(e.time,'HH24:MI'))) from agenda_extras e where e.date between p_from and p_until),'[]'::jsonb),
 'holds',coalesce((select jsonb_agg(to_jsonb(h)||jsonb_build_object('from',to_char(h.start_at at time zone 'America/Sao_Paulo','HH24:MI'),'until',to_char(h.end_at at time zone 'America/Sao_Paulo','HH24:MI'))) from agenda_holds h where h.date between p_from and p_until),'[]'::jsonb),
 'blocked',coalesce((select jsonb_agg(d.date) from agenda_blocked d where d.date between p_from and p_until),'[]'::jsonb),
 'bookings',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('time',to_char(b.time,'HH24:MI')) order by b.start_at,b.id) from agenda_bookings b where b.date between p_from and p_until),'[]'::jsonb));
end $$;

-- A linha da configuração serializa disponibilidade, bloqueios e reservas concorrentes.
-- A revisão impede reservar uma faixa que outro gestor acabou de alterar.
create or replace function public.agenda_book(p jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare c agenda_config;b agenda_bookings;uid uuid:=gen_random_uuid();g jsonb;starttime timestamptz;endtime timestamptz;day date;begin
 select * into c from agenda_config where id for update;
 select * into b from agenda_bookings where attempt=(p->>'attempt')::uuid;
 if found then
 if b.proof_hash<>p->>'proof_hash' or b.fingerprint<>p->>'fingerprint' then raise exception 'CONFLICT';end if;
 return to_jsonb(b)||jsonb_build_object('time',to_char(b.time,'HH24:MI'));end if;
 if c.revision<>(p->>'revision')::uuid or not(c.settings->>'enabled')::boolean then raise exception 'CONFLICT';end if;
 starttime:=(p->>'start_at')::timestamptz;endtime:=(p->>'end_at')::timestamptz;day:=(p->>'date')::date;
 if starttime<=clock_timestamp()+((c.settings->>'noticeMinutes')::int*interval '1 minute') or day>(clock_timestamp() at time zone 'America/Sao_Paulo')::date+90
 or (starttime at time zone 'America/Sao_Paulo')::date<>day or (endtime at time zone 'America/Sao_Paulo')::date<>day
 or endtime<>starttime+((p->>'duration')::int*interval '1 minute') or (p->>'duration')::int not in(15,30,45,60,90)
 or length(p->>'contact_cipher')<32 or p->>'proof_hash'!~'^[a-f0-9]{64}$' or p->>'fingerprint'!~'^[a-f0-9]{64}$' then raise exception 'VALIDATION';end if;
 if exists(select 1 from agenda_blocked where date=day)
 or exists(select 1 from agenda_holds where start_at<endtime and end_at>starttime)
 or exists(select 1 from agenda_bookings where status<>'canceled' and start_at<endtime and end_at>starttime) then raise exception 'CONFLICT';end if;
 if (select count(*) from agenda_bookings where email_hash=p->>'email_hash' and created_at>clock_timestamp()-interval '24 hours')>=5 then raise exception 'RATE_LIMIT';end if;
 g:=case when p->>'mode'='online' and (c.settings->>'autoMeet')::boolean and c.google_connection_id is not null then
 jsonb_build_object('status','pending','connectionId',c.google_connection_id,'eventId','imp'||replace(uid::text,'-',''),'conferenceRequestId',gen_random_uuid()) else jsonb_build_object('status','manual') end;
 insert into agenda_bookings(id,attempt,proof_hash,fingerprint,client_hash,email_hash,slot_key,date,time,start_at,end_at,duration,mode,subject,contact_cipher,host_name,location,online_link,protocol,google,email_status)
 values(uid,(p->>'attempt')::uuid,p->>'proof_hash',p->>'fingerprint',p->>'client_hash',p->>'email_hash',p->>'slot_key',day,(p->>'time')::time,starttime,endtime,(p->>'duration')::int,p->>'mode',p->>'subject',p->>'contact_cipher',c.settings->>'hostName',
 case when p->>'mode'='presencial' then coalesce(c.settings->>'presentialLocation','') else '' end,
 case when g->>'status'='manual' and p->>'mode'='online' then c.settings->>'onlineLink' else '' end,
 'IMP-'||to_char(day,'YYYYMMDD')||'-'||upper(substr(replace(uid::text,'-',''),1,8)),g,case when(p->>'email_configured')::boolean then 'pending' else 'not_configured' end) returning * into b;
 if g->>'status'='pending' then insert into agenda_jobs(booking_id,kind) values(uid,'google');end if;
 if(p->>'email_configured')::boolean then insert into agenda_jobs(booking_id,kind) values(uid,'email');end if;
 return to_jsonb(b)||jsonb_build_object('time',to_char(b.time,'HH24:MI'));
end $$;
create or replace function public.agenda_mutate(p_actor uuid,p_revision uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare c agenda_config;b agenda_bookings;r jsonb;added int:=0;d date;starttime timestamptz;endtime timestamptz;entity uuid;begin
 if not(agenda_permission(p_actor)->>'manage')::boolean then raise exception 'UNAUTHORIZED';end if;
 select * into c from agenda_config where id for update;
 if p_revision is not null and c.revision<>p_revision then raise exception 'CONFLICT';end if;
 case p_action
 when 'saveSettings' then update agenda_config set settings=p_data-'revision',revision=gen_random_uuid() where id;
 when 'saveWeekly' then
 if c.weekly_revision<>(p_data->>'weeklyRevision')::uuid then raise exception 'CONFLICT';end if;
 update agenda_config set weekly=p_data-'weeklyRevision',weekly_revision=gen_random_uuid(),revision=gen_random_uuid() where id;
 when 'addExtra' then
 if (select count(*) from agenda_extras where date>=(clock_timestamp() at time zone 'America/Sao_Paulo')::date)+jsonb_array_length(p_data)>1000 then raise exception 'VALIDATION';end if;
 for r in select value from jsonb_array_elements(p_data) loop
 starttime:=(r->>'start_at')::timestamptz;endtime:=(r->>'end_at')::timestamptz;
 if exists(select 1 from agenda_extras where start_at<endtime and end_at>starttime)
 or exists(select 1 from agenda_bookings where status<>'canceled' and start_at<endtime and end_at>starttime)
 or exists(select 1 from agenda_holds where start_at<endtime and end_at>starttime) then raise exception 'CONFLICT';end if;
 insert into agenda_extras(id,date,time,duration,modes,start_at,end_at) values((r->>'id')::uuid,(r->>'date')::date,(r->>'time')::time,(r->>'duration')::int,r->'modes',starttime,endtime);added:=added+1;
 end loop;update agenda_config set revision=gen_random_uuid() where id;
 when 'removeExtra' then
 entity:=(p_data->>'id')::uuid;
 if exists(select 1 from agenda_bookings where slot_key='e:'||entity::text and status<>'canceled') then raise exception 'CONFLICT';end if;
 delete from agenda_extras where id=entity and revision=(p_data->>'revision')::uuid;
 if not found then raise exception 'CONFLICT';end if;
 update agenda_config set revision=gen_random_uuid() where id;
 when 'blockDay' then
 d:=(p_data->>'date')::date;if (p_data->>'blocked')::boolean then insert into agenda_blocked(date) values(d) on conflict do nothing;else delete from agenda_blocked where date=d;end if;
 update agenda_config set revision=gen_random_uuid() where id;
 when 'hold' then
 entity:=(p_data->>'id')::uuid;starttime:=(p_data->>'start_at')::timestamptz;endtime:=(p_data->>'end_at')::timestamptz;
 if exists(select 1 from agenda_holds where id=entity and start_at=starttime and end_at=endtime and reason=p_data->>'reason') then return '{}'::jsonb;end if;
 if exists(select 1 from agenda_holds where start_at<endtime and end_at>starttime)
 or exists(select 1 from agenda_bookings where status<>'canceled' and start_at<endtime and end_at>starttime) then raise exception 'CONFLICT';end if;
 insert into agenda_holds(id,date,start_at,end_at,reason) values(entity,(p_data->>'date')::date,starttime,endtime,p_data->>'reason');update agenda_config set revision=gen_random_uuid() where id;
 when 'releaseHold' then
 entity:=(p_data->>'id')::uuid;delete from agenda_holds where id=entity and revision=(p_data->>'holdRevision')::uuid;
 if not found and exists(select 1 from agenda_holds where id=entity) then raise exception 'CONFLICT';end if;
 update agenda_config set revision=gen_random_uuid() where id;
 when 'bookingStatus' then
 entity:=(p_data->>'id')::uuid;select * into b from agenda_bookings where id=entity for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if b.status=p_data->>'status' then return '{}'::jsonb;end if;
 if b.status<>'confirmed' or p_data->>'status' not in('canceled','completed') or(p_data->>'status'='completed' and b.start_at>clock_timestamp()) then raise exception 'CONFLICT';end if;
 update agenda_bookings set status=p_data->>'status',changed_at=clock_timestamp(),google=case when p_data->>'status'='canceled' and google->>'status'<>'manual' then google||'{"status":"cancel_pending"}'::jsonb else google end where id=entity;
 if p_data->>'status'='canceled' and b.google->>'status'<>'manual' then
 insert into agenda_jobs(booking_id,kind) values(entity,'google') on conflict(booking_id) where kind='google' do update set status='pending',next_at=clock_timestamp(),attempts=0;
 end if;
 else raise exception 'VALIDATION';end case;
 insert into agenda_audit(actor,action,entity) values(p_actor,p_action,entity);
 return jsonb_build_object('added',added);
end $$;

create or replace function public.agenda_claim_job() returns jsonb language plpgsql security definer set search_path=public as $$
declare j agenda_jobs;begin
 -- Uma conexão SMTP que caiu após o envio pode ter sido aceita. Não reenviar às cegas.
 update agenda_bookings b set email_status=case when q.kind='email' then 'review' else b.email_status end,email_meet_status=case when q.kind='email_meet' then 'review' else b.email_meet_status end
 from agenda_jobs q where q.booking_id=b.id and q.kind in('email','email_meet') and q.status='pending' and q.lease_until<clock_timestamp();
 update agenda_jobs set status='failed',last_error='EMAIL_REVIEW',lease_until=null where kind in('email','email_meet') and status='pending' and lease_until<clock_timestamp();
 select * into j from agenda_jobs where status='pending' and next_at<=clock_timestamp() and (lease_until is null or lease_until<clock_timestamp()) order by next_at,id for update skip locked limit 1;
 if not found then return null;end if;
 update agenda_jobs set lease_until=clock_timestamp()+interval '2 minutes',attempts=attempts+1 where id=j.id returning * into j;return to_jsonb(j);
end $$;
drop function if exists public.agenda_finish_job(uuid,boolean,jsonb,text);
create or replace function public.agenda_finish_job(p_id uuid,p_success boolean,p_google jsonb default null,p_error text default '',p_had_link boolean default null) returns void language plpgsql security definer set search_path=public as $$
declare j agenda_jobs;b agenda_bookings;begin
 select * into j from agenda_jobs where id=p_id for update;if not found then return;end if;
 select * into b from agenda_bookings where id=j.booking_id for update;
 if j.kind='google' and b.status='canceled' and p_google->>'status'='ready' then
 update agenda_jobs set lease_until=null,status='pending',next_at=clock_timestamp() where id=j.id;return;end if;
 if j.kind='google' and not p_success and j.attempts>=6 and p_google->>'status'='pending' then p_google:=p_google||'{"status":"failed"}'::jsonb;end if;
 if j.kind='google' and p_google is not null then update agenda_bookings set google=google||p_google,online_link=case when p_google->>'status'='ready' then p_google->>'onlineLink' when p_google->>'status'='canceled' then '' else online_link end where id=b.id;end if;
 if j.kind='email' then
 update agenda_bookings set email_status=case when status<>'confirmed' then 'skipped' when p_error='EMAIL_REVIEW' then 'review' when p_success then 'accepted' else 'failed' end,
 email_meet_status=case when p_success and p_had_link then 'not_needed' when p_success and google->>'status'<>'manual' and email_meet_status='not_requested' then 'waiting_link' else email_meet_status end where id=b.id;
 if p_success and not coalesce(p_had_link,false) and b.google->>'status'='ready' and b.email_meet_status in('not_requested','waiting_link') then
 update agenda_bookings set email_meet_status='pending' where id=b.id;insert into agenda_jobs(booking_id,kind) values(b.id,'email_meet');end if;
 end if;
 if j.kind='email_meet' then update agenda_bookings set email_meet_status=case when status<>'confirmed' then 'skipped' when email_meet_status='not_needed' then 'not_needed' when p_error='EMAIL_REVIEW' then 'review' when p_success then 'accepted' else 'failed' end where id=b.id;end if;
 update agenda_jobs set status=case when p_success then 'done' when attempts>=6 or p_error='EMAIL_REVIEW' then 'failed' else 'pending' end,lease_until=null,next_at=clock_timestamp()+least(3600,power(2,attempts)::int*30)*interval '1 second',last_error=left(p_error,160) where id=j.id;
 if j.kind='google' and p_success and p_google->>'status'='ready' and b.email_status='accepted' and b.email_meet_status in('not_requested','waiting_link') then
 update agenda_bookings set email_meet_status='pending' where id=b.id;insert into agenda_jobs(booking_id,kind) values(b.id,'email_meet');end if;
end $$;
create or replace function public.agenda_consume_oauth(p_state text,p_browser text) returns jsonb language plpgsql security definer set search_path=public as $$
declare o agenda_google_oauth;begin
 delete from agenda_google_oauth where state_hash=p_state and browser_hash=p_browser and expires_at>clock_timestamp() returning * into o;
 if not found or not(agenda_permission(o.actor)->>'admin')::boolean then raise exception 'UNAUTHORIZED';end if;
 return to_jsonb(o);
end $$;
create or replace function public.agenda_connect_google(p_actor uuid,p_connection uuid) returns void language plpgsql security definer set search_path=public as $$
begin
 if not(agenda_permission(p_actor)->>'admin')::boolean then raise exception 'UNAUTHORIZED';end if;
 perform 1 from agenda_config where id for update;
 update agenda_config set google_connection_id=p_connection,settings=settings||'{"autoMeet":true}'::jsonb,revision=gen_random_uuid() where id;
 insert into agenda_audit(actor,action,entity) values(p_actor,'google_connect',p_connection);
end $$;
create or replace function public.agenda_disconnect_google(p_actor uuid) returns void language plpgsql security definer set search_path=public as $$
declare cid uuid;begin
 if not(agenda_permission(p_actor)->>'admin')::boolean then raise exception 'UNAUTHORIZED';end if;
 select google_connection_id into cid from agenda_config where id for update;
 update agenda_google_connections set cipher='',authorization_required=true where id=cid;
 update agenda_config set google_connection_id=null,settings=settings||'{"autoMeet":false}'::jsonb,revision=gen_random_uuid() where id;
 delete from agenda_google_oauth;insert into agenda_audit(actor,action,entity) values(p_actor,'google_disconnect',cid);
end $$;
-- Funções internas: não podem ser invocadas diretamente com a chave pública do site.
do $$ declare fn record;begin
 for fn in select p.oid::regprocedure as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'agenda\_%' escape '\' loop
 execute format('revoke all on function %s from public,anon,authenticated',fn.name);
 execute format('grant execute on function %s to service_role',fn.name);
 end loop;
end $$;
commit;
