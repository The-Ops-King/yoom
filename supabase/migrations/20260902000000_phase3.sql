-- Phase 3: owner dashboard.
-- Adds the non-destructive edit-decision-list column (Phase 5 foundation) and
-- the index the library's "recently viewed" ordering needs.

alter table public.videos
  add column if not exists edits jsonb not null default '{}'::jsonb;

create index if not exists view_sessions_video_last_seen_idx
  on public.view_sessions (video_id, last_seen_at desc);

-- Re-asserted verbatim from the Phase 1 migration so a fresh database that runs
-- only this file still gets the columns the dashboard reads:
--   video_id, view_count, unique_viewers, avg_max_percent, last_viewed_at
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

alter view public.video_stats set (security_invoker = on);
revoke all on public.video_stats from anon, authenticated;
