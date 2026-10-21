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
  publish_scheduled_job_id uuid,
  publish_scheduled_job_run_id uuid,
  thread_type text NOT NULL DEFAULT 'short'::text CHECK (thread_type = ANY (ARRAY['short'::text, 'long'::text])),
  CONSTRAINT content_outputs_pkey PRIMARY KEY (id),
  CONSTRAINT content_outputs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT content_outputs_persona_config_id_fkey FOREIGN KEY (persona_config_id) REFERENCES public.persona_configs(id),
  CONSTRAINT content_outputs_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.content_topics(id),
  CONSTRAINT content_outputs_content_pillar_id_fkey FOREIGN KEY (content_pillar_id) REFERENCES public.content_pillars(id),
  CONSTRAINT content_outputs_scheduled_job_id_fkey FOREIGN KEY (scheduled_job_id) REFERENCES public.scheduled_jobs(id),
  CONSTRAINT content_outputs_scheduled_job_run_id_fkey FOREIGN KEY (scheduled_job_run_id) REFERENCES public.scheduled_job_runs(id),
  CONSTRAINT content_outputs_publish_scheduled_job_id_fkey FOREIGN KEY (publish_scheduled_job_id) REFERENCES public.scheduled_jobs(id),
  CONSTRAINT content_outputs_publish_scheduled_job_run_id_fkey FOREIGN KEY (publish_scheduled_job_run_id) REFERENCES public.scheduled_job_runs(id)
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
  sequence_number integer NOT NULL DEFAULT 1 CHECK (sequence_number >= 1),
  post_content text,
  creation_id text,
  publish_status text NOT NULL DEFAULT 'success'::text CHECK (publish_status = ANY (ARRAY['processing'::text, 'success'::text, 'failed'::text, 'uncertain'::text])),
  publish_error_message text,
  publish_started_at timestamp with time zone,
  publish_finished_at timestamp with time zone,
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
  price numeric NOT NULL DEFAULT 0,
  token_allowance bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'IDR'::text,
  content_pillars integer NOT NULL DEFAULT 1 CHECK (content_pillars >= 0),
  max_threads_accounts integer NOT NULL DEFAULT 1 CHECK (max_threads_accounts >= 0),
  can_schedule boolean NOT NULL DEFAULT true,
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
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  payment_reference text,
  subscription_period_id uuid,
  CONSTRAINT user_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT user_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id),
  CONSTRAINT user_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period_month date NOT NULL,
  total_tokens_used integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_usage_pkey PRIMARY KEY (id),
  CONSTRAINT user_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
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
  locked_at timestamp with time zone,
  lock_token uuid,
  heartbeat_at timestamp with time zone,
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
CREATE TABLE public.token_wallets (
  user_id uuid NOT NULL,
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT token_wallets_pkey PRIMARY KEY (user_id),
  CONSTRAINT token_wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.token_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount bigint NOT NULL CHECK (amount <> 0),
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  kind text NOT NULL CHECK (kind = ANY (ARRAY['plan_grant'::text, 'topup'::text, 'ai_usage'::text, 'adjustment'::text, 'refund'::text])),
  description text,
  reference_type text,
  reference_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT token_ledger_pkey PRIMARY KEY (id),
  CONSTRAINT token_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.token_packages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  token_amount bigint NOT NULL CHECK (token_amount > 0),
  price_idr bigint NOT NULL CHECK (price_idr >= 0),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT token_packages_pkey PRIMARY KEY (id)
);
CREATE TABLE public.payment_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  package_id uuid,
  amount_idr bigint NOT NULL CHECK (amount_idr >= 0),
  token_amount bigint NOT NULL CHECK (token_amount > 0),
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'cancelled'::text, 'refunded'::text])),
  provider text,
  provider_reference text,
  paid_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  credits integer,
  payment_reference text,
  order_type text,
  plan_id uuid,
  payment_method text,
  duration_months integer CHECK (duration_months IN (1,3,6,12)),
  monthly_price_idr bigint CHECK (monthly_price_idr > 0),
  monthly_credits integer CHECK (monthly_credits > 0),
  provider_expires_at timestamp with time zone,
  payment_qr_string text,
  payment_va_number text,
  cancelled_at timestamp with time zone,
  cancellation_reason text,
  CONSTRAINT payment_orders_pkey PRIMARY KEY (id),
  CONSTRAINT payment_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT payment_orders_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.token_packages(id)
);
CREATE TABLE public.subscription_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id),
  payment_order_id uuid NOT NULL UNIQUE REFERENCES public.payment_orders(id),
  provider_reference text NOT NULL,
  duration_months integer NOT NULL CHECK (duration_months IN (1,3,6,12)),
  monthly_price_idr bigint NOT NULL CHECK (monthly_price_idr > 0),
  monthly_credits integer NOT NULL CHECK (monthly_credits > 0),
  total_amount_idr bigint NOT NULL CHECK (total_amount_idr > 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','active','completed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.subscription_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.subscription_contracts(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id),
  sequence_number integer NOT NULL CHECK (sequence_number BETWEEN 1 AND 12),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  monthly_credits integer NOT NULL CHECK (monthly_credits > 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','completed','cancelled')),
  activated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, sequence_number)
);
ALTER TABLE public.user_subscriptions ADD CONSTRAINT user_subscriptions_period_fkey
  FOREIGN KEY (subscription_period_id) REFERENCES public.subscription_periods(id);
CREATE UNIQUE INDEX subscription_projection_period_unique ON public.user_subscriptions(subscription_period_id) WHERE subscription_period_id IS NOT NULL;
CREATE UNIQUE INDEX subscription_one_active_period ON public.subscription_periods(user_id) WHERE status='active';
CREATE INDEX subscription_due_periods ON public.subscription_periods(status,starts_at,ends_at);
CREATE INDEX subscription_user_contracts ON public.subscription_contracts(user_id,ends_at);
CREATE INDEX payment_due_expiry ON public.payment_orders(provider_expires_at) WHERE status='pending' AND provider='pakasir';
CREATE TABLE public.user_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  read_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_notifications_pkey PRIMARY KEY (id),
  CONSTRAINT user_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.social_account_credentials (
  social_account_id uuid NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT social_account_credentials_pkey PRIMARY KEY (social_account_id),
  CONSTRAINT social_account_credentials_social_account_id_fkey FOREIGN KEY (social_account_id) REFERENCES public.social_accounts(id)
);
CREATE TABLE public.credit_lots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  credit_type text NOT NULL CHECK (credit_type = ANY (ARRAY['free'::text, 'subscription'::text, 'topup'::text])),
  original_credits integer NOT NULL CHECK (original_credits > 0),
  remaining_credits integer NOT NULL,
  reserved_credits integer NOT NULL DEFAULT 0,
  expires_at timestamp with time zone,
  source_reference text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT credit_lots_pkey PRIMARY KEY (id),
  CONSTRAINT credit_lots_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.credit_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  transaction_type text NOT NULL,
  credits_delta integer NOT NULL,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  source_type text NOT NULL,
  source_id text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT credit_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT credit_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.ai_credit_reservations (
  request_id text NOT NULL,
  user_id uuid NOT NULL,
  feature text NOT NULL,
  reserved_credits integer NOT NULL CHECK (reserved_credits > 0),
  status text NOT NULL DEFAULT 'reserved'::text CHECK (status = ANY (ARRAY['reserved'::text, 'settled'::text, 'released'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  settled_at timestamp with time zone,
  CONSTRAINT ai_credit_reservations_pkey PRIMARY KEY (request_id),
  CONSTRAINT ai_credit_reservations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.ai_usage_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  request_id text NOT NULL UNIQUE,
  feature text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  cached_input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_idr numeric NOT NULL DEFAULT 0,
  actual_cost_usd numeric NOT NULL DEFAULT 0,
  credits_charged integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_logs_pkey PRIMARY KEY (id),
  CONSTRAINT ai_usage_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.admin_audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  previous_values jsonb,
  new_values jsonb,
  reason text,
  result_status text NOT NULL DEFAULT 'success'::text CHECK (result_status = ANY (ARRAY['success'::text, 'failure'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT admin_audit_logs_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.admin_error_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  user_id uuid,
  method text NOT NULL,
  path text NOT NULL,
  status_code integer NOT NULL CHECK (status_code >= 500 AND status_code <= 599),
  error_code text NOT NULL,
  error_name text NOT NULL,
  message text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT admin_error_logs_pkey PRIMARY KEY (id)
);
