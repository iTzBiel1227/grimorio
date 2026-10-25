-- Grimório: Supabase Auth + PostgreSQL + Storage + Realtime.
-- Apply once to a dedicated Supabase project. No existing data is deleted.
-- Passwords, email addresses and sessions remain in Supabase's auth schema.
begin;

create schema grimorio_private;
revoke all on schema grimorio_private from public, anon, authenticated;
grant usage on schema grimorio_private to authenticated, service_role;

-- Provisioned by the project administrator, never by browser metadata.
-- No personal email addresses are stored in this versioned migration.
create table grimorio_private.admin_emails (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1)
);
revoke all on grimorio_private.admin_emails from public, anon, authenticated;
grant all on grimorio_private.admin_emails to service_role;
alter table grimorio_private.admin_emails enable row level security;

create function grimorio_private.valid_image(p_image text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare v_bytes bytea;
begin
  if p_image = '' then return true; end if;
  if p_image is null or length(p_image) > 4194400
    or p_image !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$' then return false; end if;
  v_bytes := decode(split_part(p_image, ',', 2), 'base64');
  if octet_length(v_bytes) < 3 or octet_length(v_bytes) > 3145728 then return false; end if;
  return case
    when p_image like 'data:image/png;%' then substring(v_bytes from 1 for 8) = decode('89504e470d0a1a0a', 'hex')
    when p_image like 'data:image/jpeg;%' then substring(v_bytes from 1 for 3) = decode('ffd8ff', 'hex')
    when p_image like 'data:image/webp;%' then substring(v_bytes from 1 for 4) = decode('52494646', 'hex')
      and substring(v_bytes from 9 for 4) = decode('57454250', 'hex')
    else false end;
exception when others then return false;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 32),
  avatar_data text not null default '' check (grimorio_private.valid_image(avatar_data)),
  account_code text not null unique check (account_code ~ '^[0-9]{8}$'),
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

create table public.character_sheets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null default 'Novo personagem' check (length(btrim(name)) between 1 and 70),
  data_json jsonb not null default '{}'::jsonb check (jsonb_typeof(data_json) = 'object' and octet_length(data_json::text) <= 2097152),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index character_sheets_user_updated_idx on public.character_sheets(user_id, updated_at desc);

create table public.grimoire_entries (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid default auth.uid() references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('spell', 'ability')),
  name text not null check (length(btrim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 5000),
  damage text not null default '' check (length(damage) <= 120),
  is_standard boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (is_standard or owner_user_id is not null)
);
create index grimoire_owner_idx on public.grimoire_entries(owner_user_id, kind, name);
create index grimoire_standard_idx on public.grimoire_entries(kind, name) where is_standard;

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9A-F]{6}$'),
  name text not null check (length(btrim(name)) between 1 and 70),
  system_name text not null default 'Sistema próprio' check (length(system_name) between 1 and 80),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'session')),
  state_json jsonb not null default '{"tokens":[],"rolls":[]}'::jsonb,
  created_at timestamptz not null default now(),
  constraint campaigns_public_state check (
    jsonb_typeof(state_json) = 'object'
    and state_json ?& array['tokens', 'rolls']
    and state_json - 'tokens' - 'rolls' = '{}'::jsonb
    and jsonb_typeof(state_json -> 'tokens') = 'array'
    and jsonb_typeof(state_json -> 'rolls') = 'array'
    and octet_length(state_json::text) <= 262144
  )
);
create index campaigns_owner_created_idx on public.campaigns(owner_user_id, created_at desc);

create table public.campaign_members (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  player_name text not null check (length(btrim(player_name)) between 1 and 24),
  joined_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);
create index campaign_members_user_idx on public.campaign_members(user_id, campaign_id);

-- Notes never travel with the public campaign state or its Realtime publication.
create table public.campaign_notes (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  notes text not null default '' check (length(notes) <= 10000)
);

create table public.campaign_sheet_assignments (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sheet_id uuid not null references public.character_sheets(id) on delete cascade,
  assigned_user_id uuid references public.profiles(id) on delete cascade,
  primary key (campaign_id, sheet_id),
  foreign key (campaign_id, assigned_user_id) references public.campaign_members(campaign_id, user_id) on delete cascade
);
create index campaign_assignments_sheet_idx on public.campaign_sheet_assignments(sheet_id);
create index campaign_assignments_user_idx on public.campaign_sheet_assignments(assigned_user_id, campaign_id);

create table public.friendships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'accepted' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_user_id),
  check (user_id <> friend_user_id)
);
create index friendships_friend_idx on public.friendships(friend_user_id);

create table public.campaign_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sender_user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  recipient_user_id uuid references public.profiles(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (campaign_id, sender_user_id) references public.campaign_members(campaign_id, user_id) on delete cascade,
  foreign key (campaign_id, recipient_user_id) references public.campaign_members(campaign_id, user_id) on delete cascade
);
create index campaign_messages_room_created_idx on public.campaign_messages(campaign_id, created_at desc);
create index campaign_messages_sender_idx on public.campaign_messages(sender_user_id);
create index campaign_messages_recipient_idx on public.campaign_messages(recipient_user_id);

create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index suggestions_user_idx on public.suggestions(user_id, created_at desc);

create table public.books (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  description text not null default '' check (length(description) <= 1000),
  cover_data text not null default '' check (grimorio_private.valid_image(cover_data)),
  pdf_path text not null unique check (pdf_path ~ '^[A-Za-z0-9_-]+[.]pdf$'),
  created_at timestamptz not null default now()
);
create index books_created_idx on public.books(created_at desc);

create table public.site_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  value jsonb not null check (jsonb_typeof(value) = 'object' and octet_length(value::text) <= 6291456)
);
-- Validate the public announcement on the database too: direct REST writes
-- must obey the same image and catalog-link rules as the browser editor.
create function grimorio_private.validate_home_feature()
returns trigger language plpgsql set search_path = '' as $$
declare v_image text; v_book_id text;
begin
  if new.key <> 'home_feature' then return new; end if;
  if not (new.value ?& array['imageData', 'bookId'])
    or jsonb_typeof(new.value -> 'imageData') <> 'string'
    or jsonb_typeof(new.value -> 'bookId') <> 'string' then
    raise exception 'Informe uma imagem válida e o livro do anúncio.' using errcode = '23514';
  end if;
  v_image := new.value ->> 'imageData';
  v_book_id := new.value ->> 'bookId';
  if v_image <> '/assets/grimorio-book.png'
    and (v_image = '' or not grimorio_private.valid_image(v_image)) then
    raise exception 'Envie uma imagem PNG, JPEG ou WebP válida de até 3 MB.' using errcode = '23514';
  end if;
  if v_book_id <> '' then
    if v_book_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Escolha um livro existente no catálogo.' using errcode = '23514';
    end if;
    if not exists(select 1 from public.books where id = v_book_id::uuid) then
      raise exception 'Escolha um livro existente no catálogo.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger site_settings_validate_home_feature before insert or update on public.site_settings
  for each row execute function grimorio_private.validate_home_feature();
insert into public.site_settings(key, value)
values ('home_feature', '{"imageData":"/assets/grimorio-book.png","bookId":""}'::jsonb);

-- Security-definer helpers live outside the exposed API schema. Their fixed
-- search_path and fully qualified tables avoid RLS recursion and object shadowing.
create function grimorio_private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;
create function grimorio_private.is_campaign_owner(p_campaign_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.campaigns c where c.id = p_campaign_id and c.owner_user_id = auth.uid());
$$;
create function grimorio_private.is_campaign_member(p_campaign_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.campaign_members m where m.campaign_id = p_campaign_id and m.user_id = auth.uid());
$$;
create function grimorio_private.can_manage_sheet(p_sheet_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.character_sheets s
    join public.campaign_members m on m.user_id = s.user_id
    join public.campaigns c on c.id = m.campaign_id
    where s.id = p_sheet_id and c.owner_user_id = auth.uid()
  );
$$;
create function grimorio_private.can_read_assigned_sheet(p_sheet_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.campaign_sheet_assignments a
    join public.campaign_members m on m.campaign_id = a.campaign_id and m.user_id = a.assigned_user_id
    join public.character_sheets s on s.id = a.sheet_id
    join public.campaign_members owner_member on owner_member.campaign_id = a.campaign_id and owner_member.user_id = s.user_id
    where a.sheet_id = p_sheet_id and a.assigned_user_id = auth.uid()
  );
$$;
create function grimorio_private.can_access_campaign_topic(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.campaign_members m
    where 'campaign:' || m.campaign_id::text = p_topic and m.user_id = auth.uid()
  );
$$;

create function grimorio_private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger character_sheets_touch before update on public.character_sheets
  for each row execute function grimorio_private.touch_updated_at();
create trigger grimoire_entries_touch before update on public.grimoire_entries
  for each row execute function grimorio_private.touch_updated_at();

create function grimorio_private.create_profile(p_user_id uuid, p_display_name text, p_created_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_attempt integer; v_code text;
begin
  if exists(select 1 from public.profiles where id = p_user_id) then return; end if;
  for v_attempt in 1..100 loop
    v_code := lpad(floor(random() * 100000000)::integer::text, 8, '0');
    begin
      insert into public.profiles(id, display_name, account_code, created_at)
      values (p_user_id, left(btrim(coalesce(p_display_name, '')), 32), v_code, coalesce(p_created_at, now()));
      return;
    exception when unique_violation then
      if exists(select 1 from public.profiles where id = p_user_id) then return; end if;
    end;
  end loop;
  raise exception 'Não foi possível gerar um código de conta. Tente novamente.';
end;
$$;
create function grimorio_private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Only a display name is accepted from user-editable Auth metadata.
  perform grimorio_private.create_profile(new.id, new.raw_user_meta_data ->> 'display_name', new.created_at);
  return new;
end;
$$;
create trigger grimorio_auth_user_created after insert on auth.users
  for each row execute function grimorio_private.handle_new_user();

create function grimorio_private.promote_verified_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email_confirmed_at is not null and exists(
    select 1 from grimorio_private.admin_emails a where a.email = lower(btrim(new.email))
  ) then update public.profiles set role = 'admin' where id = new.id; end if;
  return new;
end;
$$;
create trigger grimorio_verified_admin after insert or update of email, email_confirmed_at on auth.users
  for each row execute function grimorio_private.promote_verified_admin();
do $$
declare v_user record;
begin
  for v_user in select id, raw_user_meta_data, created_at from auth.users loop
    perform grimorio_private.create_profile(v_user.id, v_user.raw_user_meta_data ->> 'display_name', v_user.created_at);
  end loop;
end;
$$;

create function grimorio_private.validate_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists(
    select 1 from public.character_sheets s join public.campaign_members m on m.user_id = s.user_id
    where s.id = new.sheet_id and m.campaign_id = new.campaign_id
  ) then raise exception 'A ficha deve pertencer a um participante desta campanha.' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger campaign_assignment_member before insert or update on public.campaign_sheet_assignments
  for each row execute function grimorio_private.validate_assignment();

-- Default grants differ between Supabase projects, so start with explicit grants.
revoke all on public.profiles, public.character_sheets, public.grimoire_entries,
  public.campaigns, public.campaign_members, public.campaign_notes,
  public.campaign_sheet_assignments, public.friendships, public.campaign_messages,
  public.suggestions, public.books, public.site_settings from public, anon, authenticated;
grant all on public.profiles, public.character_sheets, public.grimoire_entries,
  public.campaigns, public.campaign_members, public.campaign_notes,
  public.campaign_sheet_assignments, public.friendships, public.campaign_messages,
  public.suggestions, public.books, public.site_settings to service_role;
grant select on public.profiles, public.character_sheets, public.grimoire_entries,
  public.campaigns, public.campaign_members, public.campaign_notes,
  public.campaign_sheet_assignments, public.friendships, public.campaign_messages,
  public.suggestions to authenticated;
grant update(display_name, avatar_data) on public.profiles to authenticated;
grant insert, delete on public.character_sheets to authenticated;
grant update(name, data_json, updated_at) on public.character_sheets to authenticated;
grant insert, delete on public.grimoire_entries to authenticated;
grant update(kind, name, description, damage, is_standard, updated_at) on public.grimoire_entries to authenticated;
grant update(name, status) on public.campaigns to authenticated;
grant insert, update, delete on public.campaign_notes, public.campaign_sheet_assignments to authenticated;
grant insert on public.campaign_messages, public.suggestions to authenticated;
grant select on public.books, public.site_settings to anon, authenticated;
grant insert, update, delete on public.books, public.site_settings to authenticated;

alter table public.profiles enable row level security;
alter table public.character_sheets enable row level security;
alter table public.grimoire_entries enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.campaign_notes enable row level security;
alter table public.campaign_sheet_assignments enable row level security;
alter table public.friendships enable row level security;
alter table public.campaign_messages enable row level security;
alter table public.suggestions enable row level security;
alter table public.books enable row level security;
alter table public.site_settings enable row level security;

create policy profiles_directory on public.profiles for select to authenticated using (true);
create policy profiles_edit_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy sheets_read on public.character_sheets for select to authenticated
  using (user_id = (select auth.uid()) or grimorio_private.can_manage_sheet(id) or grimorio_private.can_read_assigned_sheet(id));
create policy sheets_create on public.character_sheets for insert to authenticated with check (user_id = (select auth.uid()));
create policy sheets_edit on public.character_sheets for update to authenticated
  using (user_id = (select auth.uid()) or grimorio_private.can_manage_sheet(id))
  with check (user_id = (select auth.uid()) or grimorio_private.can_manage_sheet(id));
create policy sheets_delete on public.character_sheets for delete to authenticated using (user_id = (select auth.uid()));
create policy grimoire_read on public.grimoire_entries for select to authenticated
  using (is_standard or owner_user_id = (select auth.uid()) or grimorio_private.is_admin());
create policy grimoire_create on public.grimoire_entries for insert to authenticated
  with check ((owner_user_id = (select auth.uid()) and not is_standard) or grimorio_private.is_admin());
create policy grimoire_edit on public.grimoire_entries for update to authenticated
  using ((owner_user_id = (select auth.uid()) and not is_standard) or grimorio_private.is_admin())
  with check ((owner_user_id = (select auth.uid()) and not is_standard) or grimorio_private.is_admin());
create policy grimoire_delete on public.grimoire_entries for delete to authenticated
  using ((owner_user_id = (select auth.uid()) and not is_standard) or grimorio_private.is_admin());
create policy campaigns_read on public.campaigns for select to authenticated using (grimorio_private.is_campaign_member(id));
create policy campaigns_edit on public.campaigns for update to authenticated
  using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));
create policy campaign_members_read on public.campaign_members for select to authenticated
  using (grimorio_private.is_campaign_member(campaign_id));
create policy campaign_notes_owner on public.campaign_notes for all to authenticated
  using (grimorio_private.is_campaign_owner(campaign_id)) with check (grimorio_private.is_campaign_owner(campaign_id));
create policy campaign_assignments_read on public.campaign_sheet_assignments for select to authenticated
  using (grimorio_private.is_campaign_member(campaign_id));
create policy campaign_assignments_master on public.campaign_sheet_assignments for all to authenticated
  using (grimorio_private.is_campaign_owner(campaign_id)) with check (grimorio_private.is_campaign_owner(campaign_id));
create policy friendships_read_self on public.friendships for select to authenticated using (user_id = (select auth.uid()));
create policy campaign_messages_read on public.campaign_messages for select to authenticated using (
  grimorio_private.is_campaign_member(campaign_id)
  and (recipient_user_id is null or recipient_user_id = (select auth.uid()) or sender_user_id = (select auth.uid()))
);
create policy campaign_messages_send on public.campaign_messages for insert to authenticated with check (
  sender_user_id = (select auth.uid()) and grimorio_private.is_campaign_member(campaign_id)
  -- The composite FK additionally restricts recipients to this same campaign.
);
create policy suggestions_create on public.suggestions for insert to authenticated with check (user_id = (select auth.uid()));
create policy suggestions_read on public.suggestions for select to authenticated
  using (user_id = (select auth.uid()) or grimorio_private.is_admin());
create policy books_public_read on public.books for select to anon, authenticated using (true);
create policy books_admin_write on public.books for all to authenticated
  using (grimorio_private.is_admin()) with check (grimorio_private.is_admin());
create policy home_public_read on public.site_settings for select to anon, authenticated using (key = 'home_feature');
create policy settings_admin_write on public.site_settings for all to authenticated
  using (grimorio_private.is_admin()) with check (grimorio_private.is_admin());

create function grimorio_private.campaign_json(p_campaign public.campaigns)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', p_campaign.id, 'code', p_campaign.code, 'name', p_campaign.name,
    'status', p_campaign.status, 'systemName', p_campaign.system_name,
    'createdAt', p_campaign.created_at, 'state', p_campaign.state_json);
$$;

create function grimorio_private.create_campaign(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_campaign public.campaigns; v_code text; v_name text;
begin
  if v_user is null then raise exception 'Faça login para continuar.' using errcode = '42501'; end if;
  v_name := left(btrim(coalesce(p_name, '')), 70);
  if v_name = '' then raise exception 'Digite um nome para a campanha.' using errcode = '22023'; end if;
  loop
    v_code := upper(left(replace(gen_random_uuid()::text, '-', ''), 6));
    begin
      insert into public.campaigns(code, name, owner_user_id, state_json)
      values (v_code, v_name, v_user, jsonb_build_object('tokens', jsonb_build_array(
        jsonb_build_object('id', gen_random_uuid(), 'name', 'Herói 1', 'x', 3, 'y', 3, 'color', '#a78bfa'),
        jsonb_build_object('id', gen_random_uuid(), 'name', 'Herói 2', 'x', 5, 'y', 3, 'color', '#60a5fa')
      ), 'rolls', '[]'::jsonb)) returning * into v_campaign;
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  insert into public.campaign_members(campaign_id, user_id, player_name) values (v_campaign.id, v_user, 'Mestre');
  insert into public.campaign_notes(campaign_id) values (v_campaign.id);
  return jsonb_build_object('campaign', grimorio_private.campaign_json(v_campaign), 'role', 'master', 'playerName', 'Mestre');
end;
$$;

create function grimorio_private.get_campaign(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_campaign public.campaigns; v_name text; v_role text; v_result jsonb;
begin
  if v_user is null then raise exception 'Faça login para continuar.' using errcode = '42501'; end if;
  select * into v_campaign from public.campaigns where code = upper(btrim(coalesce(p_code, '')));
  if not found then raise exception 'Campanha não encontrada.' using errcode = 'P0002'; end if;
  select player_name into v_name from public.campaign_members where campaign_id = v_campaign.id and user_id = v_user;
  v_role := case when v_campaign.owner_user_id = v_user then 'master' when v_name is not null then 'player' else 'guest' end;
  v_result := grimorio_private.campaign_json(v_campaign);
  if v_role = 'guest' then
    -- Possession of an invite code permits only this preview, never player data.
    v_result := jsonb_set(v_result, '{state}', '{"tokens":[],"rolls":[]}'::jsonb);
  end if;
  return jsonb_build_object('campaign', v_result, 'role', v_role, 'playerName', coalesce(v_name, ''));
end;
$$;

create function grimorio_private.join_campaign(p_code text, p_player_name text default 'Aventureiro')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_campaign public.campaigns; v_name text;
begin
  if v_user is null then raise exception 'Faça login para continuar.' using errcode = '42501'; end if;
  -- Lock the campaign so simultaneous joins cannot exceed the participant limit.
  select * into v_campaign from public.campaigns where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'Campanha não encontrada.' using errcode = 'P0002'; end if;
  if v_campaign.owner_user_id = v_user then return grimorio_private.get_campaign(v_campaign.code); end if;
  if not exists(select 1 from public.campaign_members where campaign_id = v_campaign.id and user_id = v_user)
    and (select count(*) from public.campaign_members where campaign_id = v_campaign.id) >= 10 then
    raise exception 'Esta campanha já atingiu o limite de 10 participantes.' using errcode = '54000';
  end if;
  v_name := coalesce(nullif(left(btrim(coalesce(p_player_name, '')), 24), ''), 'Aventureiro');
  insert into public.campaign_members(campaign_id, user_id, player_name) values (v_campaign.id, v_user, v_name)
    on conflict (campaign_id, user_id) do update set player_name = excluded.player_name;
  return grimorio_private.get_campaign(v_campaign.code);
end;
$$;

create function grimorio_private.fold_name(p_name text)
returns text language sql immutable set search_path = '' as $$
  select translate(lower(coalesce(p_name, '')),
    'áàâãäåéèêëíìîïóòôõöúùûüçñýÿ', 'aaaaaaeeeeiiiiooooouuuucnyy');
$$;
create function grimorio_private.search_players(p_query text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_query text := left(btrim(coalesce(p_query, '')), 80); v_result jsonb;
begin
  if v_user is null then raise exception 'Faça login para continuar.' using errcode = '42501'; end if;
  if length(v_query) < 2 then return '{"users":[]}'::jsonb; end if;
  select coalesce(jsonb_agg(to_jsonb(matches)), '[]'::jsonb) into v_result from (
    select p.id, p.display_name as "displayName", p.avatar_data as "avatarData", p.account_code as "accountCode",
      exists(select 1 from public.friendships f where f.user_id = v_user and f.friend_user_id = p.id) as "isFriend"
    from public.profiles p where p.id <> v_user and
      case when v_query ~ '^[0-9]{8}$' then p.account_code = v_query
        else position(grimorio_private.fold_name(v_query) in grimorio_private.fold_name(p.display_name)) > 0 end
    order by p.display_name, p.account_code limit 20
  ) matches;
  return jsonb_build_object('users', v_result);
end;
$$;
create function grimorio_private.add_friend(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_friend public.profiles; v_code text := btrim(coalesce(p_code, ''));
begin
  if v_user is null then raise exception 'Faça login para continuar.' using errcode = '42501'; end if;
  if v_code !~ '^[0-9]{8}$' then raise exception 'Informe o código de 8 números.' using errcode = '22023'; end if;
  select * into v_friend from public.profiles where account_code = v_code;
  if not found then raise exception 'Nenhuma conta encontrada com esse código.' using errcode = 'P0002'; end if;
  if v_friend.id = v_user then raise exception 'Você não pode adicionar a si mesmo.' using errcode = '22023'; end if;
  -- Stable ordering avoids a deadlock when both players add each other at once.
  insert into public.friendships(user_id, friend_user_id, status)
    select a, b, 'accepted' from (values (v_user, v_friend.id), (v_friend.id, v_user)) pairs(a, b) order by a
    on conflict (user_id, friend_user_id) do update set status = 'accepted';
  return jsonb_build_object('friend', jsonb_build_object('id', v_friend.id,
    'displayName', v_friend.display_name, 'avatarData', v_friend.avatar_data, 'accountCode', v_friend.account_code));
end;
$$;

create function grimorio_private.move_campaign_token(p_code text, p_token_id text, p_x integer, p_y integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_campaign public.campaigns; v_tokens jsonb;
begin
  if auth.uid() is null then raise exception 'Faça login para continuar.' using errcode = '42501'; end if;
  select * into v_campaign from public.campaigns where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or not grimorio_private.is_campaign_member(v_campaign.id) then
    raise exception 'Entre nesta campanha para mover as peças.' using errcode = '42501'; end if;
  if p_x is null or p_y is null then raise exception 'Posição inválida.' using errcode = '22023'; end if;
  if not exists(select 1 from jsonb_array_elements(v_campaign.state_json -> 'tokens') token where token ->> 'id' = p_token_id) then
    raise exception 'Peça não encontrada.' using errcode = 'P0002'; end if;
  select jsonb_agg(case when token ->> 'id' = p_token_id then
    token || jsonb_build_object('x', greatest(0, least(29, p_x)), 'y', greatest(0, least(19, p_y)))
    else token end order by ord) into v_tokens
    from jsonb_array_elements(v_campaign.state_json -> 'tokens') with ordinality tokens(token, ord);
  update public.campaigns set state_json = jsonb_set(state_json, '{tokens}', v_tokens)
    where id = v_campaign.id returning * into v_campaign;
  return grimorio_private.campaign_json(v_campaign);
end;
$$;
create function grimorio_private.roll_campaign_dice(p_code text, p_sides integer, p_modifier integer default 0,
  p_label text default '', p_character_name text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_campaign public.campaigns; v_name text; v_value integer; v_modifier integer; v_roll jsonb; v_rolls jsonb;
begin
  if auth.uid() is null then raise exception 'Faça login para continuar.' using errcode = '42501'; end if;
  if p_sides is null or p_sides not in (4, 6, 8, 10, 12, 20, 100) then raise exception 'Dado inválido.' using errcode = '22023'; end if;
  select * into v_campaign from public.campaigns where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then raise exception 'Campanha não encontrada.' using errcode = 'P0002'; end if;
  select player_name into v_name from public.campaign_members where campaign_id = v_campaign.id and user_id = auth.uid();
  if not found then raise exception 'Entre nesta campanha para rolar os dados.' using errcode = '42501'; end if;
  v_value := 1 + floor(random() * p_sides)::integer;
  v_modifier := greatest(-100, least(100, coalesce(p_modifier, 0)));
  v_roll := jsonb_build_object('id', gen_random_uuid(), 'player', v_name,
    'characterName', left(btrim(coalesce(p_character_name, '')), 70),
    'label', left(btrim(coalesce(p_label, '')), 60), 'sides', p_sides,
    'value', v_value, 'modifier', v_modifier, 'total', v_value + v_modifier, 'at', now());
  select coalesce(jsonb_agg(roll order by ord), '[]'::jsonb) into v_rolls
    from jsonb_array_elements(jsonb_build_array(v_roll) || (v_campaign.state_json -> 'rolls')) with ordinality rolls(roll, ord)
    where ord <= 30;
  update public.campaigns set state_json = jsonb_set(state_json, '{rolls}', v_rolls) where id = v_campaign.id;
  return v_roll;
end;
$$;

-- The exposed RPCs are invokers. Privileged operations stay in the unexposed
-- schema, with their own JWT ownership checks and explicit EXECUTE grants.
create function public.create_campaign(p_name text)
returns jsonb language sql security invoker set search_path = '' as $$
  select grimorio_private.create_campaign(p_name);
$$;
create function public.get_campaign(p_code text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select grimorio_private.get_campaign(p_code);
$$;
create function public.join_campaign(p_code text, p_player_name text default 'Aventureiro')
returns jsonb language sql security invoker set search_path = '' as $$
  select grimorio_private.join_campaign(p_code, p_player_name);
$$;
create function public.search_players(p_query text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select grimorio_private.search_players(p_query);
$$;
create function public.add_friend(p_code text)
returns jsonb language sql security invoker set search_path = '' as $$
  select grimorio_private.add_friend(p_code);
$$;
create function public.move_campaign_token(p_code text, p_token_id text, p_x integer, p_y integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select grimorio_private.move_campaign_token(p_code, p_token_id, p_x, p_y);
$$;
create function public.roll_campaign_dice(p_code text, p_sides integer, p_modifier integer default 0,
  p_label text default '', p_character_name text default '')
returns jsonb language sql security invoker set search_path = '' as $$
  select grimorio_private.roll_campaign_dice(p_code, p_sides, p_modifier, p_label, p_character_name);
$$;

-- Functions otherwise default to EXECUTE for PUBLIC in PostgreSQL.
revoke all on all functions in schema grimorio_private from public, anon, authenticated;
grant execute on function grimorio_private.valid_image(text), grimorio_private.is_admin(),
  grimorio_private.is_campaign_owner(uuid), grimorio_private.is_campaign_member(uuid),
  grimorio_private.can_manage_sheet(uuid), grimorio_private.can_read_assigned_sheet(uuid),
  grimorio_private.can_access_campaign_topic(text) to authenticated;
grant execute on function grimorio_private.create_campaign(text), grimorio_private.get_campaign(text),
  grimorio_private.join_campaign(text, text), grimorio_private.search_players(text),
  grimorio_private.add_friend(text), grimorio_private.move_campaign_token(text, text, integer, integer),
  grimorio_private.roll_campaign_dice(text, integer, integer, text, text) to authenticated;
grant execute on all functions in schema grimorio_private to service_role;
revoke all on function public.create_campaign(text), public.get_campaign(text), public.join_campaign(text, text),
  public.search_players(text), public.add_friend(text), public.move_campaign_token(text, text, integer, integer),
  public.roll_campaign_dice(text, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.create_campaign(text), public.get_campaign(text), public.join_campaign(text, text),
  public.search_players(text), public.add_friend(text), public.move_campaign_token(text, text, integer, integer),
  public.roll_campaign_dice(text, integer, integer, text, text) to authenticated, service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('book-pdfs', 'book-pdfs', true, 20971520, array['application/pdf']);
create policy grimorio_pdf_read on storage.objects for select to anon, authenticated using (bucket_id = 'book-pdfs');
create policy grimorio_pdf_create on storage.objects for insert to authenticated
  with check (bucket_id = 'book-pdfs' and name ~ '^[A-Za-z0-9_-]+[.]pdf$' and grimorio_private.is_admin());
create policy grimorio_pdf_update on storage.objects for update to authenticated
  using (bucket_id = 'book-pdfs' and grimorio_private.is_admin())
  with check (bucket_id = 'book-pdfs' and name ~ '^[A-Za-z0-9_-]+[.]pdf$' and grimorio_private.is_admin());
create policy grimorio_pdf_delete on storage.objects for delete to authenticated
  using (bucket_id = 'book-pdfs' and grimorio_private.is_admin());

-- Only the campaign participants can authorize a private presence channel.
grant select, insert on realtime.messages to authenticated;
create policy grimorio_campaign_realtime_read on realtime.messages for select to authenticated
  using (extension in ('presence', 'broadcast') and grimorio_private.can_access_campaign_topic((select realtime.topic())));
create policy grimorio_campaign_realtime_write on realtime.messages for insert to authenticated
  with check (extension in ('presence', 'broadcast') and grimorio_private.can_access_campaign_topic((select realtime.topic())));
alter publication supabase_realtime add table public.campaigns, public.campaign_members, public.campaign_messages;

commit;
