-- Tupai KLSSF 2026 booth registration: database schema.
-- Written for Supabase (Postgres + PostgREST). Run once in the SQL editor.
-- Safe to re-run: it does not drop tables or delete rows.
--
-- The browser only ever calls three functions with the public (anon) key:
--   get_status()      counts and open/closed state, no personal data
--   claim_account()   validates and inserts one claim, enforcing cap + duplicates
--   admin_list()      returns both lists if the passcode is right
-- The tables themselves have Row Level Security on and NO policies, so the
-- anon key cannot read or write them directly.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tables

create table if not exists public.kssm_registrations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  phone       text not null,
  email_norm  text not null unique,
  phone_norm  text not null unique,
  consent     boolean not null,
  created_at  timestamptz not null default now(),
  seq         bigint generated always as identity   -- tie-breaker for ordering
);

create table if not exists public.igcse_registrations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  phone       text not null,
  email_norm  text not null unique,
  phone_norm  text not null unique,
  consent     boolean not null,
  created_at  timestamptz not null default now(),
  seq         bigint generated always as identity   -- tie-breaker for ordering
);

-- Exactly one row. Change caps and the window here (see test-mode.sql / go-live.sql).
create table if not exists public.event_config (
  id         boolean primary key default true check (id),
  kssm_cap   integer not null default 100 check (kssm_cap >= 0),
  igcse_cap  integer not null default 100 check (igcse_cap >= 0),
  opens_at   timestamptz not null,
  closes_at  timestamptz not null
);

insert into public.event_config (id, opens_at, closes_at)
values (true,
        timestamptz '2026-10-02 08:00:00+08',   -- Fri 2 Oct, 8am MYT
        timestamptz '2026-10-05 00:00:00+08')   -- midnight at the end of Sun 4 Oct, MYT
on conflict (id) do nothing;

-- One row holding the bcrypt hash of the staff passcode. Set it with set_admin_passcode().
create table if not exists public.admin_config (
  id             boolean primary key default true check (id),
  passcode_hash  text not null
);

-- Failed passcode tries, for the 5-tries-then-5-minutes lockout.
create table if not exists public.admin_attempts (
  id            bigint generated always as identity primary key,
  ip            text not null,
  attempted_at  timestamptz not null default now()
);
create index if not exists admin_attempts_ip_time on public.admin_attempts (ip, attempted_at desc);

-- ------------------------------------------------- lock the tables down

alter table public.kssm_registrations  enable row level security;
alter table public.igcse_registrations enable row level security;
alter table public.event_config        enable row level security;
alter table public.admin_config        enable row level security;
alter table public.admin_attempts      enable row level security;

revoke all on public.kssm_registrations, public.igcse_registrations,
              public.event_config, public.admin_config, public.admin_attempts
  from anon, authenticated;

-- ------------------------------------------------------------ functions

-- Counts and state only. Never returns registrant data.
create or replace function public.get_status()
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cfg     public.event_config%rowtype;
  k_used  integer;
  i_used  integer;
begin
  select * into cfg from public.event_config where id;
  select count(*) into k_used from public.kssm_registrations;
  select count(*) into i_used from public.igcse_registrations;
  return json_build_object(
    'kssm_cap',   cfg.kssm_cap,
    'igcse_cap',  cfg.igcse_cap,
    'kssm_left',  greatest(cfg.kssm_cap - k_used, 0),
    'igcse_left', greatest(cfg.igcse_cap - i_used, 0),
    'state',      case when now() <  cfg.opens_at  then 'before'
                       when now() >= cfg.closes_at then 'closed'
                       else 'open' end
  );
end;
$$;

-- One claim. Returns: ok | duplicate | full | not_open | closed | invalid
-- p_phone arrives as "+<country code> <national number>", e.g. "+60 12-345 6789".
create or replace function public.claim_account(
  p_name     text,
  p_email    text,
  p_phone    text,
  p_syllabus text,
  p_consent  boolean
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cfg       public.event_config%rowtype;
  v_name    text := btrim(coalesce(p_name, ''));
  v_email   text := btrim(coalesce(p_email, ''));
  v_phone   text := btrim(coalesce(p_phone, ''));
  v_cc      text;
  v_nn      text;
  v_email_n text;
  v_phone_n text;
  v_used    integer;
begin
  -- One claim at a time, so two people at 99 cannot both get the 100th.
  perform pg_advisory_xact_lock(hashtext('tupai_klssf_claim'));

  select * into cfg from public.event_config where id;
  if now() < cfg.opens_at then return 'not_open'; end if;
  if now() >= cfg.closes_at then return 'closed'; end if;

  if char_length(v_name) < 2 or char_length(v_name) > 100 then return 'invalid'; end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'invalid'; end if;
  if p_syllabus is null or p_syllabus not in ('KSSM', 'IGCSE') then return 'invalid'; end if;
  if p_consent is not true then return 'invalid'; end if;

  if position(' ' in v_phone) = 0 then return 'invalid'; end if;
  v_cc := regexp_replace(split_part(v_phone, ' ', 1), '\D', '', 'g');
  v_nn := regexp_replace(substr(v_phone, position(' ' in v_phone) + 1), '\D', '', 'g');
  v_nn := regexp_replace(v_nn, '^0+', '');
  if v_cc !~ '^[1-9][0-9]{0,3}$' then return 'invalid'; end if;
  if v_cc = '60' then
    -- Malaysian mobile: 9 or 10 digits, starting with 1.
    if v_nn !~ '^1[0-9]{8,9}$' then return 'invalid'; end if;
  else
    if v_nn !~ '^[0-9]{6,12}$' or char_length(v_cc || v_nn) > 15 then return 'invalid'; end if;
  end if;

  v_email_n := lower(v_email);
  v_phone_n := '+' || v_cc || v_nn;

  if exists (select 1 from public.kssm_registrations
              where email_norm = v_email_n or phone_norm = v_phone_n)
     or exists (select 1 from public.igcse_registrations
              where email_norm = v_email_n or phone_norm = v_phone_n) then
    return 'duplicate';
  end if;

  if p_syllabus = 'KSSM' then
    select count(*) into v_used from public.kssm_registrations;
    if v_used >= cfg.kssm_cap then return 'full'; end if;
    insert into public.kssm_registrations (name, email, phone, email_norm, phone_norm, consent)
    values (v_name, v_email, v_phone, v_email_n, v_phone_n, true);
  else
    select count(*) into v_used from public.igcse_registrations;
    if v_used >= cfg.igcse_cap then return 'full'; end if;
    insert into public.igcse_registrations (name, email, phone, email_norm, phone_norm, consent)
    values (v_name, v_email, v_phone, v_email_n, v_phone_n, true);
  end if;

  return 'ok';
end;
$$;

-- Staff list. Returns one of:
--   {"ok": true, "kssm_cap", "igcse_cap", "kssm": [...], "igcse": [...]}
--   {"ok": false, "reason": "wrong",  "tries_left": n}
--   {"ok": false, "reason": "locked", "retry_seconds": n}
-- Five wrong tries from one IP locks that IP out for five minutes.
create or replace function public.admin_list(p_passcode text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cfg      public.event_config%rowtype;
  v_hash   text;
  v_ip     text;
  v_fifth  timestamptz;
  v_fails  integer;
begin
  begin
    v_ip := btrim(split_part(
      coalesce(current_setting('request.headers', true), '{}')::json ->> 'x-forwarded-for', ',', 1));
  exception when others then
    v_ip := null;
  end;
  if v_ip is null or v_ip = '' then v_ip := 'unknown'; end if;

  -- Serialise tries per IP so parallel guesses cannot slip past the limit.
  perform pg_advisory_xact_lock(hashtext('tupai_klssf_admin:' || v_ip));

  -- Locked if the 5th most recent failure is less than 5 minutes old.
  select attempted_at into v_fifth
    from public.admin_attempts
   where ip = v_ip
   order by attempted_at desc
  offset 4 limit 1;
  if v_fifth is not null and v_fifth > now() - interval '5 minutes' then
    return json_build_object('ok', false, 'reason', 'locked',
      'retry_seconds', ceil(extract(epoch from (v_fifth + interval '5 minutes' - now())))::int);
  end if;

  select passcode_hash into v_hash from public.admin_config where id;

  if v_hash is null or p_passcode is null or crypt(p_passcode, v_hash) <> v_hash then
    insert into public.admin_attempts (ip) values (v_ip);
    select count(*) into v_fails
      from public.admin_attempts
     where ip = v_ip and attempted_at > now() - interval '5 minutes';
    if v_fails >= 5 then
      return json_build_object('ok', false, 'reason', 'locked', 'retry_seconds', 300);
    end if;
    return json_build_object('ok', false, 'reason', 'wrong', 'tries_left', 5 - v_fails);
  end if;

  delete from public.admin_attempts where ip = v_ip;
  select * into cfg from public.event_config where id;

  return json_build_object(
    'ok', true,
    'kssm_cap',  cfg.kssm_cap,
    'igcse_cap', cfg.igcse_cap,
    'kssm', coalesce((
      select json_agg(json_build_object(
               'name', r.name, 'email', r.email, 'phone', r.phone_norm, 'created_at', r.created_at)
             order by r.created_at desc, r.seq desc)
        from public.kssm_registrations r), '[]'::json),
    'igcse', coalesce((
      select json_agg(json_build_object(
               'name', r.name, 'email', r.email, 'phone', r.phone_norm, 'created_at', r.created_at)
             order by r.created_at desc, r.seq desc)
        from public.igcse_registrations r), '[]'::json)
  );
end;
$$;

-- Run this yourself in the SQL editor to set or change the staff passcode:
--   select public.set_admin_passcode('your-passcode-here');
-- Only the hash is stored. The browser can never call this.
create or replace function public.set_admin_passcode(p_passcode text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_passcode is null or char_length(p_passcode) < 6 then
    raise exception 'Passcode must be at least 6 characters';
  end if;
  insert into public.admin_config (id, passcode_hash)
  values (true, crypt(p_passcode, gen_salt('bf', 10)))
  on conflict (id) do update set passcode_hash = excluded.passcode_hash;
end;
$$;

-- ------------------------------------------- who may call which function

revoke all on function public.get_status()                               from public;
revoke all on function public.claim_account(text, text, text, text, boolean) from public;
revoke all on function public.admin_list(text)                           from public;
revoke all on function public.set_admin_passcode(text)                   from public;

grant execute on function public.get_status()                               to anon, authenticated;
grant execute on function public.claim_account(text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.admin_list(text)                           to anon, authenticated;
-- set_admin_passcode: no grant. SQL editor (postgres role) only.
