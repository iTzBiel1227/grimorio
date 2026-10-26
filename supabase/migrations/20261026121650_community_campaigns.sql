-- Community, distinct account identities and collaborative campaigns.
-- Existing accounts, friendships, sheets, campaigns and books are retained.
begin;

alter table public.profiles add column username text;
update public.profiles set username = 'jogador_' || account_code;
alter table public.profiles alter column username set not null;
alter table public.profiles add constraint profiles_username_format check (username ~ '^[a-zA-Z0-9_]{3,24}$');
create unique index profiles_username_unique on public.profiles(lower(username));

-- Birth dates never enter the public profile directory or Realtime publication.
create table public.account_details (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  birth_date date not null check (birth_date >= date '1900-01-01' and birth_date <= current_date)
);
alter table public.account_details enable row level security;
revoke all on public.account_details from public, anon, authenticated;
grant select on public.account_details to authenticated;
grant all on public.account_details to service_role;
create policy account_details_owner on public.account_details for select to authenticated using (user_id = (select auth.uid()));

-- Admin access is now granted explicitly to a reviewed existing account.
-- Do not infer it from a self-reported email or an old allowlist, even if Auth
-- confirmation settings are changed later. Existing admins remain.
drop trigger grimorio_verified_admin on auth.users;
drop function grimorio_private.promote_verified_admin();

create or replace function grimorio_private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_username text; v_birth date; v_code text; v_attempt integer;
begin
  v_username := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  if v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Use um nome de usuário com 3 a 24 letras, números ou sublinhados.' using errcode = '22023';
  end if;
  if coalesce(new.raw_user_meta_data ->> 'birth_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Informe uma data de nascimento válida.' using errcode = '22023';
  end if;
  begin v_birth := (new.raw_user_meta_data ->> 'birth_date')::date;
  exception when others then raise exception 'Informe uma data de nascimento válida.' using errcode = '22023'; end;
  if v_birth < date '1900-01-01' or v_birth > current_date then
    raise exception 'Informe uma data de nascimento válida.' using errcode = '22023';
  end if;
  if exists(select 1 from public.profiles where lower(username) = v_username) then
    raise exception 'Esse nome de usuário já está em uso.' using errcode = '23505';
  end if;
  for v_attempt in 1..100 loop
    v_code := lpad(floor(random() * 100000000)::integer::text, 8, '0');
    begin
      insert into public.profiles(id, username, display_name, account_code, created_at)
      values(new.id, v_username, left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), v_username),32), v_code, coalesce(new.created_at,now()));
      exit;
    exception when unique_violation then
      if exists(select 1 from public.profiles where lower(username) = v_username) then
        raise exception 'Esse nome de usuário já está em uso.' using errcode = '23505';
      end if;
      if v_attempt = 100 then raise exception 'Não foi possível gerar um código de conta. Tente novamente.'; end if;
    end;
  end loop;
  insert into public.account_details(user_id,birth_date) values(new.id,v_birth);
  return new;
end;
$$;

create function grimorio_private.profile_json(p_profile public.profiles)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id',p_profile.id,'username',p_profile.username,'displayName',p_profile.display_name,
    'avatarData',p_profile.avatar_data,'accountCode',p_profile.account_code);
$$;

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(sender_user_id <> recipient_user_id)
);
create unique index friend_requests_pending_pair on public.friend_requests(least(sender_user_id,recipient_user_id),greatest(sender_user_id,recipient_user_id)) where status='pending';
create index friend_requests_sender_idx on public.friend_requests(sender_user_id,status,created_at desc);
create index friend_requests_recipient_idx on public.friend_requests(recipient_user_id,status,created_at desc);
alter table public.friend_requests enable row level security;
revoke all on public.friend_requests from public,anon,authenticated;
grant select on public.friend_requests to authenticated;
grant all on public.friend_requests to service_role;
create policy friend_requests_participants on public.friend_requests for select to authenticated
  using(sender_user_id=(select auth.uid()) or recipient_user_id=(select auth.uid()));
-- Preserve any pending records from older deployments as explicit requests.
insert into public.friend_requests(sender_user_id,recipient_user_id,created_at)
select distinct on (least(user_id,friend_user_id),greatest(user_id,friend_user_id)) user_id,friend_user_id,created_at
from public.friendships where status='pending'
order by least(user_id,friend_user_id),greatest(user_id,friend_user_id),created_at;
delete from public.friendships where status='pending';

create or replace function grimorio_private.add_friend(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_friend public.profiles; v_request public.friend_requests;
begin
  if v_user is null then raise exception 'Faça login para continuar.' using errcode='42501'; end if;
  if btrim(coalesce(p_code,'')) !~ '^[0-9]{8}$' then raise exception 'Informe o código de 8 números.' using errcode='22023'; end if;
  select * into v_friend from public.profiles where account_code=btrim(p_code);
  if not found then raise exception 'Nenhuma conta encontrada com esse código.' using errcode='P0002'; end if;
  if v_friend.id=v_user then raise exception 'Você não pode adicionar a si mesmo.' using errcode='22023'; end if;
  perform id from public.profiles where id in(v_user,v_friend.id) order by id for update;
  if exists(select 1 from public.friendships where user_id=v_user and friend_user_id=v_friend.id and status='accepted') then
    raise exception 'Vocês já são amigos.' using errcode='22023';
  end if;
  select * into v_request from public.friend_requests where status='pending' and
    least(sender_user_id,recipient_user_id)=least(v_user,v_friend.id) and greatest(sender_user_id,recipient_user_id)=greatest(v_user,v_friend.id);
  if not found then
    insert into public.friend_requests(sender_user_id,recipient_user_id) values(v_user,v_friend.id) returning * into v_request;
  end if;
  return jsonb_build_object('request',jsonb_build_object('id',v_request.id,'status',v_request.status,'direction',
    case when v_request.sender_user_id=v_user then 'outgoing' else 'incoming' end,'person',grimorio_private.profile_json(v_friend),'createdAt',v_request.created_at));
end;
$$;

create function grimorio_private.respond_friend_request(p_request_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_request public.friend_requests;
begin
  if v_user is null then raise exception 'Faça login para continuar.' using errcode='42501'; end if;
  select * into v_request from public.friend_requests where id=p_request_id;
  if not found or v_user not in(v_request.sender_user_id,v_request.recipient_user_id) then
    raise exception 'Solicitação não encontrada.' using errcode='42501'; end if;
  perform id from public.profiles where id in(v_request.sender_user_id,v_request.recipient_user_id) order by id for update;
  select * into v_request from public.friend_requests where id=p_request_id for update;
  if v_request.status<>'pending' then raise exception 'Esta solicitação já foi respondida.' using errcode='22023'; end if;
  if p_action in('accept','decline') and v_user=v_request.recipient_user_id then
    if p_action='accept' then
      insert into public.friendships(user_id,friend_user_id,status)
      select a,b,'accepted' from (values(v_request.sender_user_id,v_request.recipient_user_id),(v_request.recipient_user_id,v_request.sender_user_id)) pairs(a,b) order by a
      on conflict(user_id,friend_user_id) do update set status='accepted';
    end if;
    update public.friend_requests set status=case when p_action='accept' then 'accepted' else 'declined' end,updated_at=now() where id=p_request_id;
  elsif p_action='cancel' and v_user=v_request.sender_user_id then
    update public.friend_requests set status='cancelled',updated_at=now() where id=p_request_id;
  else raise exception 'Você não pode executar esta ação.' using errcode='42501'; end if;
  return jsonb_build_object('ok',true);
end;
$$;
create function grimorio_private.remove_friend(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null or p_user_id is null or v_user=p_user_id then raise exception 'Amizade inválida.' using errcode='42501'; end if;
  perform id from public.profiles where id in(v_user,p_user_id) order by id for update;
  delete from public.friendships where (user_id=v_user and friend_user_id=p_user_id) or(user_id=p_user_id and friend_user_id=v_user);
  return jsonb_build_object('ok',true);
end;
$$;
create or replace function grimorio_private.search_players(p_query text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_query text:=left(btrim(coalesce(p_query,'')),80); v_result jsonb;
begin
  if v_user is null then raise exception 'Faça login para continuar.' using errcode='42501'; end if;
  if length(v_query)<2 then return '{"users":[]}'::jsonb; end if;
  select coalesce(jsonb_agg(to_jsonb(matches)),'[]'::jsonb) into v_result from (
    select p.id,p.username,p.display_name as "displayName",p.avatar_data as "avatarData",p.account_code as "accountCode",
      exists(select 1 from public.friendships f where f.user_id=v_user and f.friend_user_id=p.id and f.status='accepted') as "isFriend",
      (select r.id from public.friend_requests r where r.status='pending' and least(r.sender_user_id,r.recipient_user_id)=least(v_user,p.id)
        and greatest(r.sender_user_id,r.recipient_user_id)=greatest(v_user,p.id)) as "requestId",
      (select case when r.sender_user_id=v_user then 'outgoing' else 'incoming' end from public.friend_requests r where r.status='pending'
        and least(r.sender_user_id,r.recipient_user_id)=least(v_user,p.id) and greatest(r.sender_user_id,r.recipient_user_id)=greatest(v_user,p.id)) as "requestDirection"
    from public.profiles p where p.id<>v_user and case when v_query ~ '^[0-9]{8}$' then p.account_code=v_query else
      position(grimorio_private.fold_name(v_query) in grimorio_private.fold_name(p.display_name))>0 or position(lower(v_query) in lower(p.username))>0 end
    order by p.display_name,p.account_code limit 20
  ) matches;
  return jsonb_build_object('users',v_result);
end;
$$;

create table public.campaign_invitations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  inviter_user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check(status in('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(inviter_user_id<>recipient_user_id)
);
create unique index campaign_invitations_pending on public.campaign_invitations(campaign_id,recipient_user_id) where status='pending';
create index campaign_invitations_recipient_idx on public.campaign_invitations(recipient_user_id,status,created_at desc);
create index campaign_invitations_inviter_idx on public.campaign_invitations(inviter_user_id);
alter table public.campaign_invitations enable row level security;
revoke all on public.campaign_invitations from public,anon,authenticated;
grant select on public.campaign_invitations to authenticated;
grant all on public.campaign_invitations to service_role;
create policy campaign_invitation_participants on public.campaign_invitations for select to authenticated
  using(recipient_user_id=(select auth.uid()) or grimorio_private.is_campaign_owner(campaign_id));
create function grimorio_private.invite_campaign_player(p_code text,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_campaign public.campaigns; v_invite public.campaign_invitations;
begin
  if v_user is null then raise exception 'Faça login para continuar.' using errcode='42501'; end if;
  select * into v_campaign from public.campaigns where code=upper(btrim(p_code)) for update;
  if not found or v_campaign.owner_user_id<>v_user then raise exception 'Somente o mestre pode convidar jogadores.' using errcode='42501'; end if;
  if not exists(select 1 from public.friendships where user_id=v_user and friend_user_id=p_user_id and status='accepted') then
    raise exception 'Escolha um amigo para convidar.' using errcode='22023'; end if;
  if exists(select 1 from public.campaign_members where campaign_id=v_campaign.id and user_id=p_user_id) then
    raise exception 'Este jogador já participa da campanha.' using errcode='22023'; end if;
  select * into v_invite from public.campaign_invitations where campaign_id=v_campaign.id and recipient_user_id=p_user_id and status='pending';
  if not found then insert into public.campaign_invitations(campaign_id,inviter_user_id,recipient_user_id)
    values(v_campaign.id,v_user,p_user_id) returning * into v_invite; end if;
  return jsonb_build_object('invite',jsonb_build_object('id',v_invite.id,'campaignId',v_campaign.id,'code',v_campaign.code,
    'campaignName',v_campaign.name,'recipientUserId',p_user_id,'status',v_invite.status,'createdAt',v_invite.created_at));
end;
$$;
create function grimorio_private.respond_campaign_invite(p_invite_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_invite public.campaign_invitations; v_campaign public.campaigns; v_result jsonb;
begin
  if v_user is null then raise exception 'Faça login para continuar.' using errcode='42501'; end if;
  select * into v_invite from public.campaign_invitations where id=p_invite_id;
  if not found or v_invite.recipient_user_id<>v_user then raise exception 'Convite não encontrado.' using errcode='42501'; end if;
  -- Same lock order as invite/join: campaign first, then invitation.
  select * into v_campaign from public.campaigns where id=v_invite.campaign_id for update;
  select * into v_invite from public.campaign_invitations where id=p_invite_id for update;
  if v_invite.status<>'pending' then raise exception 'Este convite já foi respondido.' using errcode='22023'; end if;
  if p_action='accept' then
    v_result:=grimorio_private.join_campaign(v_campaign.code,(select left(display_name,24) from public.profiles where id=v_user));
    update public.campaign_invitations set status='accepted',updated_at=now() where id=p_invite_id;
    return v_result;
  elsif p_action='decline' then
    update public.campaign_invitations set status='declined',updated_at=now() where id=p_invite_id;
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'Resposta inválida.' using errcode='22023';
end;
$$;
create function grimorio_private.get_campaign_invitations()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Faça login para continuar.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'campaignId',c.id,'code',c.code,'campaignName',c.name,
    'person',grimorio_private.profile_json(p),'status',i.status,'createdAt',i.created_at) order by i.created_at desc),'[]'::jsonb)
    into v_result from public.campaign_invitations i join public.campaigns c on c.id=i.campaign_id
    join public.profiles p on p.id=i.inviter_user_id where i.recipient_user_id=auth.uid() and i.status='pending';
  return jsonb_build_object('invites',v_result);
end;
$$;

create table public.sheet_folders (
  id uuid primary key default gen_random_uuid(),user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  parent_id uuid references public.sheet_folders(id) on delete set null,
  name text not null check(length(btrim(name)) between 1 and 80),created_at timestamptz not null default now(),
  check(id<>parent_id)
);
create index sheet_folders_owner_idx on public.sheet_folders(user_id,parent_id);
create index sheet_folders_parent_idx on public.sheet_folders(parent_id);
alter table public.sheet_folders enable row level security;
revoke all on public.sheet_folders from public,anon,authenticated;
grant select,insert,delete on public.sheet_folders to authenticated;
grant update(name,parent_id) on public.sheet_folders to authenticated;
grant all on public.sheet_folders to service_role;
create policy folders_owner on public.sheet_folders for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create function grimorio_private.validate_folder()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Serialize hierarchy edits per owner, including concurrent opposite moves.
  perform id from public.profiles where id=new.user_id for update;
  if new.parent_id is not null then
    if not exists(select 1 from public.sheet_folders where id=new.parent_id and user_id=new.user_id) then
      raise exception 'Escolha uma pasta da sua biblioteca.' using errcode='23514'; end if;
    if exists(with recursive ancestors as (
      select id,parent_id from public.sheet_folders where id=new.parent_id
      union select f.id,f.parent_id from public.sheet_folders f join ancestors a on f.id=a.parent_id
    ) select 1 from ancestors where id=new.id) then
      raise exception 'Uma pasta não pode ficar dentro de si mesma ou de uma subpasta sua.' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;
create trigger sheet_folders_validate before insert or update on public.sheet_folders for each row execute function grimorio_private.validate_folder();
alter table public.character_sheets add column folder_id uuid references public.sheet_folders(id) on delete set null;
alter table public.character_sheets add column version bigint not null default 1;
create index character_sheets_folder_idx on public.character_sheets(folder_id);
grant update(folder_id) on public.character_sheets to authenticated;
create function grimorio_private.validate_sheet_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' then
    if new.user_id<>old.user_id then raise exception 'O dono da ficha não pode ser alterado.' using errcode='23514'; end if;
    new.version:=old.version+1;
    if new.folder_id is distinct from old.folder_id and auth.uid() is not null and auth.uid()<>new.user_id then
      raise exception 'Somente o dono pode organizar esta ficha.' using errcode='42501'; end if;
  else new.version:=1; end if;
  if new.folder_id is not null and not exists(select 1 from public.sheet_folders where id=new.folder_id and user_id=new.user_id) then
    raise exception 'Escolha uma pasta do dono da ficha.' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger character_sheets_validate before insert or update on public.character_sheets for each row execute function grimorio_private.validate_sheet_update();
drop policy sheets_edit on public.character_sheets;
create policy sheets_edit on public.character_sheets for update to authenticated
  using(user_id=(select auth.uid()) or grimorio_private.can_manage_sheet(id) or grimorio_private.can_read_assigned_sheet(id))
  with check(user_id=(select auth.uid()) or grimorio_private.can_manage_sheet(id) or grimorio_private.can_read_assigned_sheet(id));
create function grimorio_private.save_character_sheet(p_sheet_id uuid,p_name text,p_data jsonb,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_sheet public.character_sheets;
begin
  if auth.uid() is null then raise exception 'Faça login para continuar.' using errcode='42501'; end if;
  select * into v_sheet from public.character_sheets where id=p_sheet_id for update;
  if not found or not(v_sheet.user_id=auth.uid() or grimorio_private.can_manage_sheet(p_sheet_id) or grimorio_private.can_read_assigned_sheet(p_sheet_id)) then
    raise exception 'Ficha não encontrada nesta biblioteca ou campanha.' using errcode='42501'; end if;
  if p_expected_version is null or v_sheet.version<>p_expected_version then
    raise exception 'Esta ficha foi atualizada por outra pessoa. Recarregue antes de salvar.' using errcode='40001'; end if;
  update public.character_sheets set name=btrim(p_name),data_json=p_data where id=p_sheet_id returning * into v_sheet;
  return jsonb_build_object('sheet',jsonb_build_object('id',v_sheet.id,'userId',v_sheet.user_id,'name',v_sheet.name,'data',v_sheet.data_json,
    'folderId',v_sheet.folder_id,'version',v_sheet.version,'createdAt',v_sheet.created_at,'updatedAt',v_sheet.updated_at));
end;
$$;

create table public.campaign_rolls (
  id uuid primary key default gen_random_uuid(),campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,player_name text not null,
  character_name text not null default '',label text not null default '',sides integer not null check(sides in(4,6,8,10,12,20,100)),
  value integer not null check(value>=1 and value<=sides),modifier integer not null check(modifier between -100 and 100),
  total integer not null,animation_seed integer not null,created_at timestamptz not null default now(),check(total=value+modifier)
);
create index campaign_rolls_room_created_idx on public.campaign_rolls(campaign_id,created_at desc,id);
create index campaign_rolls_user_idx on public.campaign_rolls(user_id);
alter table public.campaign_rolls enable row level security;
revoke all on public.campaign_rolls from public,anon,authenticated;
grant select on public.campaign_rolls to authenticated;
grant all on public.campaign_rolls to service_role;
create policy campaign_rolls_members on public.campaign_rolls for select to authenticated using(grimorio_private.is_campaign_member(campaign_id));
-- Preserve the rolling history already held by campaigns before this migration.
insert into public.campaign_rolls(id,campaign_id,player_name,character_name,label,sides,value,modifier,total,animation_seed,created_at)
select (r->>'id')::uuid,c.id,coalesce(r->>'player','Jogador'),coalesce(r->>'characterName',''),coalesce(r->>'label',''),
  (r->>'sides')::integer,(r->>'value')::integer,(r->>'modifier')::integer,(r->>'total')::integer,0,(r->>'at')::timestamptz
from public.campaigns c cross join lateral jsonb_array_elements(c.state_json->'rolls') r on conflict(id) do nothing;
create or replace function grimorio_private.roll_campaign_dice(p_code text,p_sides integer,p_modifier integer default 0,p_label text default '',p_character_name text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_campaign public.campaigns; v_name text; v_value integer; v_modifier integer; v_roll jsonb; v_rolls jsonb; v_id uuid:=gen_random_uuid(); v_seed integer; v_at timestamptz:=clock_timestamp();
begin
  if auth.uid() is null then raise exception 'Faça login para continuar.' using errcode='42501'; end if;
  if p_sides is null or p_sides not in(4,6,8,10,12,20,100) then raise exception 'Dado inválido.' using errcode='22023'; end if;
  select * into v_campaign from public.campaigns where code=upper(btrim(coalesce(p_code,''))) for update;
  if not found then raise exception 'Campanha não encontrada.' using errcode='P0002'; end if;
  select player_name into v_name from public.campaign_members where campaign_id=v_campaign.id and user_id=auth.uid();
  if not found then raise exception 'Entre nesta campanha para rolar os dados.' using errcode='42501'; end if;
  v_value:=1+floor(random()*p_sides)::integer;
  v_modifier:=greatest(-100,least(100,coalesce(p_modifier,0)));
  v_seed:=floor(random()*2147483647)::integer;
  v_roll:=jsonb_build_object('id',v_id,'player',v_name,'characterName',left(btrim(coalesce(p_character_name,'')),70),
    'label',left(btrim(coalesce(p_label,'')),60),'sides',p_sides,'value',v_value,'modifier',v_modifier,'total',v_value+v_modifier,
    'at',v_at,'createdAt',v_at,'seed',v_seed);
  insert into public.campaign_rolls(id,campaign_id,user_id,player_name,character_name,label,sides,value,modifier,total,animation_seed,created_at)
    values(v_id,v_campaign.id,auth.uid(),v_name,v_roll->>'characterName',v_roll->>'label',p_sides,v_value,v_modifier,v_value+v_modifier,v_seed,v_at);
  select coalesce(jsonb_agg(roll order by ord),'[]'::jsonb) into v_rolls
    from jsonb_array_elements(jsonb_build_array(v_roll)||(v_campaign.state_json->'rolls')) with ordinality rolls(roll,ord) where ord<=30;
  update public.campaigns set state_json=jsonb_set(state_json,'{rolls}',v_rolls) where id=v_campaign.id;
  return v_roll;
end;
$$;

create function grimorio_private.admin_find_account(p_email text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_profile public.profiles; v_email text;
begin
  if auth.uid() is null or not grimorio_private.is_admin() then raise exception 'Acesso exclusivo de administradores.' using errcode='42501'; end if;
  select p.* into v_profile from public.profiles p join auth.users u on u.id=p.id where lower(u.email)=lower(btrim(p_email));
  if not found then raise exception 'Nenhuma conta cadastrada com esse e-mail.' using errcode='P0002'; end if;
  select email into v_email from auth.users where id=v_profile.id;
  return jsonb_build_object('user',grimorio_private.profile_json(v_profile)||jsonb_build_object('email',v_email,'role',v_profile.role));
end;
$$;
create function grimorio_private.admin_grant_access(p_email text,p_account_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles;
begin
  if auth.uid() is null or not grimorio_private.is_admin() then raise exception 'Acesso exclusivo de administradores.' using errcode='42501'; end if;
  select p.* into v_profile from public.profiles p join auth.users u on u.id=p.id
    where lower(u.email)=lower(btrim(p_email)) and p.account_code=btrim(p_account_code) for update of p;
  if not found then raise exception 'Confira o e-mail e o código da conta que receberá acesso.' using errcode='22023'; end if;
  update public.profiles set role='admin' where id=v_profile.id;
  return jsonb_build_object('user',grimorio_private.profile_json(v_profile)||jsonb_build_object('role','admin'));
end;
$$;

-- Public site copy is admin-managed, separate from the book advertisement.
insert into public.site_settings(key,value) values('site_content',jsonb_build_object(
  'heroTitle','Histórias feitas entre amigos.','heroBody','Um lugar para reunir sua mesa, dar vida aos personagens e viver novas aventuras.',
  'aboutTitle','Criado por amigos, para jogar juntos.','aboutBody','O Grimório é um projeto amador, sem fins lucrativos, criado por amigos para reunir nossas aventuras de RPG em um lugar prático, divertido e cheio de possibilidades.',
  'supportText','Em breve, abriremos uma vaquinha para quem quiser ajudar a manter e melhorar o projeto.','supportUrl','')) on conflict(key) do nothing;
create function grimorio_private.validate_site_content()
returns trigger language plpgsql set search_path='' as $$
declare v_key text; v_value text;
begin
  if new.key<>'site_content' then return new; end if;
  if not(new.value ?& array['heroTitle','heroBody','aboutTitle','aboutBody','supportText','supportUrl']) then
    raise exception 'Preencha os textos da página inicial.' using errcode='23514'; end if;
  foreach v_key in array array['heroTitle','heroBody','aboutTitle','aboutBody','supportText','supportUrl'] loop
    if jsonb_typeof(new.value->v_key)<>'string' then raise exception 'O conteúdo deve ser texto.' using errcode='23514'; end if;
    v_value:=new.value->>v_key;
    if length(v_value)>3000 or(v_key in('heroTitle','aboutTitle') and length(btrim(v_value)) not between 1 and 120) then
      raise exception 'Revise o tamanho dos textos da página inicial.' using errcode='23514'; end if;
  end loop;
  if new.value->>'supportUrl'<>'' and (new.value->>'supportUrl' !~* '^https?://[^[:space:]/]+([/?#][^[:space:]]*)?$') then
    raise exception 'Use um endereço HTTP ou HTTPS válido para o apoio.' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger site_settings_validate_content before insert or update on public.site_settings for each row execute function grimorio_private.validate_site_content();
revoke all on function grimorio_private.validate_site_content() from public,anon,authenticated;
drop policy home_public_read on public.site_settings;
create policy home_public_read on public.site_settings for select to anon,authenticated using(key in('home_feature','site_content'));

create function grimorio_private.clear_featured_book() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.site_settings set value=jsonb_set(value,'{bookId}','""'::jsonb)
    where key='home_feature' and value->>'bookId'=old.id::text;
  return old;
end;
$$;
revoke all on function grimorio_private.clear_featured_book() from public,anon,authenticated;
create trigger books_clear_home_feature before delete on public.books for each row execute function grimorio_private.clear_featured_book();

create function grimorio_private.list_campaign_invites()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Faça login para continuar.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'campaign',jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'systemName',c.system_name),
    'inviter',grimorio_private.profile_json(p),'person',grimorio_private.profile_json(r),'status',i.status,'createdAt',i.created_at) order by i.created_at desc),'[]'::jsonb)
    into v_result from public.campaign_invitations i join public.campaigns c on c.id=i.campaign_id
    join public.profiles p on p.id=i.inviter_user_id join public.profiles r on r.id=i.recipient_user_id
    where (i.recipient_user_id=auth.uid() or c.owner_user_id=auth.uid()) and i.status='pending';
  return jsonb_build_object('invites',v_result);
end;
$$;
create function public.list_campaign_invites() returns jsonb language sql stable security invoker set search_path='' as $$ select grimorio_private.list_campaign_invites(); $$;
revoke all on function grimorio_private.list_campaign_invites(),public.list_campaign_invites() from public,anon,authenticated;
grant execute on function grimorio_private.list_campaign_invites(),public.list_campaign_invites() to authenticated,service_role;

create function public.respond_friend_request(p_request_id uuid,p_action text) returns jsonb language sql security invoker set search_path='' as $$ select grimorio_private.respond_friend_request(p_request_id,p_action); $$;
create function public.remove_friend(p_user_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select grimorio_private.remove_friend(p_user_id); $$;
create function public.invite_campaign_player(p_code text,p_user_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select grimorio_private.invite_campaign_player(p_code,p_user_id); $$;
create function public.respond_campaign_invite(p_invite_id uuid,p_action text) returns jsonb language sql security invoker set search_path='' as $$ select grimorio_private.respond_campaign_invite(p_invite_id,p_action); $$;
create function public.get_campaign_invitations() returns jsonb language sql stable security invoker set search_path='' as $$ select grimorio_private.get_campaign_invitations(); $$;
create function public.save_character_sheet(p_sheet_id uuid,p_name text,p_data jsonb,p_expected_version bigint) returns jsonb language sql security invoker set search_path='' as $$ select grimorio_private.save_character_sheet(p_sheet_id,p_name,p_data,p_expected_version); $$;
create function public.admin_find_account(p_email text) returns jsonb language sql stable security invoker set search_path='' as $$ select grimorio_private.admin_find_account(p_email); $$;
create function public.admin_grant_access(p_email text,p_account_code text) returns jsonb language sql security invoker set search_path='' as $$ select grimorio_private.admin_grant_access(p_email,p_account_code); $$;
revoke all on function grimorio_private.profile_json(public.profiles),grimorio_private.respond_friend_request(uuid,text),grimorio_private.remove_friend(uuid),
  grimorio_private.invite_campaign_player(text,uuid),grimorio_private.respond_campaign_invite(uuid,text),grimorio_private.get_campaign_invitations(),
  grimorio_private.validate_folder(),grimorio_private.validate_sheet_update(),grimorio_private.save_character_sheet(uuid,text,jsonb,bigint),
  grimorio_private.admin_find_account(text),grimorio_private.admin_grant_access(text,text) from public,anon,authenticated;
grant execute on function grimorio_private.respond_friend_request(uuid,text),grimorio_private.remove_friend(uuid),
  grimorio_private.invite_campaign_player(text,uuid),grimorio_private.respond_campaign_invite(uuid,text),grimorio_private.get_campaign_invitations(),
  grimorio_private.save_character_sheet(uuid,text,jsonb,bigint),grimorio_private.admin_find_account(text),grimorio_private.admin_grant_access(text,text) to authenticated,service_role;
revoke all on function public.respond_friend_request(uuid,text),public.remove_friend(uuid),public.invite_campaign_player(text,uuid),
  public.respond_campaign_invite(uuid,text),public.get_campaign_invitations(),public.save_character_sheet(uuid,text,jsonb,bigint),
  public.admin_find_account(text),public.admin_grant_access(text,text) from public,anon,authenticated;
grant execute on function public.respond_friend_request(uuid,text),public.remove_friend(uuid),public.invite_campaign_player(text,uuid),
  public.respond_campaign_invite(uuid,text),public.get_campaign_invitations(),public.save_character_sheet(uuid,text,jsonb,bigint),
  public.admin_find_account(text),public.admin_grant_access(text,text) to authenticated,service_role;
-- Only a small version marker travels over Realtime; portraits can be several MB.
create table public.character_sheet_versions (
  sheet_id uuid primary key references public.character_sheets(id) on delete cascade,
  version bigint not null, updated_at timestamptz not null
);
alter table public.character_sheet_versions enable row level security;
revoke all on public.character_sheet_versions from public,anon,authenticated;
grant select on public.character_sheet_versions to authenticated;
grant all on public.character_sheet_versions to service_role;
create policy sheet_versions_visible on public.character_sheet_versions for select to authenticated
  using(exists(select 1 from public.character_sheets s where s.id=sheet_id));
create function grimorio_private.record_sheet_version() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.character_sheet_versions(sheet_id,version,updated_at) values(new.id,new.version,new.updated_at)
    on conflict(sheet_id) do update set version=excluded.version,updated_at=excluded.updated_at;
  return new;
end;
$$;
revoke all on function grimorio_private.record_sheet_version() from public,anon,authenticated;
create trigger character_sheets_version after insert or update on public.character_sheets for each row execute function grimorio_private.record_sheet_version();
insert into public.character_sheet_versions select id,version,updated_at from public.character_sheets;
alter publication supabase_realtime add table public.character_sheet_versions,public.campaign_sheet_assignments,public.campaign_rolls,public.friend_requests,public.friendships,public.campaign_invitations;

commit;
