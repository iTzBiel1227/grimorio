-- The existing sheet accepts a 3 MB portrait, which becomes about 4 MB in
-- base64. Leave room for that image and the remaining character information.
begin;
alter table public.character_sheets drop constraint character_sheets_data_json_check;
alter table public.character_sheets add constraint character_sheets_data_json_check
  check (jsonb_typeof(data_json) = 'object' and octet_length(data_json::text) <= 6291456);
commit;
