-- Fix: the PL/pgSQL variable `old_slug` was ambiguous with the
-- slug_history.old_slug column inside the INSERT (SQLSTATE 42702), so every
-- slug change failed. Rename the variable.
create or replace function public.change_video_slug(
  p_video_id uuid,
  p_new_slug text
)
returns public.videos
language plpgsql
set search_path = public
as $$
declare
  v_old_slug text;
  result public.videos;
begin
  select slug into v_old_slug from public.videos where id = p_video_id;
  if v_old_slug is null then
    return null;
  end if;
  if v_old_slug = p_new_slug then
    select * into result from public.videos where id = p_video_id;
    return result;
  end if;

  -- A recycled slug re-points the old redirect to this video by design.
  insert into public.slug_history (old_slug, video_id)
  values (v_old_slug, p_video_id)
  on conflict (old_slug) do update set video_id = excluded.video_id;

  -- If the new slug was a previous slug of this or another video, free it.
  delete from public.slug_history where old_slug = p_new_slug;

  update public.videos
     set slug = p_new_slug
   where id = p_video_id
   returning * into result;

  return result;
end;
$$;

revoke all on function public.change_video_slug(uuid, text) from public, anon, authenticated;
