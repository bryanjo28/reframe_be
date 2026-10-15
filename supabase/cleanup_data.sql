begin;

create temporary table users_to_delete (
  id uuid primary key
) on commit drop;

insert into users_to_delete (id)
select id
from public.profiles
where role <> 'admin';

-- Konten dan relasi turunannya
delete from public.published_posts
where user_id in (select id from users_to_delete);

delete from public.generation_logs
where user_id in (select id from users_to_delete);

delete from public.content_outputs
where user_id in (select id from users_to_delete);

delete from public.social_account_credentials
where social_account_id in (
  select id
  from public.social_accounts
  where user_id in (select id from users_to_delete)
);

delete from public.social_accounts
where user_id in (select id from users_to_delete);

delete from public.generation_topic_logs
where user_id in (select id from users_to_delete);

delete from public.content_topics
where user_id in (select id from users_to_delete);

delete from public.scheduled_job_runs
where user_id in (select id from users_to_delete);

delete from public.scheduled_jobs
where user_id in (select id from users_to_delete);

delete from public.reference_notes
where user_id in (select id from users_to_delete);

delete from public.content_pillars
where user_id in (select id from users_to_delete);

delete from public.persona_configs
where user_id in (select id from users_to_delete);

-- Subscription, billing, dan penggunaan
delete from public.user_subscriptions
where user_id in (select id from users_to_delete);

delete from public.user_usage
where user_id in (select id from users_to_delete);

delete from public.user_daily_usage
where user_id in (select id from users_to_delete);

delete from public.payment_orders
where user_id in (select id from users_to_delete);

delete from public.token_ledger
where user_id in (select id from users_to_delete);

delete from public.token_wallets
where user_id in (select id from users_to_delete);

delete from public.credit_transactions
where user_id in (select id from users_to_delete);

delete from public.credit_lots
where user_id in (select id from users_to_delete);

delete from public.ai_credit_reservations
where user_id in (select id from users_to_delete);

delete from public.ai_usage_logs
where user_id in (select id from users_to_delete);

delete from public.user_notifications
where user_id in (select id from users_to_delete);

delete from public.prompt_templates
where user_id in (select id from users_to_delete);

delete from public.ai_settings
where user_id in (select id from users_to_delete);

-- Hapus profile dan akun Auth non-admin
delete from public.profiles
where id in (select id from users_to_delete);

delete from auth.users
where id in (select id from users_to_delete);

commit;