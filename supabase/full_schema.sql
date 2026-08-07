-- Runnable schema for Supabase environment bootstrap.
-- Ordered for execution and aligned with the current application code.

create type public.content_output_status as enum (
  'draft',
  'approved',
  'posted',
  'failed'
);

create table public.profiles (
  id uuid not null,
  account_name text not null unique,
  full_name text,
  created_at timestamp with time zone default now(),
  role text not null default 'user' check (role = any (array['user', 'admin'])),
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign key (id) references auth.users(id)
);

create table public.subscription_plans (
  id uuid not null default gen_random_uuid(),
  code text not null unique,
  name text not null,
  max_personas integer not null default 1,
  monthly_ai_credits integer not null default 100,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  daily_topic_generations integer not null default 0,
  daily_content_generations integer not null default 0,
  price numeric not null default 0,
  constraint subscription_plans_pkey primary key (id)
);

create table public.persona_configs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  persona text,
  target_audience text,
  niche_topic_focus text,
  content_style text,
  tone text,
  goal text,
  platform text default 'Threads',
  format_output text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  is_active boolean not null default true,
  constraint persona_configs_pkey primary key (id),
  constraint persona_configs_user_id_fkey foreign key (user_id) references public.profiles(id)
);

create table public.content_pillars (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  persona_config_id uuid not null,
  pillar_name text not null,
  template_content text,
  target_objective text,
  audience_segment text,
  key_message text,
  cta_direction text,
  affiliate_link text,
  ai_enhanced_version text,
  user_review_edit text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint content_pillars_pkey primary key (id),
  constraint content_pillars_user_id_fkey foreign key (user_id) references public.profiles(id),
  constraint content_pillars_persona_config_id_fkey foreign key (persona_config_id) references public.persona_configs(id)
);

create table public.content_topics (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  persona_config_id uuid not null,
  category text,
  subcategory text,
  topic text,
  used_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  content_pillar_id uuid,
  constraint content_topics_pkey primary key (id),
  constraint content_topics_user_id_fkey foreign key (user_id) references public.profiles(id),
  constraint content_topics_persona_config_id_fkey foreign key (persona_config_id) references public.persona_configs(id),
  constraint content_topics_content_pillar_id_fkey foreign key (content_pillar_id) references public.content_pillars(id)
);

create table public.scheduled_jobs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  persona_config_id uuid not null,
  schedule_type text,
  schedule_value text,
  status text default 'active',
  last_run_at timestamp without time zone,
  next_run_at timestamp without time zone,
  created_at timestamp without time zone default now(),
  error_message text,
  job_type text not null default 'generate_content_from_topics',
  config jsonb not null default '{}'::jsonb,
  target_count integer not null default 10,
  schedule_timezone text default 'Asia/Jakarta',
  last_run_status text,
  last_run_generated_count integer not null default 0,
  last_run_error text,
  constraint scheduled_jobs_pkey primary key (id),
  constraint scheduled_jobs_user_id_fkey foreign key (user_id) references public.profiles(id),
  constraint scheduled_jobs_persona_config_id_fkey foreign key (persona_config_id) references public.persona_configs(id)
);

create table public.scheduled_job_runs (
  id uuid not null default gen_random_uuid(),
  scheduled_job_id uuid not null,
  user_id uuid not null,
  status text not null default 'running',
  target_count integer not null default 10,
  fetched_count integer not null default 0,
  processed_count integer not null default 0,
  success_count integer not null default 0,
  failed_count integer not null default 0,
  run_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb,
  error_message text,
  started_at timestamp with time zone not null default now(),
  finished_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  constraint scheduled_job_runs_pkey primary key (id),
  constraint scheduled_job_runs_scheduled_job_id_fkey foreign key (scheduled_job_id) references public.scheduled_jobs(id),
  constraint scheduled_job_runs_user_id_fkey foreign key (user_id) references public.profiles(id)
);

create table public.social_accounts (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  platform text not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamp with time zone,
  platform_user_id text,
  username text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint social_accounts_pkey primary key (id),
  constraint social_accounts_user_id_fkey foreign key (user_id) references public.profiles(id)
);

create table public.content_outputs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  persona_config_id uuid not null,
  topic_id uuid,
  platform text default 'threads',
  format_output text,
  content text not null,
  status public.content_output_status default 'draft',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  retry_count integer default 0,
  content_pillar_id uuid,
  scheduled_at timestamp with time zone,
  external_post_id text,
  scheduled_job_id uuid,
  scheduled_job_run_id uuid,
  publish_scheduled_job_id uuid,
  publish_scheduled_job_run_id uuid,
  constraint content_outputs_pkey primary key (id),
  constraint content_outputs_user_id_fkey foreign key (user_id) references public.profiles(id),
  constraint content_outputs_persona_config_id_fkey foreign key (persona_config_id) references public.persona_configs(id),
  constraint content_outputs_topic_id_fkey foreign key (topic_id) references public.content_topics(id),
  constraint content_outputs_content_pillar_id_fkey foreign key (content_pillar_id) references public.content_pillars(id),
  constraint content_outputs_scheduled_job_id_fkey foreign key (scheduled_job_id) references public.scheduled_jobs(id),
  constraint content_outputs_scheduled_job_run_id_fkey foreign key (scheduled_job_run_id) references public.scheduled_job_runs(id),
  constraint content_outputs_publish_scheduled_job_id_fkey foreign key (publish_scheduled_job_id) references public.scheduled_jobs(id),
  constraint content_outputs_publish_scheduled_job_run_id_fkey foreign key (publish_scheduled_job_run_id) references public.scheduled_job_runs(id)
);

create table public.published_posts (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  social_account_id uuid,
  content_output_id uuid,
  platform text not null,
  platform_post_id text,
  post_url text,
  posted_at timestamp with time zone,
  status text default 'success',
  error_message text,
  created_at timestamp with time zone default now(),
  parent_published_post_id uuid,
  constraint published_posts_pkey primary key (id),
  constraint published_posts_user_id_fkey foreign key (user_id) references public.profiles(id),
  constraint published_posts_social_account_id_fkey foreign key (social_account_id) references public.social_accounts(id),
  constraint published_posts_content_output_id_fkey foreign key (content_output_id) references public.content_outputs(id),
  constraint published_posts_parent_published_post_id_fkey foreign key (parent_published_post_id) references public.published_posts(id)
);

create table public.generation_logs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  persona_config_id uuid,
  topic_id uuid,
  input_payload jsonb,
  output_payload jsonb,
  status text default 'success',
  error_message text,
  created_at timestamp with time zone default now(),
  scheduled_job_run_id uuid,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  provider text,
  constraint generation_logs_pkey primary key (id),
  constraint generation_logs_user_id_fkey foreign key (user_id) references public.profiles(id),
  constraint generation_logs_persona_config_id_fkey foreign key (persona_config_id) references public.persona_configs(id),
  constraint generation_logs_topic_id_fkey foreign key (topic_id) references public.content_topics(id),
  constraint generation_logs_scheduled_job_run_id_fkey foreign key (scheduled_job_run_id) references public.scheduled_job_runs(id)
);

create table public.reference_notes (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  persona_config_id uuid,
  title text,
  content text not null,
  source_type text,
  created_at timestamp with time zone default now(),
  constraint reference_notes_pkey primary key (id),
  constraint reference_notes_user_id_fkey foreign key (user_id) references public.profiles(id),
  constraint reference_notes_persona_config_id_fkey foreign key (persona_config_id) references public.persona_configs(id)
);

create table public.user_subscriptions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  plan_id uuid not null,
  started_at timestamp with time zone not null default now(),
  ends_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  status text not null default 'active' check (status = any (array['active', 'inactive', 'paused', 'cancelled', 'expired'])),
  constraint user_subscriptions_pkey primary key (id),
  constraint user_subscriptions_plan_id_fkey foreign key (plan_id) references public.subscription_plans(id),
  constraint user_subscriptions_user_id_fkey foreign key (user_id) references public.profiles(id)
);

create table public.user_usage (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  period_month date not null,
  ai_credits_used integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint user_usage_pkey primary key (id),
  constraint user_usage_user_id_fkey foreign key (user_id) references public.profiles(id)
);

create table public.prompt_templates (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  name text,
  template text not null,
  variables jsonb,
  is_global boolean default false,
  created_at timestamp without time zone default now(),
  constraint prompt_templates_pkey primary key (id),
  constraint prompt_templates_user_id_fkey foreign key (user_id) references public.profiles(id)
);

create table public.ai_settings (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  model text default 'gpt-4o',
  temperature numeric default 0.7,
  max_tokens integer default 1000,
  created_at timestamp without time zone default now(),
  constraint ai_settings_pkey primary key (id),
  constraint ai_settings_user_id_fkey foreign key (user_id) references public.profiles(id)
);

create table public.generation_topic_logs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  persona_config_id uuid not null,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  status text not null default 'success',
  error_message text,
  created_at timestamp with time zone not null default now(),
  topic_count integer default 0,
  provider text,
  constraint generation_topic_logs_pkey primary key (id),
  constraint generation_topic_logs_user_id_fkey foreign key (user_id) references public.profiles(id),
  constraint generation_topic_logs_persona_config_id_fkey foreign key (persona_config_id) references public.persona_configs(id)
);

create table public.user_daily_usage (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  usage_date date not null,
  usage_key text not null check (usage_key = any (array['generate_topic', 'generate_content'])),
  request_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint user_daily_usage_pkey primary key (id),
  constraint user_daily_usage_user_id_fkey foreign key (user_id) references public.profiles(id)
);
