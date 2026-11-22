// Colored inline keyboards (Bot API 9.4+ button style) — port of colored.py

export const btnPrimary = (text, data, iconEmojiId) => ({
  text, callback_data: data, style: 'primary',
  ...(iconEmojiId ? { icon_custom_emoji_id: iconEmojiId } : {}),
});
export const btnSuccess = (text, data, iconEmojiId) => ({
  text, callback_data: data, style: 'success',
  ...(iconEmojiId ? { icon_custom_emoji_id: iconEmojiId } : {}),
});
export const btnDanger = (text, data, iconEmojiId) => ({
  text, callback_data: data, style: 'danger',
  ...(iconEmojiId ? { icon_custom_emoji_id: iconEmojiId } : {}),
});
export const btnDefault = (text, data, iconEmojiId) => ({
  text, callback_data: data,
  ...(iconEmojiId ? { icon_custom_emoji_id: iconEmojiId } : {}),
});
export const btnUrl = (text, url, iconEmojiId, style) => ({
  text, url,
  ...(style ? { style } : {}),
  ...(iconEmojiId ? { icon_custom_emoji_id: iconEmojiId } : {}),
});
export const btnWebApp = (text, url, iconEmojiId, style) => ({
  text, web_app: { url },
  ...(style ? { style } : {}),
  ...(iconEmojiId ? { icon_custom_emoji_id: iconEmojiId } : {}),
});
export const buildKeyboard = (rows) => ({ inline_keyboard: rows });
