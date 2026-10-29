-- Phase 1: campaign hub, private covers and the minimum session lifecycle.
-- Existing campaigns, members, notes, sheets and table state are preserved.
begin;

create function grimorio_private.valid_campaign_cover_path(p_path text, p_campaign_id uuid)
returns boolean language sql immutable set search_path = '' as $$
  select p_path = '' or (
    split_part(p_path, '/', 1) = p_campaign_id::text
    and p_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,80}[.](png|jpg|jpeg|webp)$'
  );
$$;

alter table public.campaigns
  add column description text not null default '' check (length(description) <= 4000),
  add column recent_summary text not null default '' check (length(recent_summary) <= 4000),
  add column next_session_at timestamptz check (isfinite(next_session_at)),
  add column cover_path text not null default '' check (grimorio_private.valid_campaign_cover_path(cover_path, id));

create table public.campaign_sessions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  number integer not null check (number > 0),
  title text not null check (length(btrim(title)) between 1 and 120),
  started_at timestamptz not null default now() check (isfinite(started_at)),
  ended_at timestamptz check (isfinite(ended_at) and ended_at >= started_at),
  unique(campaign_id, number)
);
create unique index campaign_sessions_one_active on public.campaign_sessions(campaign_id) where ended_at is null;
-- The unique (campaign_id, number) index also serves descending history scans.
create index campaign_sessions_last_ended on public.campaign_sessions(campaign_id, number desc) where ended_at is not null;

-- The previous application only stored status, not a historical start date.
-- Preserve open tables with one session starting at migration time; do not
-- fabricate earlier dates or sessions. This is documented in GRIMORIO_EXPANSAO.md.
insert into public.campaign_sessions(campaign_id, number, title)
select id, 1, 'Sessão em andamento' from public.campaigns where status = 'session';

alter table public.campaign_sessions enable row level security;
revoke all on public.campaign_sessions from public, anon, authenticated;
grant select on public.campaign_sessions to authenticated;
grant all on public.campaign_sessions to service_role;
create policy campaign_sessions_members_read on public.campaign_sessions for select to authenticated
  using (grimorio_private.is_campaign_member(campaign_id) or grimorio_private.is_campaign_owner(campaign_id));

-- Older deployed clients update status directly. Keep the existing owner-only
-- RLS and column grant, but make every such transition maintain the same session
-- lifecycle in its transaction. UPDATE already holds the campaign row lock.
create function grimorio_private.sync_campaign_status_session()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_number integer; v_user uuid := auth.uid();
begin
  -- Unauthenticated/browser writes are rejected by campaigns_edit RLS before
  -- this trigger. Trusted database maintenance can retain its normal privileges.
  if v_user is not null and new.owner_user_id <> v_user then
    raise exception 'Somente o mestre pode alterar a sessão.' using errcode = '42501';
  end if;
  if new.status = 'session' then
    if not exists(select 1 from public.campaign_sessions where campaign_id = new.id and ended_at is null) then
      select coalesce(max(number), 0) + 1 into v_number from public.campaign_sessions where campaign_id = new.id;
      insert into public.campaign_sessions(campaign_id, number, title)
        values(new.id, v_number, 'Sessão ' || v_number);
    end if;
  elsif new.status = 'lobby' then
    update public.campaign_sessions set ended_at = greatest(now(), started_at)
      where campaign_id = new.id and ended_at is null;
  end if;
  return new;
end;
$$;
revoke all on function grimorio_private.sync_campaign_status_session() from public, anon, authenticated;
create trigger campaigns_status_session after update of status on public.campaigns
  for each row execute function grimorio_private.sync_campaign_status_session();

create function grimorio_private.campaign_session_json(p_session public.campaign_sessions)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p_session.id is null then null else jsonb_build_object(
    'id', p_session.id, 'number', p_session.number, 'title', p_session.title,
    'startedAt', p_session.started_at, 'endedAt', p_session.ended_at
  ) end;
$$;

create function grimorio_private.get_campaign_hub(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_campaign public.campaigns; v_owner boolean;
  v_master jsonb; v_members jsonb; v_sessions jsonb; v_active jsonb; v_last jsonb; v_players integer;
begin
  if v_user is null then raise exception 'Faça login para continuar.' using errcode = '42501'; end if;
  select * into v_campaign from public.campaigns where code = upper(btrim(coalesce(p_code, '')));
  if not found or not (v_campaign.owner_user_id = v_user or exists(
    select 1 from public.campaign_members where campaign_id = v_campaign.id and user_id = v_user
  )) then
    raise exception 'Campanha não encontrada ou acesso não permitido.' using errcode = '42501';
  end if;
  v_owner := v_campaign.owner_user_id = v_user;
  select jsonb_build_object('id', id, 'displayName', display_name, 'avatarData', avatar_data)
    into v_master from public.profiles where id = v_campaign.owner_user_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'displayName', p.display_name, 'playerName', m.player_name,
    'avatarData', p.avatar_data, 'isMaster', p.id = v_campaign.owner_user_id
  ) order by (p.id = v_campaign.owner_user_id) desc, m.joined_at, p.id), '[]'::jsonb),
    count(*) filter (where p.id <> v_campaign.owner_user_id)
    into v_members, v_players
    from public.campaign_members m join public.profiles p on p.id = m.user_id where m.campaign_id = v_campaign.id;
  select grimorio_private.campaign_session_json(s) into v_active
    from public.campaign_sessions s where s.campaign_id = v_campaign.id and s.ended_at is null;
  select grimorio_private.campaign_session_json(s) into v_last
    from public.campaign_sessions s where s.campaign_id = v_campaign.id and s.ended_at is not null order by s.number desc limit 1;
  select coalesce(jsonb_agg(grimorio_private.campaign_session_json(s) order by s.number desc), '[]'::jsonb)
    into v_sessions from (select * from public.campaign_sessions where campaign_id = v_campaign.id order by number desc limit 20) s;
  return jsonb_build_object(
    'campaign', jsonb_build_object('id', v_campaign.id, 'code', v_campaign.code, 'name', v_campaign.name,
      'systemName', v_campaign.system_name, 'status', v_campaign.status, 'createdAt', v_campaign.created_at,
      'description', v_campaign.description, 'coverPath', v_campaign.cover_path,
      'nextSessionAt', v_campaign.next_session_at, 'recentSummary', v_campaign.recent_summary),
    'role', case when v_owner then 'master' else 'player' end,
    'permissions', jsonb_build_object('canManage', v_owner, 'canViewPrivate', v_owner, 'canStartSession', v_owner and v_active is null),
    'master', v_master, 'members', v_members, 'playerCount', v_players, 'maxPlayers', 10,
    'activeSession', v_active, 'lastSession', v_last, 'sessions', v_sessions
  );
end;
$$;

create function grimorio_private.update_campaign_hub(p_code text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_campaign public.campaigns; v_key text; v_next timestamptz;
begin
  if v_user is null then raise exception 'Faça login para continuar.' using errcode = '42501'; end if;
  select * into v_campaign from public.campaigns where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or v_campaign.owner_user_id <> v_user then
    raise exception 'Somente o mestre pode gerenciar esta campanha.' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Informe os dados da campanha.' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('name', 'description', 'recentSummary', 'nextSessionAt', 'coverPath') then
      raise exception 'Campo de campanha não permitido: %.', v_key using errcode = '22023';
    end if;
    if v_key <> 'nextSessionAt' and jsonb_typeof(p_patch -> v_key) <> 'string' then
      raise exception 'Confira o campo %.', v_key using errcode = '22023';
    end if;
  end loop;
  if p_patch ? 'name' then
    v_campaign.name := btrim(p_patch ->> 'name');
    if length(v_campaign.name) not between 1 and 70 then raise exception 'Use um nome de 1 a 70 caracteres.' using errcode = '22023'; end if;
  end if;
  if p_patch ? 'description' then v_campaign.description := btrim(p_patch ->> 'description'); end if;
  if p_patch ? 'recentSummary' then v_campaign.recent_summary := btrim(p_patch ->> 'recentSummary'); end if;
  if length(v_campaign.description) > 4000 or length(v_campaign.recent_summary) > 4000 then
    raise exception 'Descrição e resumo devem ter até 4000 caracteres.' using errcode = '22023';
  end if;
  if p_patch ? 'nextSessionAt' then
    if p_patch -> 'nextSessionAt' = 'null'::jsonb then v_campaign.next_session_at := null;
    else
      if jsonb_typeof(p_patch -> 'nextSessionAt') <> 'string'
        or (p_patch ->> 'nextSessionAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}([.]\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$' then
        raise exception 'Informe uma data e horário válidos para a próxima sessão.' using errcode = '22023';
      end if;
      begin v_next := (p_patch ->> 'nextSessionAt')::timestamptz;
      exception when others then raise exception 'Informe uma data e horário válidos para a próxima sessão.' using errcode = '22023'; end;
      if not isfinite(v_next) then raise exception 'Informe uma data válida.' using errcode = '22023'; end if;
      v_campaign.next_session_at := v_next;
    end if;
  end if;
  if p_patch ? 'coverPath' then
    v_campaign.cover_path := p_patch ->> 'coverPath';
    if not grimorio_private.valid_campaign_cover_path(v_campaign.cover_path, v_campaign.id)
      or (v_campaign.cover_path <> '' and not exists(
        select 1 from storage.objects where bucket_id = 'campaign-covers' and name = v_campaign.cover_path
      )) then
      raise exception 'Envie uma capa válida para esta campanha antes de salvar.' using errcode = '22023';
    end if;
  end if;
  update public.campaigns set name = v_campaign.name, description = v_campaign.description,
    recent_summary = v_campaign.recent_summary, next_session_at = v_campaign.next_session_at,
    cover_path = v_campaign.cover_path where id = v_campaign.id;
  return grimorio_private.get_campaign_hub(v_campaign.code);
end;
$$;

create function grimorio_private.start_campaign_session(p_code text, p_title text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_campaign public.campaigns; v_session public.campaign_sessions; v_number integer; v_title text;
begin
  if v_user is null then raise exception 'Faça login para continuar.' using errcode = '42501'; end if;
  -- Serializes lifecycle transitions and session numbering for this campaign.
  select * into v_campaign from public.campaigns where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or v_campaign.owner_user_id <> v_user then
    raise exception 'Somente o mestre pode iniciar uma sessão.' using errcode = '42501';
  end if;
  select * into v_session from public.campaign_sessions where campaign_id = v_campaign.id and ended_at is null;
  if not found then
    v_title := btrim(coalesce(p_title, ''));
    if length(v_title) > 120 then raise exception 'O título da sessão deve ter até 120 caracteres.' using errcode = '22023'; end if;
    select coalesce(max(number), 0) + 1 into v_number from public.campaign_sessions where campaign_id = v_campaign.id;
    insert into public.campaign_sessions(campaign_id, number, title)
      values(v_campaign.id, v_number, coalesce(nullif(v_title, ''), 'Sessão ' || v_number)) returning * into v_session;
    update public.campaigns set status = 'session' where id = v_campaign.id;
  end if;
  return jsonb_build_object('ok', true, 'session', grimorio_private.campaign_session_json(v_session));
end;
$$;

create function grimorio_private.end_campaign_session(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_campaign public.campaigns; v_session public.campaign_sessions;
begin
  if v_user is null then raise exception 'Faça login para continuar.' using errcode = '42501'; end if;
  select * into v_campaign from public.campaigns where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or v_campaign.owner_user_id <> v_user then
    raise exception 'Somente o mestre pode encerrar uma sessão.' using errcode = '42501';
  end if;
  update public.campaign_sessions set ended_at = greatest(now(), started_at)
    where campaign_id = v_campaign.id and ended_at is null returning * into v_session;
  if not found then
    select * into v_session from public.campaign_sessions where campaign_id = v_campaign.id order by number desc limit 1;
  end if;
  if v_campaign.status <> 'lobby' then update public.campaigns set status = 'lobby' where id = v_campaign.id; end if;
  return jsonb_build_object('ok', true, 'session', grimorio_private.campaign_session_json(v_session));
end;
$$;

-- Covers are private. Signed URLs are issued only after Storage checks these
-- member policies; no public URL or public bucket is used for campaign media.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('campaign-covers', 'campaign-covers', false, 3145728, array['image/png', 'image/jpeg', 'image/webp']);

create function grimorio_private.can_read_campaign_cover(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.campaigns c where c.id::text = split_part(p_name, '/', 1)
      and grimorio_private.valid_campaign_cover_path(p_name, c.id)
      and (c.owner_user_id = auth.uid() or exists(
        select 1 from public.campaign_members m where m.campaign_id = c.id and m.user_id = auth.uid()
      ))
  );
$$;
create function grimorio_private.can_manage_campaign_cover(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(
    select 1 from public.campaigns c where c.id::text = split_part(p_name, '/', 1)
      and c.owner_user_id = auth.uid() and grimorio_private.valid_campaign_cover_path(p_name, c.id)
  );
$$;
create policy campaign_covers_members_read on storage.objects for select to authenticated
  using (bucket_id = 'campaign-covers' and grimorio_private.can_read_campaign_cover(name));
create policy campaign_covers_master_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'campaign-covers' and grimorio_private.can_manage_campaign_cover(name));
create policy campaign_covers_master_delete on storage.objects for delete to authenticated
  using (bucket_id = 'campaign-covers' and grimorio_private.can_manage_campaign_cover(name));
-- No UPDATE policy: replacement uploads must use a new immutable path.

create function public.get_campaign_hub(p_code text)
returns jsonb language sql stable security invoker set search_path = '' as $$ select grimorio_private.get_campaign_hub(p_code); $$;
create function public.update_campaign_hub(p_code text, p_patch jsonb)
returns jsonb language sql security invoker set search_path = '' as $$ select grimorio_private.update_campaign_hub(p_code, p_patch); $$;
create function public.start_campaign_session(p_code text, p_title text default '')
returns jsonb language sql security invoker set search_path = '' as $$ select grimorio_private.start_campaign_session(p_code, p_title); $$;
create function public.end_campaign_session(p_code text)
returns jsonb language sql security invoker set search_path = '' as $$ select grimorio_private.end_campaign_session(p_code); $$;

revoke all on function grimorio_private.valid_campaign_cover_path(text,uuid),
  grimorio_private.campaign_session_json(public.campaign_sessions), grimorio_private.get_campaign_hub(text),
  grimorio_private.update_campaign_hub(text,jsonb), grimorio_private.start_campaign_session(text,text),
  grimorio_private.end_campaign_session(text), grimorio_private.can_read_campaign_cover(text),
  grimorio_private.can_manage_campaign_cover(text), public.get_campaign_hub(text),
  public.update_campaign_hub(text,jsonb), public.start_campaign_session(text,text), public.end_campaign_session(text)
  from public, anon, authenticated;
grant execute on function grimorio_private.valid_campaign_cover_path(text,uuid),
  grimorio_private.get_campaign_hub(text), grimorio_private.update_campaign_hub(text,jsonb),
  grimorio_private.start_campaign_session(text,text), grimorio_private.end_campaign_session(text),
  grimorio_private.can_read_campaign_cover(text), grimorio_private.can_manage_campaign_cover(text),
  public.get_campaign_hub(text), public.update_campaign_hub(text,jsonb),
  public.start_campaign_session(text,text), public.end_campaign_session(text) to authenticated;
grant execute on function grimorio_private.valid_campaign_cover_path(text,uuid),
  grimorio_private.campaign_session_json(public.campaign_sessions), grimorio_private.get_campaign_hub(text),
  grimorio_private.update_campaign_hub(text,jsonb), grimorio_private.start_campaign_session(text,text),
  grimorio_private.end_campaign_session(text), grimorio_private.can_read_campaign_cover(text),
  grimorio_private.can_manage_campaign_cover(text), public.get_campaign_hub(text),
  public.update_campaign_hub(text,jsonb), public.start_campaign_session(text,text), public.end_campaign_session(text) to service_role;

-- campaigns is already published; its status/metadata changes signal the Hub.
-- Private notes and Storage objects remain outside the realtime publication.
commit;
