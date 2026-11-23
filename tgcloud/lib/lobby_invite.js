// Inline "Shadow Games" challenge articles — available on every inline query.
import { E } from './emojis.js';
import { mention } from './texts.js';
import { btnUrl, buildKeyboard } from './keyboards.js';
import { generateCode, startAppLink, TAGLINE, getLobby, isFull } from './lobby.js';
import { gameIcon } from './inline_cards.js';

export function inviteArticle(game, user, code = null, full = false) {
  code = code ? String(code).toUpperCase() : generateCode();
  const name = user.first_name || user.username || 'Player';
  const joinLabel = full ? 'Table full — Spectate' : 'Join the game';
  const joinUrl = full ? startAppLink(game, code, true) : startAppLink(game, code);
  return {
    type: 'article',
    id: `invite-${game}-${code}`,
    title: `Shadow Games · ${game.toUpperCase()}${full ? ' (Full)' : ''}`,
    description: full
      ? 'This table is full — tap to watch the match live'
      : 'VS FRIEND challenge — open the table and invite players',
    thumbnail_url: gameIcon(game),
    input_message_content: {
      message_text:
        `${E.SPARKLE} <b>Shadow Games</b>\n\n` +
        `${E.ARROW} <b>VS FRIEND</b> challenge from ${mention(user.id, name)}\n\n` +
        `${E.INFO} ${TAGLINE}\n\n` +
        `${E.GAME} <b>${game.toUpperCase()}</b> · ${game === 'chess' ? '1v1' : '2–4 players'}`,
      parse_mode: 'HTML',
    },
    reply_markup: full
      ? buildKeyboard([[btnUrl('Watch live', joinUrl, undefined, 'primary')]])
      : buildKeyboard([
          [
            btnUrl(joinLabel, joinUrl, undefined, 'success'),
            btnUrl('Spectate', startAppLink(game, code, true), undefined, 'primary'),
          ],
        ]),
  };
}

export async function inviteResults(user, code = null) {
  if (code) {
    const lobby = await getLobby(code);
    if (lobby) return [inviteArticle(lobby.game, user, lobby.code, isFull(lobby))];
  }
  return [inviteArticle('chess', user), inviteArticle('ludo', user)];
}
