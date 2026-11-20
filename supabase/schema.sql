-- =====================================================================
-- Date the Twins: Supabase schema
--
-- Run this whole file once in your Supabase project:
--   Dashboard → SQL Editor → New query → paste → Run.
-- It is safe to re-run (it updates functions/policies in place).
--
-- Security model
--   * The public (anon key) can ONLY:
--       - upload photos into the private "applicant-photos" bucket, and
--       - call submit_application(), which validates everything.
--     They can never read, list, change or delete anything.
--   * Admins = logged-in users whose email is in dtt_private.admins.
--     They can read applications, view photos (signed URLs), change
--     status/notes, and delete.
-- =====================================================================

create schema if not exists dtt_private;
revoke all on schema dtt_private from public, anon;
grant usage on schema dtt_private to authenticated;

-- ---------- Admins ----------
create table if not exists dtt_private.admins (
  email text primary key check (email = lower(email))
);
-- Add admins with (lowercase emails):
--   insert into dtt_private.admins (email) values ('friend1@example.com'), ('friend2@example.com');

create or replace function dtt_private.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from dtt_private.admins
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function dtt_private.is_admin() from public, anon;
grant execute on function dtt_private.is_admin() to authenticated;

-- Lets the admin page tell "not an admin" apart from "no applications yet".
create or replace function public.am_i_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select dtt_private.is_admin(); $$;
revoke all on function public.am_i_admin() from public, anon;
grant execute on function public.am_i_admin() to authenticated;

-- ---------- Applications ----------
create table if not exists public.applications (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  status       text not null default 'new' check (status in ('new', 'liked', 'maybe', 'passed')),
  email        text not null,
  profile      jsonb not null,
  notes        text not null default '' check (char_length(notes) <= 2000),
  submitter_ip text
);
create index if not exists applications_ip_time on public.applications (submitter_ip, created_at);

-- Tracks which uploaded photos belong to which application (prevents re-use).
create table if not exists public.application_photos (
  path           text primary key,
  application_id bigint not null references public.applications (id) on delete cascade
);

alter table public.applications enable row level security;
alter table public.application_photos enable row level security;

-- Supabase grants broad table privileges by default; narrow them.
revoke all on public.applications, public.application_photos from anon, authenticated;
grant select, delete on public.applications to authenticated;
grant update (status, notes) on public.applications to authenticated;

drop policy if exists "admins can read applications" on public.applications;
create policy "admins can read applications" on public.applications
  for select to authenticated using (dtt_private.is_admin());

drop policy if exists "admins can update applications" on public.applications;
create policy "admins can update applications" on public.applications
  for update to authenticated using (dtt_private.is_admin()) with check (dtt_private.is_admin());

drop policy if exists "admins can delete applications" on public.applications;
create policy "admins can delete applications" on public.applications
  for delete to authenticated using (dtt_private.is_admin());
-- No insert policy on purpose: inserts only happen through submit_application().

-- ---------- Photo storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('applicant-photos', 'applicant-photos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "dtt: anyone can upload applicant photos" on storage.objects;
create policy "dtt: anyone can upload applicant photos" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'applicant-photos'
    and name ~ '^uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$'
  );

drop policy if exists "dtt: admins can view applicant photos" on storage.objects;
create policy "dtt: admins can view applicant photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'applicant-photos' and dtt_private.is_admin());

drop policy if exists "dtt: admins can delete applicant photos" on storage.objects;
create policy "dtt: admins can delete applicant photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'applicant-photos' and dtt_private.is_admin());

-- ---------- Validation helpers ----------
create or replace function dtt_private.txt(v jsonb)
returns text language sql immutable
set search_path = ''
as $$ select case when jsonb_typeof(v) = 'string' then btrim(v #>> '{}') else '' end; $$;

create or replace function dtt_private.err(field text, message text)
returns jsonb language sql immutable
set search_path = ''
as $$ select jsonb_build_array(jsonb_build_object('field', field, 'message', message)); $$;

-- Returns [] or a one-element error array for a text field.
create or replace function dtt_private.check_text(v jsonb, field text, label text, maxlen int, required boolean)
returns jsonb language plpgsql immutable
set search_path = ''
as $$
declare s text := dtt_private.txt(v);
begin
  if required and s = '' then return dtt_private.err(field, label || ' is required.'); end if;
  if char_length(s) > maxlen then
    return dtt_private.err(field, label || ' must be ' || maxlen || ' characters or fewer.');
  end if;
  return '[]'::jsonb;
end $$;

-- ---------- Public entry point: submit an application ----------
create or replace function public.submit_application(profile jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  photo_re constant text :=
    '^uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$';
  e        jsonb := '[]'::jsonb;
  tw       jsonb;
  pr       jsonb;
  p        text;
  ph       text;
  age      int;
  seen     text[];
  photos   text[];
  all_ph   text[] := '{}';
  twins    jsonb := '[]'::jsonb;
  prompts  jsonb;
  pair     jsonb;
  email    text;
  phone    text;
  ip       text;
  new_id   bigint;
begin
  -- Basic rate limit: 10 applications per hour per IP.
  begin
    ip := btrim(split_part(coalesce(current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for', ''), ',', 1));
  exception when others then ip := '';
  end;
  if ip <> '' and (
    select count(*) from public.applications a
    where a.submitter_ip = ip and a.created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'Too many submissions from this device. Please try again later.'
      using errcode = 'P0001', hint = 'rate_limited';
  end if;

  if profile is null or jsonb_typeof(profile) <> 'object' then
    raise exception 'Profile data is missing or malformed.' using errcode = 'P0001', hint = 'bad_request';
  end if;

  -- Twins
  if jsonb_typeof(profile -> 'twins') <> 'array' or jsonb_array_length(profile -> 'twins') <> 2 then
    e := e || dtt_private.err('twins', 'Both twins are required.');
  else
    for i in 0..1 loop
      p  := 'twins.' || i;
      tw := profile -> 'twins' -> i;
      if jsonb_typeof(tw) <> 'object' then tw := '{}'::jsonb; end if;

      e := e || dtt_private.check_text(tw -> 'name', p || '.name', 'First name', 40, true)
             || dtt_private.check_text(tw -> 'pronouns', p || '.pronouns', 'Pronouns', 30, false)
             || dtt_private.check_text(tw -> 'occupation', p || '.occupation', 'Occupation', 80, false)
             || dtt_private.check_text(tw -> 'hometown', p || '.hometown', 'Hometown', 80, false)
             || dtt_private.check_text(tw -> 'height', p || '.height', 'Height', 20, false)
             || dtt_private.check_text(tw -> 'instagram', p || '.instagram', 'Instagram', 40, false);

      age := null;
      if jsonb_typeof(tw -> 'age') = 'number' and (tw ->> 'age') ~ '^\d{1,3}$' then
        age := (tw ->> 'age')::int;
      end if;
      if age is null or age < 18 or age > 99 then
        e := e || dtt_private.err(p || '.age', 'Age must be a whole number between 18 and 99.');
      end if;

      -- Prompts
      prompts := '[]'::jsonb;
      seen := '{}';
      if jsonb_typeof(tw -> 'prompts') <> 'array' or jsonb_array_length(tw -> 'prompts') <> 3 then
        e := e || dtt_private.err(p || '.prompts', 'Answer 3 prompts.');
      else
        for j in 0..2 loop
          pr := tw -> 'prompts' -> j;
          if jsonb_typeof(pr) <> 'object' then pr := '{}'::jsonb; end if;
          e := e || dtt_private.check_text(pr -> 'prompt', p || '.prompts.' || j || '.prompt', 'Prompt', 100, true)
                 || dtt_private.check_text(pr -> 'answer', p || '.prompts.' || j || '.answer', 'Prompt answer', 300, true);
          if dtt_private.txt(pr -> 'prompt') = any (seen) then
            e := e || dtt_private.err(p || '.prompts.' || j || '.prompt', 'Pick three different prompts.');
          end if;
          seen := seen || dtt_private.txt(pr -> 'prompt');
          prompts := prompts || jsonb_build_array(jsonb_build_object(
            'prompt', left(dtt_private.txt(pr -> 'prompt'), 100),
            'answer', left(dtt_private.txt(pr -> 'answer'), 300)));
        end loop;
      end if;

      -- Photos (must already be uploaded to the private bucket)
      photos := '{}';
      if jsonb_typeof(tw -> 'photos') <> 'array'
         or jsonb_array_length(tw -> 'photos') < 2 or jsonb_array_length(tw -> 'photos') > 6 then
        e := e || dtt_private.err(p || '.photos', 'Add between 2 and 6 photos.');
      else
        for ph in select jsonb_array_elements_text(tw -> 'photos') loop
          if ph !~ photo_re
             or ph = any (all_ph)
             or not exists (select 1 from storage.objects o where o.bucket_id = 'applicant-photos' and o.name = ph)
             or exists (select 1 from public.application_photos ap where ap.path = ph) then
            e := e || dtt_private.err(p || '.photos', 'One of the photos didn''t upload correctly. Please try submitting again.');
            exit;
          end if;
          photos := photos || ph;
          all_ph := all_ph || ph;
        end loop;
      end if;

      twins := twins || jsonb_build_array(jsonb_build_object(
        'name',       left(dtt_private.txt(tw -> 'name'), 40),
        'age',        age,
        'pronouns',   left(dtt_private.txt(tw -> 'pronouns'), 30),
        'occupation', left(dtt_private.txt(tw -> 'occupation'), 80),
        'hometown',   left(dtt_private.txt(tw -> 'hometown'), 80),
        'height',     left(dtt_private.txt(tw -> 'height'), 20),
        'instagram',  left(ltrim(dtt_private.txt(tw -> 'instagram'), '@'), 40),
        'prompts',    prompts,
        'photos',     to_jsonb(photos)));
    end loop;
  end if;

  -- Pair
  pair := coalesce(profile -> 'pair', '{}'::jsonb);
  if jsonb_typeof(pair) <> 'object' then pair := '{}'::jsonb; end if;
  if dtt_private.txt(pair -> 'twinType') not in ('Identical', 'Fraternal', 'Not sure / prefer not to say') then
    e := e || dtt_private.err('pair.twinType', 'Choose a twin type.');
  end if;
  e := e || dtt_private.check_text(pair -> 'city', 'pair.city', 'City', 60, true)
         || dtt_private.check_text(pair -> 'prompt' -> 'prompt', 'pair.prompt.prompt', 'Prompt', 100, true)
         || dtt_private.check_text(pair -> 'prompt' -> 'answer', 'pair.prompt.answer', 'Prompt answer', 300, true)
         || dtt_private.check_text(pair -> 'why', 'pair.why', 'Why you want to date the twins', 300, true);

  -- Contact
  email := lower(dtt_private.txt(profile -> 'contact' -> 'email'));
  if email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(email) > 120 then
    e := e || dtt_private.err('contact.email', 'Enter a valid email address.');
  end if;
  phone := dtt_private.txt(profile -> 'contact' -> 'phone');
  if phone <> '' and phone !~ '^[0-9+().\s-]{7,30}$' then
    e := e || dtt_private.err('contact.phone', 'Enter a valid phone number.');
  end if;

  -- Consent
  if (profile -> 'consent' -> 'adults') is distinct from 'true'::jsonb then
    e := e || dtt_private.err('consent.adults', 'Both of you must confirm you are 18 or older.');
  end if;
  if (profile -> 'consent' -> 'agree') is distinct from 'true'::jsonb then
    e := e || dtt_private.err('consent.agree', 'Both of you must agree to share this profile.');
  end if;

  if jsonb_array_length(e) > 0 then
    raise exception 'Please fix the highlighted fields.'
      using errcode = 'P0001', hint = 'validation', detail = e::text;
  end if;

  insert into public.applications (email, submitter_ip, profile)
  values (email, nullif(ip, ''), jsonb_build_object(
    'twins', twins,
    'pair', jsonb_build_object(
      'twinType', dtt_private.txt(pair -> 'twinType'),
      'city',     left(dtt_private.txt(pair -> 'city'), 60),
      'prompt',   jsonb_build_object(
                    'prompt', left(dtt_private.txt(pair -> 'prompt' -> 'prompt'), 100),
                    'answer', left(dtt_private.txt(pair -> 'prompt' -> 'answer'), 300)),
      'why',      left(dtt_private.txt(pair -> 'why'), 300)),
    'contact', jsonb_build_object('email', email, 'phone', phone),
    'consent', jsonb_build_object('adults', true, 'agree', true)))
  returning id into new_id;

  insert into public.application_photos (path, application_id)
  select unnest(all_ph), new_id;

  return new_id;
end;
$$;

revoke all on function public.submit_application(jsonb) from public;
grant execute on function public.submit_application(jsonb) to anon, authenticated;
