const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261020030000_referral_program.sql'), 'utf8');
const signupTrigger = migration.split('create or replace function public.initialize_referral_attribution()')[1]
  .split('drop trigger if exists initialize_referral_attribution_trigger')[0];
const paymentTrigger = migration.split('create or replace function public.capture_first_referral_subscription()')[1]
  .split('drop trigger if exists capture_first_referral_subscription_trigger')[0];
const rewardProcessor = migration.split('create or replace function public.process_due_referral_rewards')[1];

assert.doesNotMatch(signupTrigger, /credit_lots|referral_credit_grants|referral_reward/i, 'registration must not grant any credits');
assert.match(paymentTrigger, /new\.status is distinct from 'paid'/i, 'reward qualification requires a verified paid state');
assert.match(paymentTrigger, /new\.order_type is distinct from 'subscription'/i, 'top-ups cannot qualify for referral rewards');
assert.match(paymentTrigger, /p\.status='paid'.*p\.id<>new\.id/i, 'an earlier paid subscription blocks a second reward');
assert.match(rewardProcessor, /validation_due_at<=now\(\)/i, 'credits wait until the validation period ends');
assert.match(rewardProcessor, /where id=v_reward\.payment_order_id and status='paid'/i, 'payment must still be paid at reward release');
assert.match(rewardProcessor, /'referral'/i, 'released bonus credits are tracked as referral credits');
console.log('Referral migration rule tests passed');
