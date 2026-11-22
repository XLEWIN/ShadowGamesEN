import db, { eq, ne, gt, gte, lt, lte, and, or, isNull, isNotNull, inArray, like, asc, desc, sql } from 'sdk/db';
import { botState } from '../schema.js';

// ── KV helpers over bot_state ────────────────────────────────
export async function getState(key, fallback = null) {
  const row = await db.select().from(botState).where(eq(botState.key, key)).get();
  return row ? row.value : fallback;
}

export async function setState(key, value) {
  await db.insert(botState).values({ key, value }).onConflictDoUpdate({
    target: botState.key,
    set: { value, updatedAt: new Date() },
  }).run();
  return value;
}

export async function deleteState(key) {
  await db.delete(botState).where(eq(botState.key, key)).run();
}

// Re-export db operators for convenience
export { eq, ne, gt, gte, lt, lte, and, or, isNull, isNotNull, inArray, like, asc, desc, sql };
export { db };
export { botState };
