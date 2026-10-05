// In-memory session store. Fine for a demo; a real deployment would use Redis or similar.
const crypto = require('crypto');
const TTL_MS = 30 * 60 * 1000; // 30 minutes

const sessions = new Map();

function create(data) {
  const id = crypto.randomUUID();
  sessions.set(id, { ...data, createdAt: Date.now(), expiresAt: Date.now() + TTL_MS });
  return id;
}

function get(id) {
  const s = sessions.get(id);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(id);
    return null;
  }
  return s;
}

function update(id, patch) {
  const s = get(id);
  if (!s) return null;
  Object.assign(s, patch);
  return s;
}

function remove(id) {
  sessions.delete(id);
}

// Periodic cleanup of expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now > s.expiresAt) sessions.delete(id);
}, 60 * 1000).unref();

module.exports = { create, get, update, remove };