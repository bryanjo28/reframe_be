-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  account_name text NOT NULL UNIQUE,
  full_name text,
  created_at timestamp with time zone DEFAULT now(),
  role text NOT NULL DEFAULT 'user'::text CHECK (role = ANY (ARRAY['user'::text, 'admin'::text])),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.persona_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  persona text,
  target_audience text,
  niche_topic_focus text,
  content_style text,
  tone text,
  goal text,
  platform text DEFAULT 'Threads'::text,
  format_output text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT persona_configs_pkey PRIMARY KEY (id),
  CONSTRAINT persona_configs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.content_topics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  persona_config_id uuid NOT NULL,
  category text,
  subcategory text,
  topic text,
  used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  content_pillar_id uuid,
  CONSTRAINT content_topics_pkey PRIMARY KEY (id),
  CONSTRAINT content_topics_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT content_topics_persona_config_id_fkey FOREIGN KEY (persona_config_id) REFERENCES public.persona_configs(id),
  CONSTRAINT content_topics_content_pillar_id_fkey FOREIGN KEY (content_pillar_id) REFERENCES public.content_pillars(id)
);
CREATE TABLE public.social_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  expires_at timestamp with time zone,
  platform_user_id text,
  username text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT social_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT social_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.content_outputs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  persona_config_id uuid NOT NULL,
  topic_id uuid,
  platform text DEFAULT 'threads'::text,
  format_output text,
  content text NOT NULL,
  status USER-DEFINED,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  retry_count integer DEFAULT 0,
  content_pillar_id uuid,
  scheduled_at timestamp with time zone,
  external_post_id text,
  scheduled_job_id uuid,
  scheduled_job_run_id uuid,
  CONSTRAINT content_outputs_pkey PRIMARY KEY (id),
  CONSTRAINT content_outputs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT content_outputs_persona_config_id_fkey FOREIGN KEY (persona_config_id) REFERENCES public.persona_configs(id),
  CONSTRAINT content_outputs_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.content_topics(id),
  CONSTRAINT content_outputs_content_pillar_id_fkey FOREIGN KEY (content_pillar_id) REFERENCES public.content_pillars(id),
  CONSTRAINT content_outputs_scheduled_job_id_fkey FOREIGN KEY (scheduled_job_id) REFERENCES public.scheduled_jobs(id),
  CONSTRAINT content_outputs_scheduled_job_run_id_fkey FOREIGN KEY (scheduled_job_run_id) REFERENCES public.scheduled_job_runs(id)
);
CREATE TABLE public.published_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  social_account_id uuid,
  content_output_id uuid,
  platform text NOT NULL,
  platform_post_id text,
  post_url text,
  posted_at timestamp with time zone,
  status text DEFAULT 'success'::text,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  parent_published_post_id uuid,
  CONSTRAINT published_posts_pkey PRIMARY KEY (id),
  CONSTRAINT published_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT published_posts_social_account_id_fkey FOREIGN KEY (social_account_id) REFERENCES public.social_accounts(id),
  CONSTRAINT published_posts_content_output_id_fkey FOREIGN KEY (content_output_id) REFERENCES public.content_outputs(id),
  CONSTRAINT published_posts_parent_published_post_id_fkey FOREIGN KEY (parent_published_post_id) REFERENCES public.published_posts(id)
);
CREATE TABLE public.generation_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  persona_config_id uuid,
  topic_id uuid,
  input_payload jsonb,
  output_payload jsonb,
  status text DEFAULT 'success'::text,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  scheduled_job_run_id uuid,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  provider text,
  CONSTRAINT generation_logs_pkey PRIMARY KEY (id),
  CONSTRAINT generation_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT generation_logs_persona_config_id_fkey FOREIGN KEY (persona_config_id) REFERENCES public.persona_configs(id),
  CONSTRAINT generation_logs_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.content_topics(id),
  CONSTRAINT generation_logs_scheduled_job_run_id_fkey FOREIGN KEY (scheduled_job_run_id) REFERENCES public.scheduled_job_runs(id)
);
CREATE TABLE public.reference_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  persona_config_id uuid,
  title text,
  content text NOT NULL,
  source_type text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT reference_notes_pkey PRIMARY KEY (id),
  CONSTRAINT reference_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT reference_notes_persona_config_id_fkey FOREIGN KEY (persona_config_id) REFERENCES public.persona_configs(id)
);
CREATE TABLE public.subscription_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  max_personas integer NOT NULL DEFAULT 1,
  monthly_ai_credits integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  daily_topic_generations integer NOT NULL DEFAULT 0,
  daily_content_generations integer NOT NULL DEFAULT 0,
  CONSTRAINT subscription_plans_pkey PRIMARY KEY (id)
);
CREATE TABLE public.user_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ends_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'paused'::text, 'cancelled'::text, 'expired'::text])),
  CONSTRAINT user_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT user_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id),
  CONSTRAINT user_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period_month date NOT NULL,
  ai_credits_used integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_usage_pkey PRIMARY KEY (id),
  CONSTRAINT user_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.topics2 (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  account text NOT NULL,
  category text NOT NULL,
  subcategory text NOT NULL,
  topic text NOT NULL,
  used_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT topics2_pkey PRIMARY KEY (id)
);
CREATE TABLE public.prompt_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  name text,
  template text NOT NULL,
  variables jsonb,
  is_global boolean DEFAULT false,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT prompt_templates_pkey PRIMARY KEY (id),
  CONSTRAINT prompt_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.ai_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  model text DEFAULT 'gpt-4o'::text,
  temperature numeric DEFAULT 0.7,
  max_tokens integer DEFAULT 1000,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT ai_settings_pkey PRIMARY KEY (id),
  CONSTRAINT ai_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.scheduled_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  persona_config_id uuid NOT NULL,
  schedule_type text,
  schedule_value text,
  status text DEFAULT 'active'::text,
  last_run_at timestamp without time zone,
  next_run_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  error_message text,
  job_type text NOT NULL DEFAULT 'generate_content_from_topics'::text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_count integer NOT NULL DEFAULT 10,
  schedule_timezone text DEFAULT 'Asia/Jakarta'::text,
  last_run_status text,
  last_run_generated_count integer NOT NULL DEFAULT 0,
  last_run_error text,
  CONSTRAINT scheduled_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT scheduled_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT scheduled_jobs_persona_config_id_fkey FOREIGN KEY (persona_config_id) REFERENCES public.persona_configs(id)
);
CREATE TABLE public.content_pillars (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  persona_config_id uuid NOT NULL,
  pillar_name text NOT NULL,
  template_content text,
  target_objective text,
  audience_segment text,
  key_message text,
  cta_direction text,
  affiliate_link text,
  ai_enhanced_version text,
  user_review_edit text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT content_pillars_pkey PRIMARY KEY (id),
  CONSTRAINT content_pillars_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT content_pillars_persona_config_id_fkey FOREIGN KEY (persona_config_id) REFERENCES public.persona_configs(id)
);
CREATE TABLE public.generation_topic_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  persona_config_id uuid NOT NULL,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  status text NOT NULL DEFAULT 'success'::text,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  topic_count integer DEFAULT 0,
  provider text,
  CONSTRAINT generation_topic_logs_pkey PRIMARY KEY (id),
  CONSTRAINT generation_topic_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT generation_topic_logs_persona_config_id_fkey FOREIGN KEY (persona_config_id) REFERENCES public.persona_configs(id)
);
CREATE TABLE public.scheduled_job_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  scheduled_job_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running'::text,
  target_count integer NOT NULL DEFAULT 10,
  fetched_count integer NOT NULL DEFAULT 0,
  processed_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  run_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb,
  error_message text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  finished_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_job_runs_pkey PRIMARY KEY (id),
  CONSTRAINT scheduled_job_runs_scheduled_job_id_fkey FOREIGN KEY (scheduled_job_id) REFERENCES public.scheduled_jobs(id),
  CONSTRAINT scheduled_job_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_daily_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  usage_date date NOT NULL,
  usage_key text NOT NULL CHECK (usage_key = ANY (ARRAY['generate_topic'::text, 'generate_content'::text])),
  request_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_daily_usage_pkey PRIMARY KEY (id),
  CONSTRAINT user_daily_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);