-- Agenda por perfil. Execute DEPOIS de supabase-schema-agenda.sql.
-- Migração aditiva e reaplicável: mantém reservas, protocolos, links antigos e tokens.
begin;
create table if not exists public.agenda_calendars (
 id uuid primary key default gen_random_uuid(), owner_id uuid unique references auth.users(id) on delete set null,
 legacy boolean not null default false, revision uuid not null default gen_random_uuid(),
 weekly_revision uuid not null default gen_random_uuid(), google_connection_id uuid,
 settings jsonb not null default '{"enabled":false,"autoMeet":false,"hostName":"Equipe Imperium","duration":30,"noticeMinutes":60,"onlineLink":"","presentialLocation":""}',
 weekly jsonb not null default '{"gap":0,"modes":["online","presencial"],"days":[{"day":0,"enabled":false,"ranges":[]},{"day":1,"enabled":false,"ranges":[]},{"day":2,"enabled":false,"ranges":[]},{"day":3,"enabled":false,"ranges":[]},{"day":4,"enabled":false,"ranges":[]},{"day":5,"enabled":false,"ranges":[]},{"day":6,"enabled":false,"ranges":[]}]}',
 created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists agenda_one_legacy_calendar on agenda_calendars(legacy) where legacy;
alter table agenda_config add column if not exists legacy_calendar_id uuid references agenda_calendars(id);
do $$ declare responsible uuid; cid uuid;begin
 select legacy_calendar_id into cid from agenda_config where id for update;
 if cid is null then
  select g.created_by into responsible from agenda_config c join agenda_google_connections g on g.id=c.google_connection_id
   where c.id and (agenda_permission(g.created_by)->>'manage')::boolean;
  if responsible is null then
   select p.id into responsible from perfis p where (agenda_permission(p.id)->>'manage')::boolean
    order by (p.papel='admin') desc,coalesce(to_jsonb(p)->>'criado_em',''),p.id limit 1;
  end if;
  insert into agenda_calendars(owner_id,legacy,revision,weekly_revision,google_connection_id,settings,weekly)
   select responsible,true,revision,weekly_revision,google_connection_id,settings,weekly from agenda_config where id returning id into cid;
  update agenda_config set legacy_calendar_id=cid where id;
 end if;
end $$;
create or replace function public.agenda_profile_legacy_id() returns uuid language sql security definer set search_path=public as $$
 select legacy_calendar_id from agenda_config where id;
$$;
do $$ declare t text;begin
 foreach t in array array['agenda_extras','agenda_holds','agenda_blocked','agenda_bookings','agenda_google_connections','agenda_google_oauth','agenda_audit'] loop
  execute format('alter table public.%I add column if not exists calendar_id uuid references public.agenda_calendars(id)',t);
  execute format('update public.%I set calendar_id=public.agenda_profile_legacy_id() where calendar_id is null',t);
  execute format('alter table public.%I alter column calendar_id set default public.agenda_profile_legacy_id(), alter column calendar_id set not null',t);
 end loop;
end $$;
alter table agenda_blocked drop constraint if exists agenda_blocked_pkey;
alter table agenda_blocked add primary key(calendar_id,date);
create index if not exists agenda_bookings_calendar_period on agenda_bookings(calendar_id,start_at,end_at);
create index if not exists agenda_extras_calendar_date on agenda_extras(calendar_id,date);
create index if not exists agenda_holds_calendar_period on agenda_holds(calendar_id,start_at,end_at);
alter table agenda_calendars enable row level security;
revoke all on agenda_calendars from public,anon,authenticated;
grant all on agenda_calendars to service_role;

create or replace function public.agenda_profile_ensure(p_owner uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare cid uuid;begin
 if not coalesce((agenda_permission(p_owner)->>'manage')::boolean,false) then raise exception 'UNAUTHORIZED';end if;
 insert into agenda_calendars(owner_id,settings)
  select p_owner,jsonb_build_object('enabled',false,'autoMeet',false,'hostName',coalesce(nullif(trim(p.nome),''),'Equipe Imperium'),'duration',30,'noticeMinutes',60,'onlineLink','','presentialLocation','') from perfis p where p.id=p_owner
  on conflict(owner_id) do nothing;
 select id into cid from agenda_calendars where owner_id=p_owner;return cid;
end $$;
create or replace function public.agenda_profile_context(p_actor uuid,p_calendar uuid default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare access jsonb;own uuid;cid uuid;owner uuid;person record;directory jsonb;begin
 access:=agenda_permission(p_actor);
 if not coalesce((access->>'manage')::boolean,false) then raise exception 'UNAUTHORIZED';end if;
 if (access->>'admin')::boolean then
  for person in select p.id from perfis p where (agenda_permission(p.id)->>'manage')::boolean order by p.id loop perform agenda_profile_ensure(person.id);end loop;
 end if;
 own:=agenda_profile_ensure(p_actor);cid:=coalesce(p_calendar,own);
 select owner_id into owner from agenda_calendars where id=cid;
 if not found then raise exception 'NOT_FOUND';end if;
 if owner is distinct from p_actor and not(access->>'admin')::boolean then raise exception 'UNAUTHORIZED';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'ownerId',c.owner_id,'name',coalesce(nullif(p.nome,''),'Perfil indisponível'),'isOwn',c.owner_id=p_actor,'active',coalesce((agenda_permission(c.owner_id)->>'manage')::boolean,false)) order by (c.owner_id=p_actor) desc,p.nome,c.id),'[]'::jsonb)
  into directory from agenda_calendars c left join perfis p on p.id=c.owner_id where (access->>'admin')::boolean or c.owner_id=p_actor;
 return jsonb_build_object('calendarId',cid,'ownerId',owner,'calendars',directory,'canConfigureGoogle',owner=p_actor,'canConfigureClient',(access->>'admin')::boolean);
end $$;


create or replace function public.agenda_profile_snapshot(p_calendar uuid,p_from date,p_until date,p_public boolean default false) returns jsonb language plpgsql security definer set search_path=public as $$
declare c agenda_calendars;begin
 if p_from is null or p_until is null or p_until<p_from or p_until-p_from>400 then raise exception 'VALIDATION';end if;
 select * into c from agenda_calendars where id=p_calendar;
 if not found then raise exception 'NOT_FOUND';end if;
 if p_public and not coalesce((agenda_permission(c.owner_id)->>'manage')::boolean,false) then c.settings:=c.settings||'{"enabled":false}'::jsonb;end if;
 return jsonb_build_object('settings',c.settings||jsonb_build_object('revision',c.revision),'weekly',c.weekly||jsonb_build_object('revision',c.weekly_revision),
 'extras',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('time',to_char(e.time,'HH24:MI'))) from agenda_extras e where e.calendar_id=p_calendar and e.date between p_from and p_until),'[]'::jsonb),
 'holds',coalesce((select jsonb_agg(to_jsonb(h)||jsonb_build_object('from',to_char(h.start_at at time zone 'America/Sao_Paulo','HH24:MI'),'until',to_char(h.end_at at time zone 'America/Sao_Paulo','HH24:MI'))) from agenda_holds h where h.calendar_id=p_calendar and h.date between p_from and p_until),'[]'::jsonb),
 'blocked',coalesce((select jsonb_agg(d.date) from agenda_blocked d where d.calendar_id=p_calendar and d.date between p_from and p_until),'[]'::jsonb),
 'bookings',coalesce((select jsonb_agg(to_jsonb(b)||jsonb_build_object('time',to_char(b.time,'HH24:MI')) order by b.start_at,b.id) from agenda_bookings b where b.calendar_id=p_calendar and b.date between p_from and p_until),'[]'::jsonb));
end $$;

-- Manhã: antes das 12h. Tarde: das 12h até o fim do dia, em Brasília.
-- start_at/end_at continuam sendo o horário real usado nos avisos e calendários.
create or replace function public.agenda_booking_occupation(p_mode text,p_start timestamptz,p_end timestamptz) returns tstzrange
language sql immutable strict set search_path=public as $$
 select case when p_mode='presencial' then tstzrange(
  (date_trunc('day',p_start at time zone 'America/Sao_Paulo')+case when extract(hour from p_start at time zone 'America/Sao_Paulo')<12 then interval '0 hours' else interval '12 hours' end) at time zone 'America/Sao_Paulo',
  greatest(p_end,(date_trunc('day',p_start at time zone 'America/Sao_Paulo')+case when extract(hour from p_start at time zone 'America/Sao_Paulo')<12 then interval '12 hours' else interval '1 day' end) at time zone 'America/Sao_Paulo'),'[)')
 else tstzrange(p_start,p_end,'[)') end;
$$;

create or replace function public.agenda_profile_book(p jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare cid uuid:=coalesce((p->>'calendar_id')::uuid,agenda_profile_legacy_id());c agenda_calendars;b agenda_bookings;uid uuid:=gen_random_uuid();g jsonb;starttime timestamptz;endtime timestamptz;day date;begin
 select * into c from agenda_calendars where id=cid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 select * into b from agenda_bookings where attempt=(p->>'attempt')::uuid;
 if found then
 if b.calendar_id<>cid or b.proof_hash<>p->>'proof_hash' or b.fingerprint<>p->>'fingerprint' then raise exception 'CONFLICT';end if;
 return to_jsonb(b)||jsonb_build_object('time',to_char(b.time,'HH24:MI'));end if;
 if not coalesce((agenda_permission(c.owner_id)->>'manage')::boolean,false) then raise exception 'CONFLICT';end if;
 if c.revision<>(p->>'revision')::uuid or not(c.settings->>'enabled')::boolean then raise exception 'CONFLICT';end if;
 starttime:=(p->>'start_at')::timestamptz;endtime:=(p->>'end_at')::timestamptz;day:=(p->>'date')::date;
 if starttime<=clock_timestamp()+((c.settings->>'noticeMinutes')::int*interval '1 minute') or day>(clock_timestamp() at time zone 'America/Sao_Paulo')::date+90
 or (starttime at time zone 'America/Sao_Paulo')::date<>day or (endtime at time zone 'America/Sao_Paulo')::date<>day
 or endtime<>starttime+((p->>'duration')::int*interval '1 minute') or (p->>'duration')::int not in(15,30,45,60,90)
 or length(p->>'contact_cipher')<32 or p->>'proof_hash'!~'^[a-f0-9]{64}$' or p->>'fingerprint'!~'^[a-f0-9]{64}$' then raise exception 'VALIDATION';end if;
 if exists(select 1 from agenda_blocked where calendar_id=cid and date=day)
 or exists(select 1 from agenda_holds where calendar_id=cid and tstzrange(start_at,end_at,'[)') && agenda_booking_occupation(p->>'mode',starttime,endtime))
 or exists(select 1 from agenda_bookings where calendar_id=cid and status<>'canceled' and agenda_booking_occupation(mode,start_at,end_at) && agenda_booking_occupation(p->>'mode',starttime,endtime)) then raise exception 'CONFLICT';end if;
 if (select count(*) from agenda_bookings where email_hash=p->>'email_hash' and created_at>clock_timestamp()-interval '24 hours')>=5 then raise exception 'RATE_LIMIT';end if;
 g:=case when p->>'mode'='online' and (c.settings->>'autoMeet')::boolean and c.google_connection_id is not null then
 jsonb_build_object('status','pending','connectionId',c.google_connection_id,'eventId','imp'||replace(uid::text,'-',''),'conferenceRequestId',gen_random_uuid()) else jsonb_build_object('status','manual') end;
 insert into agenda_bookings(calendar_id,id,attempt,proof_hash,fingerprint,client_hash,email_hash,slot_key,date,time,start_at,end_at,duration,mode,subject,contact_cipher,host_name,location,online_link,protocol,google,email_status)
 values(cid,uid,(p->>'attempt')::uuid,p->>'proof_hash',p->>'fingerprint',p->>'client_hash',p->>'email_hash',p->>'slot_key',day,(p->>'time')::time,starttime,endtime,(p->>'duration')::int,p->>'mode',p->>'subject',p->>'contact_cipher',c.settings->>'hostName',
 case when p->>'mode'='presencial' then coalesce(c.settings->>'presentialLocation','') else '' end,
 case when g->>'status'='manual' and p->>'mode'='online' then c.settings->>'onlineLink' else '' end,
 'IMP-'||to_char(day,'YYYYMMDD')||'-'||upper(substr(replace(uid::text,'-',''),1,8)),g,case when(p->>'email_configured')::boolean then 'pending' else 'not_configured' end) returning * into b;
 if g->>'status'='pending' then insert into agenda_jobs(booking_id,kind) values(uid,'google');end if;
 if(p->>'email_configured')::boolean then insert into agenda_jobs(booking_id,kind) values(uid,'email');end if;
 return to_jsonb(b)||jsonb_build_object('time',to_char(b.time,'HH24:MI'));
end $$;

create or replace function public.agenda_profile_mutate(p_actor uuid,p_calendar uuid,p_revision uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare c agenda_calendars;b agenda_bookings;r jsonb;added int:=0;d date;starttime timestamptz;endtime timestamptz;entity uuid;begin
 perform agenda_profile_context(p_actor,p_calendar);
 select * into c from agenda_calendars where id=p_calendar for update;
 if p_revision is not null and c.revision<>p_revision then raise exception 'CONFLICT';end if;
 case p_action
 when 'saveSettings' then update agenda_calendars set settings=p_data-'revision',revision=gen_random_uuid() where id=p_calendar;
 when 'saveWeekly' then
 if c.weekly_revision<>(p_data->>'weeklyRevision')::uuid then raise exception 'CONFLICT';end if;
 update agenda_calendars set weekly=p_data-'weeklyRevision',weekly_revision=gen_random_uuid(),revision=gen_random_uuid() where id=p_calendar;
 when 'addExtra' then
 if (select count(*) from agenda_extras where calendar_id=p_calendar and date>=(clock_timestamp() at time zone 'America/Sao_Paulo')::date)+jsonb_array_length(p_data)>1000 then raise exception 'VALIDATION';end if;
 for r in select value from jsonb_array_elements(p_data) loop
 starttime:=(r->>'start_at')::timestamptz;endtime:=(r->>'end_at')::timestamptz;
 if exists(select 1 from agenda_extras where calendar_id=p_calendar and start_at<endtime and end_at>starttime)
 or exists(select 1 from agenda_bookings where calendar_id=p_calendar and status<>'canceled' and agenda_booking_occupation(mode,start_at,end_at) && tstzrange(starttime,endtime,'[)'))
 or exists(select 1 from agenda_holds where calendar_id=p_calendar and start_at<endtime and end_at>starttime) then raise exception 'CONFLICT';end if;
 insert into agenda_extras(calendar_id,id,date,time,duration,modes,start_at,end_at) values(p_calendar,(r->>'id')::uuid,(r->>'date')::date,(r->>'time')::time,(r->>'duration')::int,r->'modes',starttime,endtime);added:=added+1;
 end loop;update agenda_calendars set revision=gen_random_uuid() where id=p_calendar;
 when 'removeExtra' then
 entity:=(p_data->>'id')::uuid;
 if exists(select 1 from agenda_bookings where calendar_id=p_calendar and slot_key='e:'||entity::text and status<>'canceled') then raise exception 'CONFLICT';end if;
 delete from agenda_extras where calendar_id=p_calendar and id=entity and revision=(p_data->>'revision')::uuid;
 if not found then raise exception 'CONFLICT';end if;
 update agenda_calendars set revision=gen_random_uuid() where id=p_calendar;
 when 'blockDay' then
 d:=(p_data->>'date')::date;if (p_data->>'blocked')::boolean then insert into agenda_blocked(calendar_id,date) values(p_calendar,d) on conflict do nothing;else delete from agenda_blocked where calendar_id=p_calendar and date=d;end if;
 update agenda_calendars set revision=gen_random_uuid() where id=p_calendar;
 when 'hold' then
 entity:=(p_data->>'id')::uuid;starttime:=(p_data->>'start_at')::timestamptz;endtime:=(p_data->>'end_at')::timestamptz;
 if exists(select 1 from agenda_holds where calendar_id=p_calendar and id=entity and start_at=starttime and end_at=endtime and reason=p_data->>'reason') then return '{}'::jsonb;end if;
 if exists(select 1 from agenda_holds where calendar_id=p_calendar and start_at<endtime and end_at>starttime)
 or exists(select 1 from agenda_bookings where calendar_id=p_calendar and status<>'canceled' and agenda_booking_occupation(mode,start_at,end_at) && tstzrange(starttime,endtime,'[)')) then raise exception 'CONFLICT';end if;
 insert into agenda_holds(calendar_id,id,date,start_at,end_at,reason) values(p_calendar,entity,(p_data->>'date')::date,starttime,endtime,p_data->>'reason');update agenda_calendars set revision=gen_random_uuid() where id=p_calendar;
 when 'releaseHold' then
 entity:=(p_data->>'id')::uuid;delete from agenda_holds where calendar_id=p_calendar and id=entity and revision=(p_data->>'holdRevision')::uuid;
 if not found and exists(select 1 from agenda_holds where calendar_id=p_calendar and id=entity) then raise exception 'CONFLICT';end if;
 update agenda_calendars set revision=gen_random_uuid() where id=p_calendar;
 when 'bookingStatus' then
 entity:=(p_data->>'id')::uuid;select * into b from agenda_bookings where calendar_id=p_calendar and id=entity for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if b.status=p_data->>'status' then return '{}'::jsonb;end if;
 if b.status<>'confirmed' or p_data->>'status' not in('canceled','completed') or(p_data->>'status'='completed' and b.start_at>clock_timestamp()) then raise exception 'CONFLICT';end if;
 update agenda_bookings set status=p_data->>'status',changed_at=clock_timestamp(),google=case when p_data->>'status'='canceled' and google->>'status'<>'manual' then google||'{"status":"cancel_pending"}'::jsonb else google end where id=entity and calendar_id=p_calendar;
 if p_data->>'status'='canceled' and b.google->>'status'<>'manual' then
 insert into agenda_jobs(booking_id,kind) values(entity,'google') on conflict(booking_id) where kind='google' do update set status='pending',next_at=clock_timestamp(),attempts=0;
 end if;
 else raise exception 'VALIDATION';end case;
 insert into agenda_audit(actor,action,entity,calendar_id) values(p_actor,p_action,entity,p_calendar);
 return jsonb_build_object('added',added);
end $$;


create or replace function public.agenda_profile_consume_oauth(p_state text,p_browser text) returns jsonb language plpgsql security definer set search_path=public as $$
declare o agenda_google_oauth;ctx jsonb;begin
 delete from agenda_google_oauth where state_hash=p_state and browser_hash=p_browser and expires_at>clock_timestamp() returning * into o;
 if not found then raise exception 'UNAUTHORIZED';end if;
 ctx:=agenda_profile_context(o.actor,o.calendar_id);
 if not coalesce((ctx->>'canConfigureGoogle')::boolean,false) then raise exception 'UNAUTHORIZED';end if;
 return to_jsonb(o);
end $$;
create or replace function public.agenda_profile_connect_google(p_actor uuid,p_calendar uuid,p_connection uuid) returns void language plpgsql security definer set search_path=public as $$
declare ctx jsonb;begin
 ctx:=agenda_profile_context(p_actor,p_calendar);
 if not coalesce((ctx->>'canConfigureGoogle')::boolean,false) then raise exception 'UNAUTHORIZED';end if;
 perform 1 from agenda_calendars where id=p_calendar for update;
 if not exists(select 1 from agenda_google_connections where id=p_connection and calendar_id=p_calendar and created_by=p_actor) then raise exception 'UNAUTHORIZED';end if;
 update agenda_calendars set google_connection_id=p_connection,settings=settings||'{"autoMeet":true}'::jsonb,revision=gen_random_uuid() where id=p_calendar;
 insert into agenda_audit(actor,action,entity,calendar_id) values(p_actor,'google_connect',p_connection,p_calendar);
end $$;
create or replace function public.agenda_profile_disconnect_google(p_actor uuid,p_calendar uuid) returns void language plpgsql security definer set search_path=public as $$
declare ctx jsonb;cid uuid;begin
 ctx:=agenda_profile_context(p_actor,p_calendar);
 if not coalesce((ctx->>'canConfigureGoogle')::boolean,false) then raise exception 'UNAUTHORIZED';end if;
 select google_connection_id into cid from agenda_calendars where id=p_calendar for update;
 update agenda_google_connections set cipher='',authorization_required=true where calendar_id=p_calendar;
 update agenda_calendars set google_connection_id=null,settings=settings||'{"autoMeet":false}'::jsonb,revision=gen_random_uuid() where id=p_calendar;
 delete from agenda_google_oauth where calendar_id=p_calendar;
 insert into agenda_audit(actor,action,entity,calendar_id) values(p_actor,'google_disconnect',cid,p_calendar);
end $$;
-- Compatibilidade com a função anterior durante a atualização: nunca agrega perfis.
create or replace function public.agenda_snapshot(p_from date,p_until date) returns jsonb language sql security definer set search_path=public as $$
 select agenda_profile_snapshot(agenda_profile_legacy_id(),p_from,p_until,true);
$$;
create or replace function public.agenda_book(p jsonb) returns jsonb language sql security definer set search_path=public as $$
 select agenda_profile_book(p||jsonb_build_object('calendar_id',agenda_profile_legacy_id()));
$$;
create or replace function public.agenda_mutate(p_actor uuid,p_revision uuid,p_action text,p_data jsonb) returns jsonb language sql security definer set search_path=public as $$
 select agenda_profile_mutate(p_actor,agenda_profile_legacy_id(),p_revision,p_action,p_data);
$$;
create or replace function public.agenda_consume_oauth(p_state text,p_browser text) returns jsonb language sql security definer set search_path=public as $$
 select agenda_profile_consume_oauth(p_state,p_browser);
$$;
create or replace function public.agenda_connect_google(p_actor uuid,p_connection uuid) returns void language sql security definer set search_path=public as $$
 select agenda_profile_connect_google(p_actor,agenda_profile_legacy_id(),p_connection);
$$;
create or replace function public.agenda_disconnect_google(p_actor uuid) returns void language sql security definer set search_path=public as $$
 select agenda_profile_disconnect_google(p_actor,agenda_profile_legacy_id());
$$;
do $$ declare fn record;begin
 for fn in select p.oid::regprocedure as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'agenda\_%' escape '\' loop
 execute format('revoke all on function %s from public,anon,authenticated',fn.name);
 execute format('grant execute on function %s to service_role',fn.name);
 end loop;
end $$;
commit;
