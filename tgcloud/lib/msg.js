// ── Centralized send layer (msg.js) ──────────────────────────
// Route ALL outbound Telegram API calls through this module.

import { api } from 'sdk';

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function stripNulls(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function normalizeEditMarkup(markup) {
  if (markup === null || markup === undefined) return { inline_keyboard: [] };
  return markup;
}

export async function replyText(message, text, opts = {}) {
  const { parseMode, replyMarkup, quote, replyToMessageId, ...rest } = opts;
  const chatId = message?.chat?.id;
  const params = stripNulls({ chat_id: chatId, text, parse_mode: parseMode, ...rest });
  if (replyMarkup !== undefined) params.reply_markup = replyMarkup;
  if (replyToMessageId) params.reply_to_message_id = replyToMessageId;
  try {
    return await api.sendMessage(params);
  } catch (e) {
    console.error('replyText failed:', e?.description || e);
    return null;
  }
}

export async function sendText(chatId, text, opts = {}) {
  const { parseMode, replyMarkup, ...rest } = opts;
  const params = stripNulls({ chat_id: chatId, text, parse_mode: parseMode, ...rest });
  if (replyMarkup !== undefined) params.reply_markup = replyMarkup;
  try {
    return await api.sendMessage(params);
  } catch (e) {
    console.error('sendText failed:', e?.description || e);
    return null;
  }
}

export async function replyPhoto(message, photo, caption, opts = {}) {
  const { parseMode, replyMarkup, quote, replyToMessageId, ...rest } = opts;
  const chatId = message?.chat?.id;
  const params = stripNulls({ chat_id: chatId, photo, caption, parse_mode: parseMode, ...rest });
  if (replyMarkup !== undefined) params.reply_markup = replyMarkup;
  if (replyToMessageId) params.reply_to_message_id = replyToMessageId;
  try {
    return await api.sendPhoto(params);
  } catch (e) {
    console.error('replyPhoto failed:', e?.description || e);
    return null;
  }
}

export async function sendPhoto(chatId, photo, caption, opts = {}) {
  const { parseMode, replyMarkup, ...rest } = opts;
  const params = stripNulls({ chat_id: chatId, photo, caption, parse_mode: parseMode, ...rest });
  if (replyMarkup !== undefined) params.reply_markup = replyMarkup;
  try {
    return await api.sendPhoto(params);
  } catch (e) {
    console.error('sendPhoto failed:', e?.description || e);
    return null;
  }
}

export async function editCaption(chatId, messageId, caption, opts = {}) {
  const { parseMode, replyMarkup, ...rest } = opts;
  const params = stripNulls({ chat_id: chatId, message_id: messageId, caption, parse_mode: parseMode, ...rest });
  params.reply_markup = normalizeEditMarkup(replyMarkup);
  try {
    return await api.editMessageCaption(params);
  } catch (e) {
    console.error('editCaption failed:', e?.description || e);
    return null;
  }
}

export async function editText(chatId, messageId, text, opts = {}) {
  const { parseMode, replyMarkup, ...rest } = opts;
  const params = stripNulls({ chat_id: chatId, message_id: messageId, text, parse_mode: parseMode, ...rest });
  params.reply_markup = normalizeEditMarkup(replyMarkup);
  try {
    return await api.editMessageText(params);
  } catch (e) {
    if (e?.description?.includes('message is not modified')) return null;
    console.error('editText failed:', e?.description || e);
    return null;
  }
}

export async function answerCallbackQuery(callbackQueryId, text, opts = {}) {
  const { showAlert, url, ...rest } = opts;
  try {
    return await api.answerCallbackQuery(stripNulls({
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert,
      url,
      ...rest,
    }));
  } catch (e) {
    console.error('answerCallbackQuery failed:', e?.description || e);
    return null;
  }
}

export async function deleteMessage(chatId, messageId) {
  try {
    return await api.deleteMessage({ chat_id: chatId, message_id: messageId });
  } catch (e) {
    console.error('deleteMessage failed:', e?.description || e);
    return null;
  }
}
