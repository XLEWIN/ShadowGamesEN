// Atomic host claim for a room code. Exactly one caller becomes the host.
import { db, eq } from 'sdk/db';
import { botState } from '../schema.js';

const KEY = (code) => `lobby:host:${code}`;
const TTL_MS = 2 * 60 * 1000;

export default async function (input = {}, ctx = {}) {
  const user = ctx?.initData?.user;
  if (!user) return { ok: false, error: 'Open from Telegram.' };
  const code = String(input.code || '').toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) return { ok: false, error: 'Invalid code.' };
  const key = KEY(code);
  const uid = Number(user.id);

  // Clear a stale claim, then claim with an atomic insert (first writer wins).
  const existing = await db.select().from(botState).where(eq(botState.key, key)).get();
  if (existing) {
    const when = existing.updatedAt instanceof Date ? existing.updatedAt.getTime() : Date.parse(existing.updatedAt || 0);
    if (Number.isFinite(when) && Date.now() - when > TTL_MS) {
      await db.delete(botState).where(eq(botState.key, key)).run();
    }
  }
  await db.insert(botState).values({
    key, value: { userId: uid }, updatedAt: new Date(),
  }).onConflictDoNothing().run();
  const claim = await db.select().from(botState).where(eq(botState.key, key)).get();
  return { ok: true, isHost: Number(claim?.value?.userId) === uid };
}
