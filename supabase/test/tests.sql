-- Security + validation tests for schema.sql. Any failure raises an exception.
\set ON_ERROR_STOP on
set client_min_messages = warning;

insert into dtt_private.admins (email) values ('admin@example.com');

-- Helper (test-only) to build a valid profile with given photo paths.
create function pg_temp.profile(ph0 text[], ph1 text[]) returns jsonb language sql as $$
  select jsonb_build_object(
    'twins', jsonb_build_array(
      jsonb_build_object('name', ' Ana ', 'age', 25, 'instagram', '@ana', 'extra', 'dropped',
        'prompts', jsonb_build_array(
          jsonb_build_object('prompt', 'The way to win me over is', 'answer', 'Tacos'),
          jsonb_build_object('prompt', 'Typical Sunday', 'answer', 'Brunch'),
          jsonb_build_object('prompt', 'I geek out on', 'answer', 'Maps')),
        'photos', to_jsonb(ph0)),
      jsonb_build_object('name', 'Bea', 'age', 25,
        'prompts', jsonb_build_array(
          jsonb_build_object('prompt', 'The way to win me over is', 'answer', 'Tacos'),
          jsonb_build_object('prompt', 'Typical Sunday', 'answer', 'Brunch'),
          jsonb_build_object('prompt', 'I geek out on', 'answer', 'Maps')),
        'photos', to_jsonb(ph1))),
    'pair', jsonb_build_object('twinType', 'Identical', 'city', 'Toronto',
      'prompt', jsonb_build_object('prompt', 'Our ideal double date', 'answer', 'Bowling'),
      'why', 'Because'),
    'contact', jsonb_build_object('email', 'Twins@Example.com', 'phone', ''),
    'consent', jsonb_build_object('adults', true, 'agree', true))
$$;
grant execute on function pg_temp.profile(text[], text[]) to anon, authenticated;

\echo '--- anon can upload valid photo paths, but not arbitrary ones'
set role anon;
insert into storage.objects (bucket_id, name) values
  ('applicant-photos', 'uploads/00000000-0000-4000-8000-000000000001.jpg'),
  ('applicant-photos', 'uploads/00000000-0000-4000-8000-000000000002.jpg'),
  ('applicant-photos', 'uploads/00000000-0000-4000-8000-000000000003.png'),
  ('applicant-photos', 'uploads/00000000-0000-4000-8000-000000000004.webp');
do $$ begin
  insert into storage.objects (bucket_id, name) values ('applicant-photos', 'evil/index.html');
  raise exception 'FAIL: anon uploaded to a bad path';
exception when insufficient_privilege then null; end $$;

\echo '--- anon cannot read photos or applications'
do $$ begin
  if (select count(*) from storage.objects) <> 0 then raise exception 'FAIL: anon can list photos'; end if;
end $$;
do $$ begin
  perform 1 from public.applications;
  raise exception 'FAIL: anon can select applications';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.applications (email, profile) values ('x@y.z', '{}');
  raise exception 'FAIL: anon inserted directly';
exception when insufficient_privilege then null; end $$;

\echo '--- valid submission succeeds and is cleaned'
set request.headers = '{"x-forwarded-for": "1.2.3.4, 10.0.0.1"}';
select public.submit_application(pg_temp.profile(
  array['uploads/00000000-0000-4000-8000-000000000001.jpg', 'uploads/00000000-0000-4000-8000-000000000002.jpg'],
  array['uploads/00000000-0000-4000-8000-000000000003.png', 'uploads/00000000-0000-4000-8000-000000000004.webp']
)) as new_id \gset
\echo 'created application' :new_id

\echo '--- re-using photos from another application is rejected'
do $$ begin
  perform public.submit_application(pg_temp.profile(
    array['uploads/00000000-0000-4000-8000-000000000001.jpg', 'uploads/00000000-0000-4000-8000-000000000002.jpg'],
    array['uploads/00000000-0000-4000-8000-000000000003.png', 'uploads/00000000-0000-4000-8000-000000000004.webp']));
  raise exception 'FAIL: photo reuse allowed';
exception when raise_exception then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;

\echo '--- invalid submission returns field errors'
do $$
declare d text; h text; p jsonb;
begin
  p := pg_temp.profile(array['uploads/nope.jpg'], array[]::text[]);
  p := jsonb_set(p, '{twins,1,age}', '17');
  p := jsonb_set(p, '{twins,0,prompts,1,prompt}', '"The way to win me over is"');
  p := jsonb_set(p, '{consent,adults}', 'false');
  p := jsonb_set(p, '{contact,email}', '"not-an-email"');
  p := jsonb_set(p, '{pair,twinType}', '"Triplets"');
  begin
    perform public.submit_application(p);
    raise exception 'FAIL: invalid profile accepted';
  exception when raise_exception then
    get stacked diagnostics d = pg_exception_detail, h = pg_exception_hint;
    if h <> 'validation' then raise exception 'FAIL: wrong hint %, msg %', h, sqlerrm; end if;
  end;
  if not (d::jsonb @> '[{"field":"twins.1.age"}]' and d::jsonb @> '[{"field":"twins.0.photos"}]'
          and d::jsonb @> '[{"field":"twins.1.photos"}]' and d::jsonb @> '[{"field":"consent.adults"}]'
          and d::jsonb @> '[{"field":"contact.email"}]' and d::jsonb @> '[{"field":"pair.twinType"}]'
          and d::jsonb @> '[{"field":"twins.0.prompts.1.prompt"}]') then
    raise exception 'FAIL: missing expected errors: %', d;
  end if;
end $$;

\echo '--- rate limit kicks in after 10/hour from one IP'
reset role;
insert into public.applications (email, profile, submitter_ip)
select 'x@y.z', '{}', '9.9.9.9' from generate_series(1, 10);
set role anon;
set request.headers = '{"x-forwarded-for": "9.9.9.9"}';
do $$
declare h text;
begin
  perform public.submit_application('{}');
  raise exception 'FAIL: rate limit not enforced';
exception when raise_exception then
  get stacked diagnostics h = pg_exception_hint;
  if h <> 'rate_limited' then raise exception 'FAIL: expected rate_limited, got % (%)', h, sqlerrm; end if;
end $$;
reset role;
delete from public.applications where submitter_ip = '9.9.9.9';

\echo '--- logged-in non-admin sees nothing'
set role authenticated;
set request.jwt.claims = '{"email": "stranger@example.com", "role": "authenticated"}';
do $$ begin
  if public.am_i_admin() then raise exception 'FAIL: stranger is admin'; end if;
  if (select count(*) from public.applications) <> 0 then raise exception 'FAIL: stranger can read applications'; end if;
  if (select count(*) from storage.objects) <> 0 then raise exception 'FAIL: stranger can read photos'; end if;
  update public.applications set status = 'liked';
  if found then raise exception 'FAIL: stranger updated'; end if;
end $$;

\echo '--- admin can read, update status/notes, but not rewrite the profile'
set request.jwt.claims = '{"email": "Admin@Example.com", "role": "authenticated"}';
do $$
declare a record;
begin
  if not public.am_i_admin() then raise exception 'FAIL: admin not recognised'; end if;
  select * into a from public.applications;
  if a.email <> 'twins@example.com' then raise exception 'FAIL: email not normalised: %', a.email; end if;
  if a.profile #>> '{twins,0,name}' <> 'Ana' then raise exception 'FAIL: name not trimmed'; end if;
  if a.profile #>> '{twins,0,instagram}' <> 'ana' then raise exception 'FAIL: @ not stripped'; end if;
  if a.profile -> 'twins' -> 0 ? 'extra' then raise exception 'FAIL: unknown field kept'; end if;
  if a.submitter_ip <> '1.2.3.4' then raise exception 'FAIL: ip %', a.submitter_ip; end if;
  if (select count(*) from storage.objects) <> 4 then raise exception 'FAIL: admin cannot see photos'; end if;
  update public.applications set status = 'liked', notes = 'cute' where id = a.id;
  if not found then raise exception 'FAIL: admin update'; end if;
end $$;
do $$ begin
  update public.applications set profile = '{}';
  raise exception 'FAIL: admin rewrote profile';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.applications set status = 'bogus';
  raise exception 'FAIL: bad status accepted';
exception when check_violation then null; end $$;

\echo '--- admin can delete photos and the application'
delete from storage.objects where bucket_id = 'applicant-photos';
delete from public.applications;
reset role;
do $$ begin
  if (select count(*) from public.applications) <> 0 then raise exception 'FAIL: delete'; end if;
  if (select count(*) from public.application_photos) <> 0 then raise exception 'FAIL: photo rows not cascaded'; end if;
end $$;

\echo 'ALL DATABASE TESTS PASSED'
