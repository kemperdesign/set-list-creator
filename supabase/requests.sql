-- Audience song requests (QR code -> requests page). Run once in Supabase > SQL editor. Safe to re-run.

-- Public settings live on the band row. public_songs is the list the audience can pick from (title + artist only).
alter table public.setlists add column if not exists request_code text unique;
alter table public.setlists add column if not exists request_enabled boolean not null default false;
alter table public.setlists add column if not exists public_songs jsonb not null default '[]';

create table if not exists public.song_requests (
  id uuid primary key default gen_random_uuid(),
  setlist_id uuid not null references public.setlists(id) on delete cascade,
  song_id text,
  title text not null,
  artist text,
  requester text,
  note text,
  device text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);
create index if not exists song_requests_band_idx on public.song_requests (setlist_id, created_at desc);
alter table public.song_requests enable row level security;

-- Only the band (owner or invited members) can read and manage requests. The audience never touches the table directly.
drop policy if exists "band can read requests" on public.song_requests;
drop policy if exists "band can update requests" on public.song_requests;
drop policy if exists "band can delete requests" on public.song_requests;
create policy "band can read requests" on public.song_requests
  for select using (public.is_setlist_owner(setlist_id) or public.is_setlist_member(setlist_id));
create policy "band can update requests" on public.song_requests
  for update using (public.is_setlist_owner(setlist_id) or public.is_setlist_member(setlist_id));
create policy "band can delete requests" on public.song_requests
  for delete using (public.is_setlist_owner(setlist_id) or public.is_setlist_member(setlist_id));

-- What the public request page may read: band name + the pickable song list. Nothing else (no lyrics, charts or sets).
create or replace function public.request_get_band(p_code text)
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object('name', name, 'songs', public_songs)
  from public.setlists where request_code = p_code and request_enabled;
$$;

-- What the public request page may do: add one request, with simple spam limits.
create or replace function public.request_submit(
  p_code text, p_title text, p_artist text, p_song_id text, p_requester text, p_note text, p_device text
) returns text language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  select id into sid from public.setlists where request_code = p_code and request_enabled;
  if sid is null then return 'closed'; end if;
  if length(trim(coalesce(p_title, ''))) = 0 or length(p_title) > 200 then return 'invalid'; end if;
  if (select count(*) from public.song_requests where setlist_id = sid and device = p_device and created_at > now() - interval '10 minutes') >= 6 then
    return 'slow_down';
  end if;
  if exists (select 1 from public.song_requests where setlist_id = sid and device = p_device and status = 'new' and lower(title) = lower(p_title)) then
    return 'duplicate';
  end if;
  insert into public.song_requests (setlist_id, song_id, title, artist, requester, note, device)
  values (sid, p_song_id, left(trim(p_title), 200), left(p_artist, 200), left(p_requester, 60), left(p_note, 300), left(p_device, 80));
  return 'ok';
end;
$$;

revoke all on function public.request_get_band(text) from public;
revoke all on function public.request_submit(text, text, text, text, text, text, text) from public;
grant execute on function public.request_get_band(text) to anon, authenticated;
grant execute on function public.request_submit(text, text, text, text, text, text, text) to anon, authenticated;

-- Live alerts to the band
do $$ begin
  alter publication supabase_realtime add table public.song_requests;
exception when duplicate_object then null; end $$;
