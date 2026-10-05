// Per-browser persistence for found markers and UI preferences.
// localStorage can be missing or throw (private mode, blocked storage), so every
// access is guarded and the app keeps working with in-memory state.

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: progress simply won't survive a reload.
  }
}

export function createProgress(gameId) {
  const key = `game-maps:${gameId}:found`;
  const found = new Set(read(key, []));
  const save = () => write(key, [...found]);

  return {
    has: (id) => found.has(id),
    set(id, isFound) {
      if (isFound) found.add(id);
      else found.delete(id);
      save();
    },
    clear(ids) {
      for (const id of ids) found.delete(id);
      save();
    },
  };
}

export function createPrefs(gameId, defaults) {
  const key = `game-maps:${gameId}:prefs`;
  const prefs = { ...defaults, ...read(key, {}) };

  return {
    get: (name) => prefs[name],
    set(name, value) {
      prefs[name] = value;
      write(key, prefs);
    },
  };
}
