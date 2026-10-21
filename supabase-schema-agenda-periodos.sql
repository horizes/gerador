-- Reserva presencial por período. Aplicar depois da agenda por perfil.
-- Aditiva e reaplicável. Não altera horários, contatos, eventos ou protocolos.
begin;
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
revoke all on function public.agenda_booking_occupation(text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.agenda_booking_occupation(text,timestamptz,timestamptz) to service_role;
commit;
