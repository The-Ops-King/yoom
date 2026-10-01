-- Playback failure reporting.
--
-- Until now a viewer whose player failed left behind a row that was
-- indistinguishable from someone who simply never pressed play: both show
-- max_percent = 0. That ambiguity made a real "people can't see the video"
-- report undiagnosable. These columns record what the browser actually said.

alter table public.view_sessions
  add column if not exists playback_error_code smallint
    check (playback_error_code is null or playback_error_code between 1 and 4),
  add column if not exists playback_error_detail text,
  add column if not exists playback_error_at timestamptz,
  add column if not exists used_drive_fallback boolean not null default false;

comment on column public.view_sessions.playback_error_code is
  'MediaError.code: 1 ABORTED, 2 NETWORK, 3 DECODE, 4 SRC_NOT_SUPPORTED.';
comment on column public.view_sessions.used_drive_fallback is
  'True once the watch page swapped in the Google Drive player for this viewer.';

-- Finding the failures is the point, so index only the rows that have one.
create index if not exists view_sessions_playback_error_idx
  on public.view_sessions (playback_error_at desc)
  where playback_error_code is not null;
