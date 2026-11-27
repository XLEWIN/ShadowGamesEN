// Inline "Shadow Games" challenges. The posted message ends with the board
// URL, so Telegram renders a clickable link-preview image between the text and
// the inline buttons — the image itself is the hyperlink.
import { mention, previewUrl } from './texts.js';
import { btnUrl, buildKeyboard } from './keyboards.js';
import { generateCode, startAppLink, getLobby, isFull, TAGLINE } from './lobby.js';
import { gameIcon } from './inline_cards.js';

export function inviteArticle(game, user, code = null, full = false) {
  code = code ? String(code).toUpperCase() : generateCode();
  const name = user.first_name || user.username || 'Player';
  const joinLabel = full ? 'Table full — Spectate' : 'Join the game';
  const joinUrl = full ? startAppLink(game, code, true) : startAppLink(game, code);
  const messageText =
    `<b>Shadow Games</b>\n\n` +
    `<b>VS FRIEND</b> challenge from ${mention(user.id, name)}\n\n` +
    `${TAGLINE}\n\n` +
    `<b>${game.toUpperCase()}</b> · ${game === 'chess' ? '1v1' : '2–4 players'}\n` +
    `<b>${game === 'chess' ? '1st sets the clock · 2nd starts the game' : 'Open the board and invite your friends'}</b>`;
  return {
    type: 'article',
    id: `invite-${game}-${code}`,
    title: `Shadow Games · ${game.toUpperCase()}${full ? ' (Full)' : ''}`,
    description: full
      ? 'This game is full — tap to watch live'
      : game === 'chess'
        ? 'First player sets the clock · second player starts the game'
        : 'VS FRIEND challenge — open the table and invite players',
    thumbnail_url: gameIcon(game),
    input_message_content: {
      message_text: messageText,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: false, url: previewUrl(game, code) },
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
