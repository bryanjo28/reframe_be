const recordsByUser = new Map();

function recordsFor(userId) {
  if (!recordsByUser.has(userId)) recordsByUser.set(userId, []);
  return recordsByUser.get(userId);
}

function list(userId) { return [...recordsFor(userId)]; }
function get(userId, id) { return recordsFor(userId).find((record) => record.id === id) || null; }

function create(userId, payload) {
  const now = new Date().toISOString();
  const record = {
    id: `dev-persona-${Date.now()}`,
    userId,
    ...payload,
    isActive: payload.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  };
  recordsFor(userId).unshift(record);
  return record;
}

function update(userId, id, payload) {
  const records = recordsFor(userId);
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) return null;
  records[index] = { ...records[index], ...payload, updatedAt: new Date().toISOString() };
  return records[index];
}

function remove(userId, id) {
  const records = recordsFor(userId);
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) return null;
  return records.splice(index, 1)[0];
}

module.exports = { create, get, list, remove, update };
