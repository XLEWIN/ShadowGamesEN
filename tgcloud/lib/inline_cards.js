// Shared inline-result cards for Shadow Games, Ludo and Chess.
// Uses the real game icons hosted on the Mini App — no legacy emoji cards.

import { EID } from './emojis.js';
import { btnUrl, buildKeyboard } from './keyboards.js';
import { HUB_URL, LUDO_URL, CHESS_URL, challengeImage } from './texts.js';

export const ICONS = {
  hub: `${HUB_URL}assets/hub-icon.png`,
  ludo: `${LUDO_URL}assets/icon.webp`,
  chess: `${CHESS_URL}assets/icon.webp`,
};

export function gameArticle(id, title, description, url, label, iconUrl, photoUrl = null) {
  const markup = buildKeyboard([[{
    text: label, url, style: 'primary', icon_custom_emoji_id: EID.GAME,
  }]]);
  if (photoUrl) {
    return {
      type: 'photo', id, title, description,
      photo_url: photoUrl, thumb_url: iconUrl,
      // Custom emoji entities are stripped from inline-posted messages, so
      // keep the caption free of plain-emoji fallbacks.
      caption: `<b>${title}</b>\n\nOpen the board and play with friends.\n<a href="${url}">Open ${title.includes('Ludo') ? 'LUDO' : 'CHESS'} board</a>`,
      parse_mode: 'HTML',
      reply_markup: markup,
    };
  }
  return {
    type: 'article', id, title, description,
    thumbnail_url: iconUrl,
    input_message_content: {
      message_text: `<b>${title}</b>\n\nOpen the table and play with friends.\nPowered by @ShadowGameEnBot`,
      parse_mode: 'HTML',
    },
    reply_markup: markup,
  };
}

export function hubArticles() {
  return [
    gameArticle('hub', 'Shadow Games', 'All games in one place', HUB_URL, 'Open Games Hub', ICONS.hub),
    gameArticle('open-ludo', 'Shadow Games · Ludo', 'Play vs AI or online rooms', LUDO_URL, 'Open Ludo', ICONS.ludo, challengeImage('ludo')),
    gameArticle('open-chess', 'Shadow Games · Chess', 'Real rules, online rooms', CHESS_URL, 'Open Chess', ICONS.chess, challengeImage('chess')),
  ];
}

export function gameIcon(game) {
  return game === 'ludo' ? ICONS.ludo : ICONS.chess;
}
