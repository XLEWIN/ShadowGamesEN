// Inline "Shadow Games" challenge articles — available on every inline query.
import { E, EID } from './emojis.js';
import { mention } from './texts.js';
import { btnUrl, buildKeyboard } from './keyboards.js';
import { generateCode, startAppLink, TAGLINE } from './lobby.js';

export function inviteArticle(game, user, code = null) {
  code = code ? String(code).toUpperCase() : generateCode();
  const name = user.first_name || user.username || 'Player';
  return {
    type: 'article',
    id: `invite-${game}-${code}`,
    title: `Shadow Games · ${game.toUpperCase()}`,
    description: 'VS FRIEND challenge — open the table and invite players',
    input_message_content: {
      message_text:
        `${E.SPARKLE} <b>Shadow Games</b>\n\n` +
        `${E.ARROW} <b>VS FRIEND</b> challenge from ${mention(user.id, name)}\n\n` +
        `${E.INFO} ${TAGLINE}\n\n` +
        `${E.GAME} <b>${game.toUpperCase()}</b> · ${game === 'chess' ? '1v1' : '2–4 players'}`,
      parse_mode: 'HTML',
    },
    reply_markup: buildKeyboard([
      [
        btnUrl('Join the game', startAppLink(game, code), EID.PLAY, 'success'),
        btnUrl('Spectate', startAppLink(game, code, true), EID.WATCH, 'primary'),
      ],
    ]),
  };
}

export function inviteResults(user, code = null) {
  return [inviteArticle('chess', user, code), inviteArticle('ludo', user, code)];
}
