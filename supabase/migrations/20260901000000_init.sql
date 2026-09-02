-- Phase 1 schema for Yoom.
-- RLS is enabled with no policies on every table: only the service role can read
-- or write, which is the only key the server holds.

create extension if not exists pgcrypto;

-- videos ---------------------------------------------------------------------
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null default 'Untitled recording',
  description text,
  drive_file_id text unique not null,
  mime text not null default 'video/webm',
  size_bytes bigint,
  duration_ms int,
  width int,
  height int,
  thumbnail_drive_file_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists videos_created_at_idx
  on public.videos (created_at desc);

alter table public.videos enable row level security;

-- slug_history ---------------------------------------------------------------
create table if not exists public.slug_history (
  old_slug text primary key,
  video_id uuid not null references public.videos (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists slug_history_video_id_idx
  on public.slug_history (video_id);

alter table public.slug_history enable row level security;

-- view_sessions --------------------------------------------------------------
create table if not exists public.view_sessions (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos (id) on delete cascade,
  viewer_name text,
  ip_hash text,
  user_agent text,
  country text,
  city text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  max_percent smallint not null default 0
    check (max_percent >= 0 and max_percent <= 100),
  ended_at timestamptz,
  alert_sent_at timestamptz,
  summary_sent_at timestamptz,
  milestones jsonb not null default '{}'::jsonb
);

create index if not exists view_sessions_video_started_idx
  on public.view_sessions (video_id, started_at desc);

alter table public.view_sessions enable row level security;

-- settings (single row) ------------------------------------------------------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  alert_on_first_view boolean not null default true,
  alert_on_completion boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.settings (id) values (1)
  on conflict (id) do nothing;

alter table public.settings enable row level security;

-- progress update ------------------------------------------------------------
-- Monotonic max_percent, touch last_seen_at, optionally close the session.
-- Returns NULL (not an all-null row) when the session does not exist.
create or replace function public.update_view_progress(
  p_session_id uuid,
  p_percent smallint,
  p_ended boolean
)
returns public.view_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.view_sessions;
begin
  update public.view_sessions
     set max_percent = greatest(
           max_percent,
           least(100, greatest(0, coalesce(p_percent, 0)))
         ),
         last_seen_at = now(),
         ended_at = case
           when p_ended then coalesce(ended_at, now())
           else ended_at
         end
   where id = p_session_id
   returning * into result;

  if not found then
    return null;
  end if;

  return result;
end;
$$;

-- slug change (Phase 3 uses this; created now so there is one migration) -----
-- Records the old slug in slug_history and swaps the slug in one transaction.
create or replace function public.change_video_slug(
  p_video_id uuid,
  p_new_slug text
)
returns public.videos
language plpgsql
security definer
set search_path = public
as $$
declare
  old_slug text;
  result public.videos;
begin
  select slug into old_slug from public.videos where id = p_video_id;
  if old_slug is null then
    return null;
  end if;
  if old_slug = p_new_slug then
    select * into result from public.videos where id = p_video_id;
    return result;
  end if;

  insert into public.slug_history (old_slug, video_id)
  values (old_slug, p_video_id)
  on conflict (old_slug) do update set video_id = excluded.video_id;

  -- If the new slug was a previous slug of this or another video, free it.
  delete from public.slug_history where old_slug = p_new_slug;

  update public.videos
     set slug = p_new_slug, updated_at = now()
   where id = p_video_id
   returning * into result;

  return result;
end;
$$;

-- per-video aggregates (Phase 3 library/detail pages) ------------------------
create or replace view public.video_stats as
select
  v.id as video_id,
  count(s.id)::int as view_count,
  count(distinct coalesce(s.viewer_name, s.ip_hash, s.id::text))::int as unique_viewers,
  coalesce(avg(s.max_percent), 0)::numeric(5,2) as avg_max_percent,
  max(s.last_seen_at) as last_viewed_at
from public.videos v
left join public.view_sessions s on s.video_id = v.id
group by v.id;
