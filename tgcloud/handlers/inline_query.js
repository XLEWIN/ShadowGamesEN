// Inline query handler — UNO sticker cards + game invite articles.
// Handler filename = Telegram update type (see AGENTS.md).

import { api } from 'sdk';
import { configurePipeline, reportHandlerError, isRetryUpdate } from '../lib/pipeline.js';
import { answerInlineQuery } from '../lib/uno_inline.js';
import { LOG_CHANNEL_ID, mention } from '../lib/texts.js';
import { E, EID } from '../lib/emojis.js';
import { btnSuccess, btnPrimary, buildKeyboard } from '../lib/keyboards.js';

configurePipeline({ api, chatId: LOG_CHANNEL_ID });

function inviteArticle(game, user) {
  const name = user.first_name || user.username || 'Player';
  return {
    type: 'article',
    id: `invite-${game}`,
    title: `SANSAD SHOWDOWN · ${game.toUpperCase()}`,
    description: 'VS FRIEND challenge — open the table and invite players',
    input_message_content: {
      message_text:
        `${E.SPARKLE} <b>SANSAD SHOWDOWN</b>\n\n` +
        `${E.ARROW} <b>VS FRIEND</b> challenge from ${mention(user.id, name)}\n\n` +
        `${E.INFO} Law says satta impossible. Reality says fight.\n\n` +
        `${E.GAME} <b>${game.toUpperCase()}</b> · ${game === 'chess' ? '1v1' : '2–4 players'}`,
      parse_mode: 'HTML',
    },
    reply_markup: buildKeyboard([
      [
        btnSuccess('Join the game', `lobby:quick:${game}`, EID.PLAY),
        btnPrimary('Spectate', `lobby:quickspect:${game}`, EID.WATCH),
      ],
    ]),
  };
}

async function answerInvite(query) {
  const results = [inviteArticle('chess', query.from), inviteArticle('ludo', query.from)];
  await api.answerInlineQuery({ inline_query_id: query.id, results, cache_time: 0, is_personal: true });
}

export default async function (query, ctx) {
  if (isRetryUpdate(ctx)) return;
  try {
    if (!query?.from || typeof query.id !== 'string') return;
    const text = (query.query || '').trim().toLowerCase();
    if (/^(invite|challenge|sansad|vs)/.test(text)) {
      await answerInvite(query);
      return;
    }
    await answerInlineQuery(query);
  } catch (err) {
    await reportHandlerError(err, { where: 'handlers/inline_query', update: ctx?.update });
    try {
      await api.answerInlineQuery({ inline_query_id: query.id, results: [], cache_time: 0 });
    } catch (e) { /* ignore */ }
  }
}
