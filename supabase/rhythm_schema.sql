-- ============================================================
-- RHYTHM — Supabase schema for shared (online) beatmaps
-- Run this once in the Supabase SQL Editor (Dashboard → SQL).
--
-- This project shares a Supabase instance with Coup. Every object
-- here is prefixed `rhythm_`, and nothing below touches Coup's
-- tables (games, players, game_logs), its touch_updated_at()
-- function, or the realtime publication.
--
-- Model: players are anonymous (no Supabase Auth), like Coup.
--   * Anyone can browse and play shared maps.
--   * Anyone can share a map. Maps can't be edited after sharing.
--   * Only the browser that shared a map can delete it. When it
--     shares, it keeps a random secret token in localStorage and
--     sends only the token's SHA-256 hash. Deleting means calling
--     rhythm_delete_map() with the original token.
--   * The owner hash is never readable through the API (column
--     privileges below), so it can't be harvested.
--   * Play counts only change through rhythm_count_play().
--   * You (the project owner) can delete anything from the
--     dashboard's Table Editor, which bypasses these rules.
-- ============================================================

-- ---------- Note validation ----------
-- notes is a JSON array of [lane, time_ms] pairs, e.g. [[0,1200],[3,1400]].
-- CASE is used so each check only runs once the previous one passed
-- (Postgres doesn't guarantee AND/OR short-circuiting).

create or replace function public.rhythm_notes_valid(n jsonb, expected_count int)
returns boolean
language sql
immutable
as $$
  select case
    when jsonb_typeof(n) <> 'array' then false
    when jsonb_array_length(n) <> expected_count then false
    else not exists (
      select 1
      from jsonb_array_elements(n) as e
      where not (
        case
          when jsonb_typeof(e) <> 'array' then false
          when jsonb_array_length(e) <> 2 then false
          when jsonb_typeof(e->0) <> 'number' or jsonb_typeof(e->1) <> 'number' then false
          else (e->>0)::numeric in (0, 1, 2, 3)
           and (e->>1)::numeric between 0 and 1200000
        end
      )
    )
  end
$$;

-- ---------- Table ----------

create table public.rhythm_maps (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(btrim(title)) between 1 and 60),
  author       text not null check (char_length(btrim(author)) between 1 and 24),
  song         text not null check (song ~ '^[a-z0-9_-]{1,32}$'),   -- song id in the game, e.g. 'night'
  notes        jsonb not null,
  note_count   int  not null check (note_count between 1 and 5000),
  duration_ms  int  not null check (duration_ms between 0 and 1200000),
  plays        int  not null default 0 check (plays >= 0),
  owner_hash   text not null check (owner_hash ~ '^[0-9a-f]{64}$'), -- sha256(owner token), hex
  created_at   timestamptz not null default now(),
  constraint rhythm_maps_notes_valid check (public.rhythm_notes_valid(notes, note_count)),
  constraint rhythm_maps_notes_size  check (pg_column_size(notes) <= 262144)  -- 256 KB
);

create index rhythm_maps_newest_idx  on public.rhythm_maps (created_at desc);
create index rhythm_maps_popular_idx on public.rhythm_maps (plays desc, created_at desc);

-- ---------- Row Level Security ----------

alter table public.rhythm_maps enable row level security;

create policy "rhythm maps are readable"
  on public.rhythm_maps for select to anon, authenticated
  using (true);

create policy "anyone may share a rhythm map"
  on public.rhythm_maps for insert to anon, authenticated
  with check (plays = 0);

-- No update or delete policies: rows can't be changed or removed
-- through the API except by the functions below.

-- ---------- Column privileges ----------
-- Supabase grants every API role full access to new tables by
-- default. Narrow that: clients may read everything except
-- owner_hash, and may only set the listed columns when sharing
-- (id, plays and created_at always come from the defaults).

revoke all on table public.rhythm_maps from anon, authenticated;

grant select (id, title, author, song, notes, note_count, duration_ms, plays, created_at)
  on public.rhythm_maps to anon, authenticated;

grant insert (title, author, song, notes, note_count, duration_ms, owner_hash)
  on public.rhythm_maps to anon, authenticated;

-- ---------- Functions callable from the game ----------

-- Delete a map you shared. Returns true if a map was deleted.
create or replace function public.rhythm_delete_map(p_id uuid, p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted int;
begin
  if p_token is null or char_length(p_token) < 32 then
    return false;
  end if;
  delete from public.rhythm_maps
   where id = p_id
     and owner_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  get diagnostics deleted = row_count;
  return deleted > 0;
end $$;

-- Count one finished play of a map.
create or replace function public.rhythm_count_play(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.rhythm_maps set plays = plays + 1 where id = p_id;
$$;

revoke all on function public.rhythm_delete_map(uuid, text) from public;
revoke all on function public.rhythm_count_play(uuid) from public;
revoke all on function public.rhythm_notes_valid(jsonb, int) from public;
grant execute on function public.rhythm_delete_map(uuid, text) to anon, authenticated;
grant execute on function public.rhythm_count_play(uuid) to anon, authenticated;
-- The check constraint calls rhythm_notes_valid with the rights of
-- whoever is inserting, so the API roles need to be able to run it.
-- It only inspects the JSON it is given.
grant execute on function public.rhythm_notes_valid(jsonb, int) to anon, authenticated;

-- ---------- Undo ----------
-- To remove everything this file created:
--   drop table if exists public.rhythm_maps;
--   drop function if exists public.rhythm_delete_map(uuid, text);
--   drop function if exists public.rhythm_count_play(uuid);
--   drop function if exists public.rhythm_notes_valid(jsonb, int);
