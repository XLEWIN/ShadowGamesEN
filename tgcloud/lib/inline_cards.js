// Shared inline-result cards for Shadow Games, Ludo and Chess.
// The posted text ends with the board URL so Telegram shows a clickable
// link-preview image between the text and the inline buttons.

import { EID } from './emojis.js';
import { btnUrl, buildKeyboard } from './keyboards.js';
import { HUB_URL, LUDO_URL, CHESS_URL, gameBoardUrl } from './texts.js';

export const ICONS = {
  hub: `${HUB_URL}assets/hub-icon.png`,
  ludo: `${LUDO_URL}assets/icon.webp`,
  chess: `${CHESS_URL}assets/icon.webp`,
};

export function gameArticle(id, title, description, url, label, iconUrl, boardUrl = null) {
  const messageText =
    `<b>${title}</b>\n\n` +
    `Open the table and play with friends.\n\n` +
    (boardUrl || url);
  return {
    type: 'article', id, title, description,
    thumbnail_url: iconUrl,
    input_message_content: {
      // Custom emoji entities are stripped from inline-posted messages, so
      // keep this text free of plain-emoji fallbacks.
      message_text: messageText,
      parse_mode: 'HTML',
      ...(boardUrl ? { link_preview_options: { is_disabled: false } } : {}),
    },
    reply_markup: buildKeyboard([[{
      text: label, url, style: 'primary', icon_custom_emoji_id: EID.GAME,
    }]]),
  };
}

export function hubArticles() {
  return [
    gameArticle('hub', 'Shadow Games', 'All games in one place', HUB_URL, 'Open Games Hub', ICONS.hub),
    gameArticle('open-ludo', 'Shadow Games · Ludo', 'Play vs AI or online rooms', LUDO_URL, 'Open Ludo', ICONS.ludo, gameBoardUrl('ludo')),
    gameArticle('open-chess', 'Shadow Games · Chess', 'Real rules, online rooms', CHESS_URL, 'Open Chess', ICONS.chess, gameBoardUrl('chess')),
  ];
}

export function gameIcon(game) {
  return game === 'ludo' ? ICONS.ludo : ICONS.chess;
}
