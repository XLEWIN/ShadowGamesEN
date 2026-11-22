// ── pipeline.js — error cards + update dedup ─────────────────

import { api } from 'sdk';

let _config = { api: null, chatId: null };

export function configurePipeline({ api: a, chatId }) {
  _config.api = a;
  _config.chatId = chatId;
}

// Dedup by update_id (in-memory per isolate; for cross-isolate use bot_state)
const _seen = new Set();
const _seenCap = 2000;

export function isRetryUpdate(ctx) {
  const uid = ctx?.update?.update_id;
  if (!uid) return false;
  if (_seen.has(uid)) return true;
  if (_seen.size >= _seenCap) {
    // evict oldest (best-effort)
    const first = _seen.values().next().value;
    _seen.delete(first);
  }
  _seen.add(uid);
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
