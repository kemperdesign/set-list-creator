-- Set List Generator: database schema (Supabase / Postgres)
-- Run in the Supabase dashboard > SQL editor. Safe to re-run.

-- One row per band. `data` holds the whole board (song library incl. keys + lyrics, sets, saved sets).
create table if not exists public.setlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  data jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.setlists enable row level security;

-- Bandmates who can open/edit a band. Matched by the email on their account.
create table if not exists public.setlist_members (
  setlist_id uuid not null references public.setlists(id) on delete cascade,
  email text not null,
  added_at timestamptz default now(),
  primary key (setlist_id, email)
);
alter table public.setlist_members enable row level security;

-- Helper functions are SECURITY DEFINER so the two tables' policies can reference each other
-- without infinite recursion.
create or replace function public.is_setlist_owner(sid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.setlists where id = sid and user_id = auth.uid());
$$;

create or replace function public.is_setlist_member(sid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(
    select 1 from public.setlist_members
    where setlist_id = sid and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- setlists: owner has full control; invited members can read + update (edit the board) but not delete/share.
drop policy if exists "users can read own setlists" on public.setlists;
drop policy if exists "users can update own setlists" on public.setlists;
drop policy if exists "users can insert own setlists" on public.setlists;
drop policy if exists "users can delete own setlists" on public.setlists;
drop policy if exists "owner or member can read" on public.setlists;
drop policy if exists "owner or member can update" on public.setlists;

create policy "owner or member can read" on public.setlists
  for select using (auth.uid() = user_id or public.is_setlist_member(id));
create policy "owner or member can update" on public.setlists
  for update using (auth.uid() = user_id or public.is_setlist_member(id));
create policy "users can insert own setlists" on public.setlists
  for insert with check (auth.uid() = user_id);
create policy "users can delete own setlists" on public.setlists
  for delete using (auth.uid() = user_id);

-- setlist_members: owner manages the list; a member can see their own row.
drop policy if exists "owner or self can read members" on public.setlist_members;
drop policy if exists "owner can add members" on public.setlist_members;
drop policy if exists "owner can remove members" on public.setlist_members;

create policy "owner or self can read members" on public.setlist_members
  for select using (
    public.is_setlist_owner(setlist_id)
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
create policy "owner can add members" on public.setlist_members
  for insert with check (public.is_setlist_owner(setlist_id));
create policy "owner can remove members" on public.setlist_members
  for delete using (public.is_setlist_owner(setlist_id));

-- Live updates between bandmates
do $$ begin
  alter publication supabase_realtime add table public.setlists;
exception when duplicate_object then null; end $$;
