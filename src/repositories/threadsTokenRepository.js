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

async function deleteByThreadsUserId(threadsUserId) {
  for (let index = tokenStore.length - 1; index >= 0; index -= 1) {
    if (tokenStore[index].provider === "threads" && tokenStore[index].threadsUserId === threadsUserId) {
      tokenStore.splice(index, 1);
    }
  }
}

module.exports = {
  deleteByThreadsUserId,
  save,
};
