// ── pipeline.js — error cards + cross-isolate update dedup ─────

import { api } from 'sdk';
import { db, eq } from 'sdk/db';
import { botState } from '../schema.js';

let _config = { api: null, chatId: null };

export function configurePipeline({ api: a, chatId }) {
  _config.api = a;
  _config.chatId = chatId;
}

// Cross-isolate dedup: the same update_id must never be processed twice.
// A DB unique key is the lock, so concurrent isolates cannot both claim it.
export async function isRetryUpdate(ctx) {
  const uid = Number(ctx?.update?.update_id);
  if (!Number.isSafeInteger(uid)) return false; // no id — don't block the update
  const key = `upd:${uid}`;
  const seen = await db.select().from(botState).where(eq(botState.key, key)).get();
  if (seen) return true;
  await db.insert(botState).values({
    key, value: { seenAt: new Date().toISOString() }, updatedAt: new Date(),
  }).onConflictDoNothing().run();
  return false;
}

export async function reportHandlerError(err, { where = 'handler', update } = {}) {
  console.error(`[${where}]`, err?.message || err, err?.stack || '');
  if (!_config.chatId) return;
  try {
    const text = `⚠️ Handler error in ${where}\n${err?.name || 'Error'}: ${String(err?.message || err).slice(0, 400)}`;
    await _config.api.sendMessage({ chat_id: _config.chatId, text, parse_mode: 'HTML' });
  } catch (e) {
    console.error('reportHandlerError send failed:', e?.description || e);
  }
}
