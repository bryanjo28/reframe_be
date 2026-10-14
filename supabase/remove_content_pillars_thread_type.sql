-- Content length is selected per generation request and snapshotted on content_outputs.
-- Run this after deploying the backend version that no longer reads this column.
alter table public.content_pillars
  drop constraint if exists content_pillars_thread_type_check;

alter table public.content_pillars
  drop column if exists thread_type;
