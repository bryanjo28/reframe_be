const tokenStore = [];

async function save(payload) {
  const existingIndex = tokenStore.findIndex(
    (item) => item.userId === payload.userId && item.provider === payload.provider
  );

  const baseRecord = {
    id:
      existingIndex >= 0
        ? tokenStore[existingIndex].id
        : `threads_token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ...payload,
    updatedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    tokenStore[existingIndex] = {
      ...tokenStore[existingIndex],
      ...baseRecord,
    };

    return tokenStore[existingIndex];
  }

  const record = {
    ...baseRecord,
    createdAt: new Date().toISOString(),
  };

  tokenStore.push(record);
  return record;
}

module.exports = {
  save,
};
