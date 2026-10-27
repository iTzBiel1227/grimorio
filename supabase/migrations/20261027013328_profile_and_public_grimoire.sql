begin;

alter table public.profiles
  add column banner_data text not null default '' check (grimorio_private.valid_image(banner_data)),
  add column bio text not null default '' check (length(bio) <= 280);
grant update(banner_data, bio) on public.profiles to authenticated;

alter table public.grimoire_entries
  add column image_data text not null default '' check (grimorio_private.valid_image(image_data));
grant update(image_data) on public.grimoire_entries to authenticated;
-- Publication is chosen at creation. Editing cannot expose a private entry.
revoke update(is_standard) on public.grimoire_entries from authenticated;

grant select on public.grimoire_entries to anon;
create policy grimoire_public_read on public.grimoire_entries
  for select to anon using (is_standard);

-- Administrators curate the public library; personal creations remain private.
drop policy grimoire_read on public.grimoire_entries;
create policy grimoire_read on public.grimoire_entries for select to authenticated
  using (is_standard or owner_user_id = (select auth.uid()));
drop policy grimoire_create on public.grimoire_entries;
create policy grimoire_create on public.grimoire_entries for insert to authenticated
  with check (owner_user_id = (select auth.uid()) and (not is_standard or (select grimorio_private.is_admin())));
drop policy grimoire_edit on public.grimoire_entries;
create policy grimoire_edit on public.grimoire_entries for update to authenticated
  using ((not is_standard and owner_user_id = (select auth.uid())) or (is_standard and (select grimorio_private.is_admin())))
  with check ((not is_standard and owner_user_id = (select auth.uid())) or (is_standard and (select grimorio_private.is_admin())));
drop policy grimoire_delete on public.grimoire_entries;
create policy grimoire_delete on public.grimoire_entries for delete to authenticated
  using ((not is_standard and owner_user_id = (select auth.uid())) or (is_standard and (select grimorio_private.is_admin())));

commit;
