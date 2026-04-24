const oauthStateMap = new Map();

function save(state, value) {
  oauthStateMap.set(state, value);
}

function consume(state) {
  const value = oauthStateMap.get(state);

  if (!value) {
    return null;
  }

  oauthStateMap.delete(state);
  return value;
}

module.exports = {
  save,
  consume,
};
