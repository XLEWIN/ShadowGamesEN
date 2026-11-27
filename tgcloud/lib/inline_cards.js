// Shared inline-result cards for Shadow Games, Ludo and Chess.
// The posted text has no visible URL — Telegram shows a clickable board
// preview supplied explicitly via link_preview_options, and the button opens
// the Mini App inside Telegram.

import { EID } from './emojis.js';
import { btnWebApp, buildKeyboard } from './keyboards.js';
import { HUB_URL, LUDO_URL, CHESS_URL, previewUrl } from './texts.js';

export const ICONS = {
  hub: `${HUB_URL}assets/hub-icon.png`,
  ludo: `${LUDO_URL}assets/icon.webp`,
  chess: `${CHESS_URL}assets/icon.webp`,
};

export function gameArticle(id, title, description, webAppUrl, label, iconUrl, preview = null) {
  return {
    type: 'article', id, title, description,
    thumbnail_url: iconUrl,
    input_message_content: {
      message_text: `<b>${title}</b>\n\nOpen the table and play with friends.`,
      parse_mode: 'HTML',
      ...(preview ? { link_preview_options: { is_disabled: false, url: preview } } : {}),
    },
    reply_markup: buildKeyboard([[{
      text: label, web_app: { url: webAppUrl }, style: 'primary', icon_custom_emoji_id: EID.GAME,
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
