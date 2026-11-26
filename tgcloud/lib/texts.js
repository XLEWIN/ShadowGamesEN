// Exact text constants from Python texts.py + command texts (E.* = premium emoji HTML).
import { E } from './emojis.js';

export const URL_ADD_TO_GROUP = (username) => `https://t.me/${username}?startgroup=true`;
export const URL_OWNER = 'https://t.me/NonchalantDev';
export const URL_UPDATES = 'https://t.me/ShadowBotsHQ';
export const URL_DISCUSSION = 'https://t.me/GamesComplex';

export const BOT_DESCRIPTION =
  'Bring the fun to your group with <b>5 exciting games!</b>\n\n' +
  `${E.GAME} <b>Word Guess</b> • ${E.TROPHY} <b>WordSeek</b> • ${E.SPARKLE} <b>UNO</b>\n` +
  `${E.CROWN} <b>Chess</b> • ${E.PLAY} <b>Ludo</b>\n\n` +
  'Challenge your friends, compete and enjoy!\n\n' +
  `${E.ADD} Add me to your group and start playing.`;

export const BOT_DESCRIPTION_PLAIN =
  'Bring the fun to your group with 5 exciting games!\n\n' +
  'Word Guess • WordSeek • UNO\nChess • Ludo\n\n' +
  'Challenge your friends, compete and enjoy!\n\n' +
  'Add me to your group and start playing.';

export const START_TITLE_LINE = (fire, username) => `${fire} <b>${username}</b>`;
export const START_HINT_LINE = (arrow) => `${arrow} /help for all commands.`;
export const START_TEXT = (fire, username, description, arrow) =>
  START_TITLE_LINE(fire, username) + '\n' + description + '\n\n' + START_HINT_LINE(arrow);
export const START_TEXT_PLAIN = (username, descriptionPlain) =>
  `🔥 ${username}\n${descriptionPlain}\n\n✈️ /help for the full command list.`;

export const BOT_USERNAME = 'ShadowGameEnBot';
export const OWNER_ID = 8953843780;
export const LOG_CHANNEL_ID = -1003884436085;
// Mini Apps are served by tgcloud static hosting — no GitHub identity in URLs.
export const WEBAPP_BASE = 'https://app8670418995.tgcloud.ai/';
export const LEADERBOARD_IMAGE = `${WEBAPP_BASE}assets/leaderboard-banner.jpg`;
export const START_IMAGE = `${WEBAPP_BASE}assets/gaming-hub.jpg`;
export const HUB_URL = WEBAPP_BASE;
export const LUDO_URL = `${WEBAPP_BASE}ludo/`;
export const CHESS_URL = `${WEBAPP_BASE}chess/`;

export const RULES = `${E.INFO} <b>Game Rules</b>\n${E.BULLET}\n\n` +
  `<b>Word Guess</b> — one player explains the secret word, the others guess it.\n` +
  `<b>WordSeek</b> — guess the hidden word in 30 tries with color hints.\n` +
  `<b>UNO</b> — the classic card game with inline cards and fast mode.\n\n` +
  `Add me to a group and start playing!`;

export function startText() { return START_TEXT(E.FIRE, `@${BOT_USERNAME}`, BOT_DESCRIPTION, E.ARROW); }
export function startPlain() { return START_TEXT_PLAIN(`@${BOT_USERNAME}`, BOT_DESCRIPTION_PLAIN); }

export const HELP_TEXT = `${E.INFO} <b>Shadow Games — Commands</b>\n${E.BULLET}\n\n` +
  `<b>🎮 Games</b>\n` +
  `<code>/game</code> Word Guess · <code>/new</code> WordSeek · <code>/newuno</code> UNO\n` +
  `<code>/ludo</code> Ludo · <code>/chess</code> Chess · <code>/games</code> All games\n\n` +
  `<b>🟩 WordSeek</b>\n` +
  `<code>/new4 /new5 /new6</code> game · <code>/end</code> end · <code>/daily</code> daily\n` +
  `<code>/leaderboard</code> scores · <code>/score</code> your score\n\n` +
  `<b>🎴 UNO</b>\n` +
  `<code>/newuno</code> create · <code>/join</code> join · <code>/startuno</code> deal\n` +
  `<code>/modes</code> modes · <code>/unostats</code> stats\n\n` +
  `<b>🔧 Other</b>\n` +
  `<code>/help</code> this menu · <code>/rules</code> rules · <code>/id</code> info`;

export function mention(id, name) {
  const safe = String(name || 'Player').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  return `<a href="tg://user?id=${id}">${safe}</a>`;
}
