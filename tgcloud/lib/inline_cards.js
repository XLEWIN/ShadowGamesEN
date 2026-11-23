// Shared inline-result cards for Shadow Games, Ludo and Chess.
// Uses the real game icons hosted on the Mini App — no legacy emoji cards.

import { E, EID } from './emojis.js';
import { btnUrl, buildKeyboard } from './keyboards.js';
import { HUB_URL, LUDO_URL, CHESS_URL } from './texts.js';

export const ICONS = {
  hub: `${HUB_URL}assets/hub-icon.png`,
  ludo: `${LUDO_URL}assets/icon.webp`,
  chess: `${CHESS_URL}assets/icon.webp`,
};

export function gameArticle(id, title, description, url, label, iconUrl) {
  return {
    type: 'article', id, title, description,
    thumbnail_url: iconUrl,
    input_message_content: {
      message_text:
        `${E.SPARKLE} <b>${title}</b>\n\n` +
        `${E.GAME} Open the table and play with friends.\n` +
        `${E.INFO} Powered by @ShadowGameEnBot`,
      parse_mode: 'HTML',
    },
    reply_markup: buildKeyboard([[{
      text: label, url, style: 'primary', icon_custom_emoji_id: EID.GAME,
    }]]),
  };
}

export function hubArticles() {
  return [
    gameArticle('hub', 'Shadow Games', 'All games in one place', HUB_URL, 'Open Games Hub', ICONS.hub),
    gameArticle('open-ludo', 'Shadow Games · Ludo', 'Play vs AI or online rooms', LUDO_URL, 'Open Ludo', ICONS.ludo),
    gameArticle('open-chess', 'Shadow Games · Chess', 'Real rules, online rooms', CHESS_URL, 'Open Chess', ICONS.chess),
  ];
}

export function gameIcon(game) {
  return game === 'ludo' ? ICONS.ludo : ICONS.chess;
}
