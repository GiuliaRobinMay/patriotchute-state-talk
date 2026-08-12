-- State Rooms — database schema
--
-- Run this once, in Supabase → SQL Editor → New query → paste → Run.
-- Safe to run more than once.
--
-- Three tables: who people are, what they said, and what the hosts pinned.
-- Row-level security is what actually protects this data, since the key in
-- the browser is public by design. The rules below say: any signed-in member
-- may read, but may only ever write as themselves.

-- ── who people are ────────────────────────────────────────────────
create table if not exists profiles (
  id          uuid primary key references auth.users on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  city        text check (char_length(city) <= 60),
  state       text not null check (char_length(state) = 2),
  bg          text,
  fg          text,
  photo       text,
  email       text,
  is_host     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_state_idx on profiles (state);

-- ── what they said ────────────────────────────────────────────────
create table if not exists messages (
  id          bigint generated always as identity primary key,
  room        text not null check (char_length(room) = 2),
  author      uuid not null references auth.users on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);

-- The room view is always "newest N in this room", so index for exactly that.
create index if not exists messages_room_time_idx on messages (room, created_at desc);

-- ── what the hosts pinned ─────────────────────────────────────────
create table if not exists notices (
  id          bigint generated always as identity primary key,
  title       text not null check (char_length(title) between 1 and 120),
  body        text check (char_length(body) <= 1000),
  rooms       text[] not null default '{}',   -- empty array means every room
  author      uuid not null references auth.users on delete cascade,
  author_name text not null,
  until       timestamptz,                     -- null means until taken down
  starts_at   timestamptz,                     -- set = a gather moment
  created_at  timestamptz not null default now()
);

-- Gather moments were added after the first installs; this brings an
-- existing database up to date. Harmless on a fresh one.
alter table notices add column if not exists starts_at timestamptz;

-- ── security ──────────────────────────────────────────────────────
alter table profiles enable row level security;
alter table messages enable row level security;
alter table notices  enable row level security;

drop policy if exists "members read profiles"   on profiles;
drop policy if exists "write your own profile"  on profiles;
drop policy if exists "edit your own profile"   on profiles;
drop policy if exists "members read messages"   on messages;
drop policy if exists "post as yourself"        on messages;
drop policy if exists "delete your own message" on messages;
drop policy if exists "members read notices"    on notices;
drop policy if exists "hosts pin notices"       on notices;
drop policy if exists "hosts remove notices"    on notices;

create policy "members read profiles" on profiles
  for select to authenticated using (true);

create policy "write your own profile" on profiles
  for insert to authenticated with check (auth.uid() = id);

create policy "edit your own profile" on profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "members read messages" on messages
  for select to authenticated using (true);

-- The author column cannot be forged: it must equal the caller's own id.
create policy "post as yourself" on messages
  for insert to authenticated with check (auth.uid() = author);

create policy "delete your own message" on messages
  for delete to authenticated using (auth.uid() = author);

create policy "members read notices" on notices
  for select to authenticated using (true);

create policy "hosts pin notices" on notices
  for insert to authenticated with check (
    auth.uid() = author
    and exists (select 1 from profiles p where p.id = auth.uid() and p.is_host)
  );

create policy "hosts remove notices" on notices
  for delete to authenticated using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_host)
  );

-- ── live updates ──────────────────────────────────────────────────
-- Without this, new messages only appear on refresh.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'notices'
  ) then
    alter publication supabase_realtime add table notices;
  end if;
end $$;

-- ── the admin zone ────────────────────────────────────────────────

alter table profiles add column if not exists banned  boolean not null default false;
alter table notices  add column if not exists repeats boolean not null default false;

-- A member may edit their own row, so without this they could also edit
-- is_host or banned and promote themselves. Column grants close that door;
-- admins change those two columns through the functions below instead.
revoke update on table profiles from authenticated;
grant update (name, city, state, bg, fg, photo, email, updated_at)
  on table profiles to authenticated;

-- The banned cannot post; admins may remove anything.
drop policy if exists "post as yourself" on messages;
create policy "post as yourself" on messages
  for insert to authenticated with check (
    auth.uid() = author
    and not exists (select 1 from profiles p where p.id = auth.uid() and p.banned)
  );

drop policy if exists "delete your own message" on messages;
drop policy if exists "delete own or as admin"  on messages;
create policy "delete own or as admin" on messages
  for delete to authenticated using (
    auth.uid() = author
    or exists (select 1 from profiles p where p.id = auth.uid() and p.is_host)
  );

-- ── flagged content ───────────────────────────────────────────────
create table if not exists reports (
  id          bigint generated always as identity primary key,
  message_id  bigint not null references messages on delete cascade,
  reporter    uuid not null references auth.users on delete cascade,
  created_at  timestamptz not null default now(),
  unique (message_id, reporter)          -- one flag per person per message
);

alter table reports enable row level security;

drop policy if exists "members flag messages" on reports;
drop policy if exists "admins read flags"     on reports;
drop policy if exists "admins clear flags"    on reports;

create policy "members flag messages" on reports
  for insert to authenticated with check (auth.uid() = reporter);

create policy "admins read flags" on reports
  for select to authenticated using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_host)
  );

create policy "admins clear flags" on reports
  for delete to authenticated using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_host)
  );

-- ── admin actions on the protected columns ────────────────────────
-- security definer lets these bypass the column grants above; the caller
-- must themselves be an admin or the update matches no rows.
create or replace function admin_set_banned(target uuid, value boolean)
returns void language sql security definer set search_path = public as $$
  update profiles set banned = value
  where id = target
    and exists (select 1 from profiles p where p.id = auth.uid() and p.is_host);
$$;

create or replace function admin_set_admin(target uuid, value boolean)
returns void language sql security definer set search_path = public as $$
  update profiles set is_host = value
  where id = target
    and exists (select 1 from profiles p where p.id = auth.uid() and p.is_host);
$$;

-- ── making yourself a host ────────────────────────────────────────
-- Join the app first so a profile exists, then run:
--
--   update profiles set is_host = true where name = 'Your Name';
--
-- Hosts can reach every state room and pin announcements.
