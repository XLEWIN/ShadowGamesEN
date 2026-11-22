// Graceful Rich Message fallback ladder: rich (styled) → rich (unstyled) → HTML.
// Port of shadow_game_bot/richsend.py

import { sendRich, editRich, hasStyledButtons, unstyle, validate } from './rich.js';

export const RICH_ENABLED = true;

export function buildBlocks(fn, ...args) {
  if (!RICH_ENABLED) return null;
  try {
    const blocks = fn(...args);
    validate(blocks);
    return blocks;
  } catch (e) {
    console.warn('rich build failed — falling back to HTML:', e?.message || e);
    return null;
  }
}

function attempts(blocks) {
  const list = [...blocks];
  return hasStyledButtons(list) ? [list, unstyle(list)] : [list];
}

export async function sendWithFallback(chatId, blocks, { richMarkup, fallback } = {}) {
  if (blocks) {
    for (const attempt of attempts(blocks)) {
      try {
        return await sendRich(chatId, attempt, { reply_markup: richMarkup });
      } catch (e) {
        console.debug('rich send rejected — next attempt:', e?.description || e?.message || e);
      }
    }
  }
  return await fallback();
}

export async function editWithFallback(chatId, messageId, blocks, { richMarkup, fallback } = {}) {
  if (blocks) {
    for (const attempt of attempts(blocks)) {
      try {
        await editRich(chatId, messageId, attempt, { reply_markup: richMarkup });
        return true;
      } catch (e) {
        console.debug('rich edit rejected — next attempt:', e?.description || e?.message || e);
      }
    }
  }
  return await fallback();
}
