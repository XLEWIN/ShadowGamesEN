// Lightweight cross-isolate lock for serialized access to shared game state.
import { db, eq } from 'sdk/db';
import { botState } from '../schema.js';

const TTL_MS = 15_000;
const keyOf = (key) => `lock:${String(key).slice(0, 80)}`;

export async function tryLock(key) {
  const k = keyOf(key);
  const now = Date.now();
  const row = await db.select().from(botState).where(eq(botState.key, k)).get();
  const until = Number(row?.value?.until) || 0;
  if (until > now) return false;
  await db.insert(botState).values({
    key: k, value: { until: now + TTL_MS }, updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: botState.key,
    set: { value: { until: now + TTL_MS }, updatedAt: new Date() },
  }).run();
  return true;
}

export async function unlock(key) {
  await db.delete(botState).where(eq(botState.key, keyOf(key))).run();
}
