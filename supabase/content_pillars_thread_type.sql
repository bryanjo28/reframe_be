alter table public.content_pillars
  drop column if exists ai_enhanced_version,
  drop column if exists user_review_edit;

alter table public.content_pillars
  add column if not exists thread_type text not null default 'short';

alter table public.content_pillars
  drop constraint if exists content_pillars_thread_type_check;

alter table public.content_pillars
  add constraint content_pillars_thread_type_check
  check (thread_type in ('short', 'long'));

alter table public.content_outputs
  add column if not exists thread_type text not null default 'short';

alter table public.content_outputs
  drop constraint if exists content_outputs_thread_type_check;

alter table public.content_outputs
  add constraint content_outputs_thread_type_check
  check (thread_type in ('short', 'long'));

alter table public.published_posts
  add column if not exists sequence_number integer not null default 1,
  add column if not exists post_content text;

alter table public.published_posts
  drop constraint if exists published_posts_sequence_number_check;

alter table public.published_posts
  add constraint published_posts_sequence_number_check
  check (sequence_number >= 1);

create unique index if not exists uq_published_posts_output_sequence
  on public.published_posts (content_output_id, sequence_number);
