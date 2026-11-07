-- Stick App: Datenbank-Einrichtung für Supabase
-- Einmal im Supabase-Dashboard unter "SQL Editor" ausführen. Kann gefahrlos mehrfach ausgeführt werden.
--
-- Für den Betrieb in einem BESTEHENDEN Supabase-Projekt gebaut:
--   * Alle Namen beginnen mit "stick_" bzw. "stick-" – bestehende Tabellen werden nicht angefasst.
--   * Projektweite Login-Einstellungen müssen NICHT geändert werden, es werden keine Mails verschickt.
--   * Anmeldung mit E-Mail + Passwort; Konten im Dashboard anlegen (Authentication → Users → Add user).
--   * Zugriff nur für E-Mail-Adressen auf der Gästeliste public.stick_allowed_users.

-- ---------------------------------------------------------------------------
-- 1) Gästeliste: wer die Stick App benutzen darf
-- ---------------------------------------------------------------------------
create table if not exists public.stick_allowed_users (
  email      text primary key check (email = lower(email)),
  note       text,
  created_at timestamptz not null default now()
);
-- RLS an und KEINE Regeln: Die Liste ist nur im Dashboard / SQL-Editor änderbar, nicht aus der App.
alter table public.stick_allowed_users enable row level security;

-- Ist die angemeldete Person freigeschaltet?
create or replace function public.stick_is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.stick_allowed_users
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Frühere Version (Code-Login) hatte eine öffentliche Prüffunktion – wird nicht mehr gebraucht
drop function if exists public.stick_email_allowed(text);

revoke all on function public.stick_is_allowed() from public;
grant execute on function public.stick_is_allowed() to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Tabelle für Muster
-- ---------------------------------------------------------------------------
create table if not exists public.stick_projects (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null default '',
  data        jsonb not null default '{}'::jsonb,  -- Einstellungen, Ausschnitt, Raster, Palette
  thumb       text,                                -- kleines Vorschaubild (Data-URL)
  image_path  text,                                -- Pfad des Originalfotos im Bucket "stick-images"
  deleted     boolean not null default false,      -- gelöscht (für den Abgleich mit anderen Geräten)
  updated_at  timestamptz not null default now(),  -- Zeitpunkt der Änderung (vom Gerät)
  created_at  timestamptz not null default now(),
  synced_at   timestamptz not null default now()   -- vom Server gesetzt, für den Abgleich
);

create or replace function public.stick_projects_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists stick_projects_touch on public.stick_projects;
create trigger stick_projects_touch before insert or update on public.stick_projects
  for each row execute function public.stick_projects_touch();

create index if not exists stick_projects_user_synced_idx on public.stick_projects (user_id, synced_at);

-- Zugriffsregeln: nur eigene Muster und nur für Personen auf der Gästeliste
alter table public.stick_projects enable row level security;

drop policy if exists "stick_projects_select" on public.stick_projects;
drop policy if exists "stick_projects_insert" on public.stick_projects;
drop policy if exists "stick_projects_update" on public.stick_projects;
drop policy if exists "stick_projects_delete" on public.stick_projects;

create policy "stick_projects_select" on public.stick_projects
  for select to authenticated using (auth.uid() = user_id and public.stick_is_allowed());
create policy "stick_projects_insert" on public.stick_projects
  for insert to authenticated with check (auth.uid() = user_id and public.stick_is_allowed());
create policy "stick_projects_update" on public.stick_projects
  for update to authenticated
  using (auth.uid() = user_id and public.stick_is_allowed())
  with check (auth.uid() = user_id and public.stick_is_allowed());
create policy "stick_projects_delete" on public.stick_projects
  for delete to authenticated using (auth.uid() = user_id and public.stick_is_allowed());

-- ---------------------------------------------------------------------------
-- 3) Privater Speicher für die Originalfotos (Pfad: <user_id>/<projekt_id>)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('stick-images', 'stick-images', false)
on conflict (id) do nothing;

drop policy if exists "stick_images_select" on storage.objects;
drop policy if exists "stick_images_insert" on storage.objects;
drop policy if exists "stick_images_update" on storage.objects;
drop policy if exists "stick_images_delete" on storage.objects;

create policy "stick_images_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'stick-images' and (storage.foldername(name))[1] = auth.uid()::text and public.stick_is_allowed());
create policy "stick_images_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'stick-images' and (storage.foldername(name))[1] = auth.uid()::text and public.stick_is_allowed());
create policy "stick_images_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'stick-images' and (storage.foldername(name))[1] = auth.uid()::text and public.stick_is_allowed())
  with check (bucket_id = 'stick-images' and (storage.foldername(name))[1] = auth.uid()::text and public.stick_is_allowed());
create policy "stick_images_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'stick-images' and (storage.foldername(name))[1] = auth.uid()::text and public.stick_is_allowed());

-- ---------------------------------------------------------------------------
-- 4) Personen freischalten – E-Mail-Adresse(n) anpassen und ausführen (klein schreiben!)
-- ---------------------------------------------------------------------------
-- insert into public.stick_allowed_users (email, note) values ('deine@email.de', 'ich')
--   on conflict (email) do nothing;
