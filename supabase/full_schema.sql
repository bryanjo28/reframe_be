-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

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
CREATE TABLE public.content_outputs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  persona_config_id uuid NOT NULL,
  topic_id uuid,
  platform text DEFAULT 'threads'::text,
  format_output text,
  content text NOT NULL,
  status USER-DEFINED DEFAULT 'draft'::content_status,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  retry_count integer DEFAULT 0,
  content_pillar_id uuid,
  CONSTRAINT content_outputs_pkey PRIMARY KEY (id),
  CONSTRAINT content_outputs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT content_outputs_persona_config_id_fkey FOREIGN KEY (persona_config_id) REFERENCES public.persona_configs(id),
  CONSTRAINT content_outputs_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.content_topics(id),
  CONSTRAINT content_outputs_content_pillar_id_fkey FOREIGN KEY (content_pillar_id) REFERENCES public.content_pillars(id)
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
  CONSTRAINT generation_logs_pkey PRIMARY KEY (id),
  CONSTRAINT generation_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT generation_logs_persona_config_id_fkey FOREIGN KEY (persona_config_id) REFERENCES public.persona_configs(id),
  CONSTRAINT generation_logs_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.content_topics(id)
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
  posisi_persona_saat_ini text,
  audience_masalah_utama text,
  apa_yang_mereka_rasakan text,
  kenapa_harus_follow text,
  gaya_komunikasi text,
  platform text DEFAULT 'Threads'::text,
  format_output text,
  gaya_hook text,
  seberapa_personal text,
  cta_style text,
  is_active boolean NOT NULL DEFAULT true,
  content_pillar_prioritas text,
  referensi_gaya text,
  batasan_konten text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT persona_configs_pkey PRIMARY KEY (id),
  CONSTRAINT persona_configs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  account_name text NOT NULL UNIQUE,
  full_name text,
  created_at timestamp with time zone DEFAULT now(),
  role text NOT NULL DEFAULT 'user'::text CHECK (role = ANY (ARRAY['user'::text, 'admin'::text])),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
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
  CONSTRAINT published_posts_pkey PRIMARY KEY (id),
  CONSTRAINT published_posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT published_posts_social_account_id_fkey FOREIGN KEY (social_account_id) REFERENCES public.social_accounts(id),
  CONSTRAINT published_posts_content_output_id_fkey FOREIGN KEY (content_output_id) REFERENCES public.content_outputs(id)
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
CREATE TABLE public.scheduled_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  persona_config_id uuid NOT NULL,
  prompt_template_id uuid,
  schedule_type text,
  schedule_value text,
  status text DEFAULT 'active'::text,
  last_run_at timestamp without time zone,
  next_run_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  error_message text,
  CONSTRAINT scheduled_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT scheduled_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT scheduled_jobs_persona_config_id_fkey FOREIGN KEY (persona_config_id) REFERENCES public.persona_configs(id),
  CONSTRAINT scheduled_jobs_prompt_template_id_fkey FOREIGN KEY (prompt_template_id) REFERENCES public.prompt_templates(id)
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
  CONSTRAINT social_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT social_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.subscription_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  max_personas integer NOT NULL DEFAULT 1,
  monthly_ai_credits integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT subscription_plans_pkey PRIMARY KEY (id)
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
CREATE TABLE public.user_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active'::text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ends_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
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
