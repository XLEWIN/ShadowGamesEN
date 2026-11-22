// Colored inline keyboards (Bot API 9.4+ button style) — port of colored.py
// IMPORTANT: `icon_custom_emoji_id` takes a RAW numeric premium emoji id (EID.*),
// never the HTML markup from E.*. Button text must not contain simple emoji.

import { EID } from './emojis.js';

export const btnPrimary = (text, data, iconEmojiId, style = 'primary') => ({
  text, callback_data: data, style,
  ...(iconEmojiId ? { icon_custom_emoji_id: iconEmojiId } : {}),
});
export const btnSuccess = (text, data, iconEmojiId, style = 'success') => ({
  text, callback_data: data, style,
  ...(iconEmojiId ? { icon_custom_emoji_id: iconEmojiId } : {}),
});
export const btnDanger = (text, data, iconEmojiId, style = 'danger') => ({
  text, callback_data: data, style,
  ...(iconEmojiId ? { icon_custom_emoji_id: iconEmojiId } : {}),
});
export const btnDefault = (text, data, iconEmojiId, style = 'primary') => ({
  text, callback_data: data, style,
  ...(iconEmojiId ? { icon_custom_emoji_id: iconEmojiId } : {}),
});
export const btnUrl = (text, url, iconEmojiId, style = 'primary') => ({
  text, url, style,
  ...(iconEmojiId ? { icon_custom_emoji_id: iconEmojiId } : {}),
});
export const btnWebApp = (text, url, iconEmojiId = EID.GAME, style = 'primary') => ({
  text, web_app: { url }, style,
  ...(iconEmojiId ? { icon_custom_emoji_id: iconEmojiId } : {}),
});
export const btnSwitchInline = (text, query = '', iconEmojiId = EID.GAME, style = 'primary') => ({
  text, switch_inline_query_current_chat: query, style,
  ...(iconEmojiId ? { icon_custom_emoji_id: iconEmojiId } : {}),
});
export const buildKeyboard = (rows) => ({ inline_keyboard: rows });

// UNO: the button that opens the inline sticker card menu.
export const unoChoiceKeyboard = () => buildKeyboard([
  [btnSwitchInline('Select your card', '', EID.GAME, 'primary')],
]);
export const unoSelectCardKeyboard = unoChoiceKeyboard;

// UNO lobby buttons — green join, blue start (exact parity with Python).
export const unoJoinKeyboard = () => buildKeyboard([
  [btnSuccess('Join the game', 'mm:join', EID.PLAY)],
]);
export const unoStartKeyboard = () => buildKeyboard([
  [btnPrimary('Start the game', 'mm:start', EID.GAME)],
]);
