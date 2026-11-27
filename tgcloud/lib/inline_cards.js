// Shared inline-result cards for Shadow Games, Ludo and Chess.
// Inline results must use URL buttons — `web_app` buttons are rejected by the
// Bot API for inline messages posted outside private chats (BUTTON_TYPE_INVALID).
// t.me startapp links still open the Mini App inside Telegram.

import { EID } from './emojis.js';
import { btnUrl, buildKeyboard } from './keyboards.js';
import { HUB_URL, LUDO_URL, CHESS_URL, BOT_USERNAME, previewUrl } from './texts.js';

export const ICONS = {
  hub: `${HUB_URL}assets/hub-icon.png`,
  ludo: `${LUDO_URL}assets/icon.webp`,
  chess: `${CHESS_URL}assets/icon.webp`,
};

const startApp = (game) => `https://t.me/${BOT_USERNAME}?startapp=${game}-${game === 'ludo' ? 'LUDO1' : 'CHESS'}`;

export function gameArticle(id, title, description, url, label, iconUrl, preview = null) {
  return {
    type: 'article', id, title, description,
    thumbnail_url: iconUrl,
    input_message_content: {
      message_text: `<b>${title}</b>\n\nOpen the table and play with friends.`,
      parse_mode: 'HTML',
      ...(preview ? { link_preview_options: { is_disabled: false, url: preview } } : {}),
    },
    reply_markup: buildKeyboard([[{
      text: label,
      url: id === 'hub' ? url : startApp(id === 'open-ludo' ? 'ludo' : 'chess'),
      style: 'primary', icon_custom_emoji_id: EID.GAME,
    }]]),
  };
}

export function hubArticles() {
  return [
    gameArticle('hub', 'Shadow Games', 'All games in one place', HUB_URL, 'Open Games Hub', ICONS.hub),
    gameArticle('open-ludo', 'Shadow Games · Ludo', 'Play vs AI or online rooms', LUDO_URL, 'Open Ludo', ICONS.ludo, previewUrl('ludo')),
    gameArticle('open-chess', 'Shadow Games · Chess', 'Real rules, online rooms', CHESS_URL, 'Open Chess', ICONS.chess, previewUrl('chess')),
  ];
}

export function gameIcon(game) {
  return game === 'ludo' ? ICONS.ludo : ICONS.chess;
}
