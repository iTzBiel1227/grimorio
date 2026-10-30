-- Phase 2. Data tables are RPC-only; only tiny version signals are published.
begin;
create table public.campaign_npcs (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 100), description text not null default '' check(length(description)<=4000),
 is_public boolean not null default false, linked_sheet_id uuid references public.character_sheets(id) on delete set null,
 version integer not null default 1 check(version>0)
);
create index campaign_npcs_campaign on public.campaign_npcs(campaign_id);
create index campaign_npcs_sheet on public.campaign_npcs(linked_sheet_id);
create table public.campaign_npc_secrets (
 npc_id uuid primary key references public.campaign_npcs(id) on delete cascade, secret text not null default '' check(length(secret)<=10000)
);
create table public.campaign_relations (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns(id) on delete cascade,
 from_npc_id uuid not null references public.campaign_npcs(id) on delete cascade,
 to_npc_id uuid references public.campaign_npcs(id) on delete cascade,
 to_sheet_id uuid references public.character_sheets(id) on delete cascade,
 label text not null check(length(btrim(label)) between 1 and 120), description text not null default '' check(length(description)<=2000),
 is_public boolean not null default false, version integer not null default 1 check(version>0),
 check((to_npc_id is null) <> (to_sheet_id is null)), check(from_npc_id <> to_npc_id)
);
create index campaign_relations_campaign on public.campaign_relations(campaign_id);
create index campaign_relations_from on public.campaign_relations(from_npc_id);
create index campaign_relations_to on public.campaign_relations(to_npc_id);
create index campaign_relations_sheet on public.campaign_relations(to_sheet_id);
create table public.campaign_maps (
 campaign_id uuid primary key references public.campaigns(id) on delete cascade,
 title text not null default 'Mapa da campanha' check(length(btrim(title)) between 1 and 120),
 image_data text not null default '' check(grimorio_private.valid_image(image_data)),
 version integer not null default 1 check(version>0)
);
create table public.campaign_markers (
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 100), description text not null default '' check(length(description)<=2000),
 x double precision not null check(x between 0 and 100), y double precision not null check(y between 0 and 100),
 npc_id uuid references public.campaign_npcs(id) on delete cascade,
 is_public boolean not null default false, version integer not null default 1 check(version>0)
);
create index campaign_markers_campaign on public.campaign_markers(campaign_id);
create index campaign_markers_npc on public.campaign_markers(npc_id);
create table public.campaign_marker_secrets (
 marker_id uuid primary key references public.campaign_markers(id) on delete cascade, secret text not null default '' check(length(secret)<=10000)
);
create table public.campaign_world_versions (
 campaign_id uuid primary key references public.campaigns(id) on delete cascade, version bigint not null default 1 check(version>0)
);

-- Defense in depth: no browser SELECT/INSERT/UPDATE/DELETE on data or secret
-- tables. Explicit authorized RPCs return projected data without hidden fields.
do $$ declare v_table text; begin
 foreach v_table in array array['campaign_npcs','campaign_npc_secrets','campaign_relations','campaign_maps','campaign_markers','campaign_marker_secrets','campaign_world_versions'] loop
   execute format('alter table public.%I enable row level security',v_table);
   execute format('revoke all on public.%I from public,anon,authenticated',v_table);
   execute format('grant all on public.%I to service_role',v_table);
 end loop;
end $$;
create policy campaign_npcs_owner on public.campaign_npcs for select to authenticated using(grimorio_private.is_campaign_owner(campaign_id));
create policy campaign_relations_owner on public.campaign_relations for select to authenticated using(grimorio_private.is_campaign_owner(campaign_id));
create policy campaign_maps_owner on public.campaign_maps for select to authenticated using(grimorio_private.is_campaign_owner(campaign_id));
create policy campaign_markers_owner on public.campaign_markers for select to authenticated using(grimorio_private.is_campaign_owner(campaign_id));
create policy campaign_npc_secrets_owner on public.campaign_npc_secrets for select to authenticated using(exists(select 1 from public.campaign_npcs n where n.id=npc_id and grimorio_private.is_campaign_owner(n.campaign_id)));
create policy campaign_marker_secrets_owner on public.campaign_marker_secrets for select to authenticated using(exists(select 1 from public.campaign_markers m where m.id=marker_id and grimorio_private.is_campaign_owner(m.campaign_id)));
grant select on public.campaign_world_versions to authenticated;
create policy campaign_world_versions_member on public.campaign_world_versions for select to authenticated using(grimorio_private.is_campaign_member(campaign_id) or grimorio_private.is_campaign_owner(campaign_id));

create function grimorio_private.world_sheet_visible(p_campaign uuid,p_sheet uuid,p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select p_user=auth.uid() and exists(
  select 1 from public.character_sheets s join public.campaigns c on c.id=p_campaign
  where s.id=p_sheet
   and exists(select 1 from public.campaign_members m where m.campaign_id=c.id and m.user_id=s.user_id)
   and (c.owner_user_id=p_user or exists(select 1 from public.campaign_members m where m.campaign_id=c.id and m.user_id=p_user))
   and (s.user_id=p_user or c.owner_user_id=p_user or exists(select 1 from public.campaign_sheet_assignments a where a.campaign_id=c.id and a.sheet_id=s.id and a.assigned_user_id=p_user))
 );
$$;

create function grimorio_private.get_campaign_world(p_code text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); c public.campaigns; owner boolean; v_npcs jsonb; v_relations jsonb; v_markers jsonb; v_map jsonb;
begin
 if v_user is null then raise exception 'Faça login.' using errcode='42501'; end if;
 select * into c from public.campaigns where code=upper(btrim(p_code));
 if not found or not(c.owner_user_id=v_user or exists(select 1 from public.campaign_members where campaign_id=c.id and user_id=v_user)) then raise exception 'Entre nesta campanha.' using errcode='42501'; end if;
 owner:=c.owner_user_id=v_user;
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'name',n.name,'description',n.description,'isPublic',n.is_public,'version',n.version,
 'linkedSheetId',case when grimorio_private.world_sheet_visible(c.id,n.linked_sheet_id,v_user) then n.linked_sheet_id else null end)
 ||case when owner then jsonb_build_object('secret',coalesce(s.secret,'')) else '{}'::jsonb end order by n.name,n.id),'[]') into v_npcs
 from public.campaign_npcs n left join public.campaign_npc_secrets s on s.npc_id=n.id and owner where n.campaign_id=c.id and(owner or n.is_public);
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'fromNpcId',r.from_npc_id,'toNpcId',r.to_npc_id,'toSheetId',r.to_sheet_id,
 'label',r.label,'description',r.description,'isPublic',r.is_public,'version',r.version)
 ||case when r.to_sheet_id is not null then jsonb_build_object('toSheetName',s.name) else '{}'::jsonb end order by r.label,r.id),'[]') into v_relations
 from public.campaign_relations r join public.campaign_npcs f on f.id=r.from_npc_id
 left join public.campaign_npcs t on t.id=r.to_npc_id left join public.character_sheets s on s.id=r.to_sheet_id
 where r.campaign_id=c.id and(owner or r.is_public) and(owner or f.is_public)
 and(case when r.to_npc_id is not null then owner or t.is_public else grimorio_private.world_sheet_visible(c.id,r.to_sheet_id,v_user) end);
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'description',m.description,'x',m.x,'y',m.y,'npcId',m.npc_id,'isPublic',m.is_public,'version',m.version)
 ||case when owner then jsonb_build_object('secret',coalesce(s.secret,'')) else '{}'::jsonb end order by m.name,m.id),'[]') into v_markers
 from public.campaign_markers m left join public.campaign_npcs n on n.id=m.npc_id
 left join public.campaign_marker_secrets s on s.marker_id=m.id and owner
 where m.campaign_id=c.id and(owner or m.is_public) and(m.npc_id is null or owner or n.is_public);
 select jsonb_build_object('title',title,'imageData',image_data,'version',version) into v_map from public.campaign_maps where campaign_id=c.id;
 return jsonb_build_object('canManage',owner,'npcs',v_npcs,'relations',v_relations,'markers',v_markers,'map',coalesce(v_map,'{"title":"Mapa da campanha","imageData":"","version":0}'::jsonb));
end;
$$;

create function grimorio_private.mutate_campaign_world(p_code text,p_kind text,p_action text,p_id uuid default null,p_data jsonb default '{}',p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=auth.uid(); c public.campaigns; v_table text; v_key text; v_fields jsonb; v_defaults jsonb; v_old jsonb; v_record jsonb;
 v_field text; v_column text; v_value jsonb; v_secret text; v_id uuid; v_version integer; v_limit integer; v_count integer; v_cols text; v_ref uuid;
begin
 if v_user is null then raise exception 'Faça login.' using errcode='42501'; end if;
 select * into c from public.campaigns where code=upper(btrim(p_code)) for update;
 if not found or c.owner_user_id<>v_user then raise exception 'Somente o mestre pode gerenciar este mundo.' using errcode='42501'; end if;
 if p_kind is null or p_kind not in('npc','relation','marker','map') or p_action is null or p_action not in('save','delete') or(p_kind='map' and p_action<>'save') then raise exception 'Ação inválida.' using errcode='22023'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Informe os dados.' using errcode='22023'; end if;
 case p_kind
 when 'npc' then
  v_table:='campaign_npcs'; v_limit:=200;
  v_fields:='{"name":"name","description":"description","isPublic":"is_public","linkedSheetId":"linked_sheet_id"}';
  v_defaults:='{"name":"","description":"","is_public":false,"linked_sheet_id":null}';
 when 'relation' then
  v_table:='campaign_relations'; v_limit:=500;
  v_fields:='{"fromNpcId":"from_npc_id","toNpcId":"to_npc_id","toSheetId":"to_sheet_id","label":"label","description":"description","isPublic":"is_public"}';
  v_defaults:='{"from_npc_id":null,"to_npc_id":null,"to_sheet_id":null,"label":"","description":"","is_public":false}';
 when 'marker' then
  v_table:='campaign_markers'; v_limit:=300;
  v_fields:='{"name":"name","description":"description","x":"x","y":"y","npcId":"npc_id","isPublic":"is_public"}';
  v_defaults:='{"name":"","description":"","x":50,"y":50,"npc_id":null,"is_public":false}';
 when 'map' then
  v_table:='campaign_maps';
  v_fields:='{"title":"title","imageData":"image_data"}';v_defaults:='{"title":"Mapa da campanha","image_data":""}';
 end case;
 v_key:=case when p_kind='map' then 'campaign_id' else 'id' end;
 v_id:=case when p_kind='map' then c.id else p_id end;
 if p_kind='map' and p_id is not null and p_id<>c.id then raise exception 'Mapa não encontrado.' using errcode='42501'; end if;
 if v_id is not null then execute format('select to_jsonb(t) from public.%I t where %I=$1 and campaign_id=$2',v_table,v_key) into v_old using v_id,c.id; end if;
 if p_kind<>'map' and p_id is not null and v_old is null then raise exception 'Registro não encontrado.' using errcode='42501'; end if;
 if (v_old is not null or p_kind='map') and p_expected_version is distinct from coalesce((v_old->>'version')::integer,0) then raise exception 'Este registro mudou. Recarregue os dados.' using errcode='40001'; end if;
 if p_action='delete' then
  if v_old is null then raise exception 'Registro não encontrado.' using errcode='22023'; end if;
  execute format('delete from public.%I where id=$1 and campaign_id=$2',v_table) using p_id,c.id;
 else
  v_id:=coalesce(v_id,gen_random_uuid());v_version:=coalesce((v_old->>'version')::integer,0)+1;
  v_record:=v_defaults||coalesce(v_old,'{}')||jsonb_build_object(v_key,v_id,'campaign_id',c.id,'version',v_version);
  for v_field,v_value in select key,value from jsonb_each(p_data) loop
   if v_field='secret' and p_kind in('npc','marker') then
    if jsonb_typeof(v_value)<>'string' or length(v_value#>>'{}')>10000 then raise exception 'Segredo inválido.' using errcode='22023'; end if;
    v_secret:=btrim(v_value#>>'{}');continue;
   end if;
   if not(v_fields?v_field) then raise exception 'Campo não permitido: %',v_field using errcode='22023'; end if;
   v_column:=v_fields->>v_field;
   if v_field='isPublic' then
    if jsonb_typeof(v_value)<>'boolean' then raise exception 'Visibilidade inválida.' using errcode='22023'; end if;
   elsif v_field in('x','y') then
    if jsonb_typeof(v_value)<>'number' or (v_value#>>'{}')::numeric not between 0 and 100 then raise exception 'Coordenadas inválidas.' using errcode='22023'; end if;
   elsif v_field in('linkedSheetId','fromNpcId','toNpcId','toSheetId','npcId') then
    if v_value<>'null'::jsonb and (jsonb_typeof(v_value)<>'string' or (v_value#>>'{}')!~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') then raise exception 'Referência inválida.' using errcode='22023'; end if;
   else
    if jsonb_typeof(v_value)<>'string' then raise exception 'Texto inválido.' using errcode='22023'; end if;
    if v_field<>'imageData' then v_value:=to_jsonb(btrim(v_value#>>'{}')); end if;
   end if;
   v_record:=v_record||jsonb_build_object(v_column,v_value);
  end loop;
  for v_column in select unnest(array['from_npc_id','to_npc_id','npc_id']) loop
   v_ref:=(v_record->>v_column)::uuid;
   if v_ref is not null and not exists(select 1 from public.campaign_npcs where id=v_ref and campaign_id=c.id) then raise exception 'Escolha um NPC desta campanha.' using errcode='22023'; end if;
  end loop;
  for v_column in select unnest(array['linked_sheet_id','to_sheet_id']) loop
   v_ref:=(v_record->>v_column)::uuid;
   if v_ref is not null and not grimorio_private.world_sheet_visible(c.id,v_ref,v_user) then raise exception 'Escolha uma ficha disponível nesta campanha.' using errcode='22023'; end if;
  end loop;
  if v_old is null and v_limit is not null then
   execute format('select count(*) from public.%I where campaign_id=$1',v_table) into v_count using c.id;
   if v_count>=v_limit then raise exception 'Limite de registros da campanha atingido.' using errcode='22023'; end if;
  end if;
  if v_old is null then
   execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I,$1)',v_table,v_table) using v_record;
  else
   select string_agg(format('%I',value),',') into v_cols from jsonb_each_text(v_fields);
   v_cols:=v_cols||',version';
   execute format('update public.%I set (%s)=(select %s from jsonb_populate_record(null::public.%I,$1)) where %I=$2 and campaign_id=$3',v_table,v_cols,v_cols,v_table,v_key) using v_record,v_id,c.id;
  end if;
  if p_kind in('npc','marker') and (v_secret is not null or v_old is null) then
   execute format('insert into public.campaign_%s_secrets(%s_id,secret) values($1,$2) on conflict(%s_id) do update set secret=excluded.secret',p_kind,p_kind,p_kind) using v_id,coalesce(v_secret,'');
  end if;
 end if;
 insert into public.campaign_world_versions(campaign_id) values(c.id) on conflict(campaign_id) do update set version=public.campaign_world_versions.version+1;
 return jsonb_build_object('id',v_id)||case when v_version is not null then jsonb_build_object('version',v_version) else '{}'::jsonb end;
end;
$$;
create function public.get_campaign_world(p_code text) returns jsonb language sql stable security invoker set search_path='' as $$select grimorio_private.get_campaign_world(p_code);$$;
create function public.mutate_campaign_world(p_code text,p_kind text,p_action text,p_id uuid default null,p_data jsonb default '{}',p_expected_version integer default null)
returns jsonb language sql security invoker set search_path='' as $$select grimorio_private.mutate_campaign_world(p_code,p_kind,p_action,p_id,p_data,p_expected_version);$$;
revoke all on function grimorio_private.world_sheet_visible(uuid,uuid,uuid),grimorio_private.get_campaign_world(text),grimorio_private.mutate_campaign_world(text,text,text,uuid,jsonb,integer),public.get_campaign_world(text),public.mutate_campaign_world(text,text,text,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function grimorio_private.get_campaign_world(text),grimorio_private.mutate_campaign_world(text,text,text,uuid,jsonb,integer),public.get_campaign_world(text),public.mutate_campaign_world(text,text,text,uuid,jsonb,integer) to authenticated,service_role;
alter publication supabase_realtime add table public.campaign_world_versions;
commit;
