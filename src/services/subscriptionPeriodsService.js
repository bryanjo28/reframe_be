function storageError(error) {
  return Object.assign(new Error(error.message), { status: 503, code: 'SUBSCRIPTION_STORAGE_UNAVAILABLE' });
}

async function reconcileUserSubscriptionPeriods({ supabase, userId }) {
  // Read-only adapters used by legacy callers cannot invoke a database function.
  if (typeof supabase?.rpc !== 'function') return null;
  const { data, error } = await supabase.rpc('ensure_subscription_current', { p_user_id: userId });
  if (error) throw storageError(error);
  return data;
}

async function getSubscriptionTimeline({ supabase, userId }) {
  const [contracts, periods] = await Promise.all([
    supabase.from('subscription_contracts').select('*').eq('user_id', userId).order('starts_at'),
    supabase.from('subscription_periods').select('*').eq('user_id', userId).order('starts_at'),
  ]);
  if (contracts.error || periods.error) throw storageError(contracts.error || periods.error);
  const liveContracts = (contracts.data || []).filter(row => ['active', 'queued'].includes(row.status));
  return {
    contracts: contracts.data || [],
    active: (periods.data || []).find(row => row.status === 'active') || null,
    queued: liveContracts.filter(row => row.status === 'queued'),
    periods: (periods.data || []).filter(row => ['active', 'scheduled'].includes(row.status)),
    coverageEndsAt: liveContracts.at(-1)?.ends_at || null,
  };
}

module.exports = { reconcileUserSubscriptionPeriods, getSubscriptionTimeline };
