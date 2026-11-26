// Per-user / per-chat throttling backed by bot_state (survives isolate restarts).
import { getState, setState } from './db.js';

export async function throttle(scope, userId, { limit = 6, windowMs = 10_000 } = {}) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id)) return false; // fail closed on bad identity
  const key = `rl:${String(scope).slice(0, 32)}:${id}`;
  const now = Date.now();
  const stored = await getState(key);
  const recent = Array.isArray(stored?.ts) ? stored.ts.filter(t => Number.isFinite(t) && now - t < windowMs) : [];
  if (recent.length >= limit) {
    await setState(key, { ts: recent });
    return false;
  }
  recent.push(now);
  await setState(key, { ts: recent });
  return true;
}

export async function throttleCommand(userId) {
  return throttle('cmd', userId, { limit: 8, windowMs: 10_000 });
}

export async function throttleCallback(userId) {
  return throttle('cb', userId, { limit: 15, windowMs: 10_000 });
}
