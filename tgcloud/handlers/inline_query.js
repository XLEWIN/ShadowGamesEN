import { api } from 'sdk';
import { configurePipeline, reportHandlerError, isRetryUpdate } from '../lib/pipeline.js';
import { escapeHtml } from '../lib/msg.js';

const LOG_CHANNEL_ID = -1003884436085;
configurePipeline({ api, chatId: LOG_CHANNEL_ID });

const HUB_URL = 'https://xlewin.github.io/ShadowGamesEN/webapp/';
const LUDO_URL = 'https://xlewin.github.io/ShadowGamesEN/webapp/ludo/';
const CHESS_URL = 'https://xlewin.github.io/ShadowGamesEN/webapp/chess/';

export default async function (query, ctx) {
  if (isRetryUpdate(ctx)) return;
  try {
    const text = (query.query || '').trim().toLowerCase();
    const codeMatch = text.match(/\b([a-z0-9]{5})\b/);
    const code = codeMatch ? codeMatch[1].toUpperCase() : null;

    let game = null;
    if (text.startsWith('ludo')) game = 'ludo';
    else if (text.startsWith('chess')) game = 'chess';
    else if (text.startsWith('game')) game = 'games';

    const results = [];

    if (code && (game === 'ludo' || game === 'chess')) {
      const base = game === 'ludo' ? LUDO_URL : CHESS_URL;
      const name = game === 'ludo' ? 'Ludo' : 'Chess';
      results.push({
        type: 'article',
        id: `invite-${game}-${code}`,
        title: `Join ${name} room ${code}`,
        description: 'Opens Shadow Games and joins the room automatically.',
        input_message_content: {
          message_text: `🎲 <b>Shadow Games</b> — join my ${name} room <b>${code}</b>!\n\nTap the button to open the game and jump into the room.`,
          parse_mode: 'HTML',
        },
        thumbnail_url: `${base}assets/icon.webp`,
        reply_markup: { inline_keyboard: [[{ text: `🎮 Join Room ${code}`, url: `${base}?room=${code}` }]] },
      });
    } else if (game === 'ludo') {
      results.push({
        type: 'article',
        id: 'open-ludo',
        title: '🎲 Shadow Games · Ludo',
        description: 'Play vs AI, 1v1 with a friend, or online rooms',
        input_message_content: { message_text: '🎲 <b>Shadow Games · Ludo</b> — race your pawns home!', parse_mode: 'HTML' },
        thumbnail_url: `${LUDO_URL}assets/icon.webp`,
        reply_markup: { inline_keyboard: [[{ text: '🎮 Open Ludo', url: LUDO_URL }]] },
      });
    } else if (game === 'chess') {
      results.push({
        type: 'article',
        id: 'open-chess',
        title: '♟️ Shadow Games · Chess',
        description: 'Real rules — vs AI, 1v1, or online rooms with clocks',
        input_message_content: { message_text: '♟️ <b>Shadow Games · Chess</b> — outwit. outplay. outlast.', parse_mode: 'HTML' },
        thumbnail_url: `${CHESS_URL}assets/icon.webp`,
        reply_markup: { inline_keyboard: [[{ text: '🎮 Open Chess', url: CHESS_URL }]] },
      });
    } else {
      // Bare inline menu or "games"
      results.push({
        type: 'article',
        id: 'hub',
        title: '🎮 Shadow Games',
        description: 'Ludo · Chess · UNO · WordSeek · Shadow Word — all in one hub',
        input_message_content: { message_text: '🎮 <b>Shadow Games</b> — Ludo, Chess and all the chat games!', parse_mode: 'HTML' },
        thumbnail_url: `${HUB_URL}ludo/assets/icon.webp`,
        reply_markup: { inline_keyboard: [[{ text: '🎮 Open Games Hub', url: HUB_URL }]] },
      });
      results.push({
        type: 'article',
        id: 'open-ludo',
        title: '🎲 Shadow Games · Ludo',
        description: 'Play vs AI, 1v1 with a friend, or online rooms',
        input_message_content: { message_text: '🎲 <b>Shadow Games · Ludo</b> — race your pawns home!', parse_mode: 'HTML' },
        thumbnail_url: `${LUDO_URL}assets/icon.webp`,
        reply_markup: { inline_keyboard: [[{ text: '🎮 Open Ludo', url: LUDO_URL }]] },
      });
      results.push({
        type: 'article',
        id: 'open-chess',
        title: '♟️ Shadow Games · Chess',
        description: 'Real rules — vs AI, 1v1, or online rooms with clocks',
        input_message_content: { message_text: '♟️ <b>Shadow Games · Chess</b> — outwit. outplay. outlast.', parse_mode: 'HTML' },
        thumbnail_url: `${CHESS_URL}assets/icon.webp`,
        reply_markup: { inline_keyboard: [[{ text: '🎮 Open Chess', url: CHESS_URL }]] },
      });
    }

    await api.answerInlineQuery({ inline_query_id: query.id, results, cache_time: 120, is_personal: false });
  } catch (err) {
    await reportHandlerError(err, { where: 'handlers/inline_query', update: ctx?.update });
  }
}
