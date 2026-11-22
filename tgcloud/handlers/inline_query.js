// Inline query handler — UNO sticker cards + game invite articles.
// Handler filename = Telegram update type (see AGENTS.md).

import { api } from 'sdk';
import { configurePipeline, reportHandlerError, isRetryUpdate } from '../lib/pipeline.js';
import { answerInlineQuery } from '../lib/uno_inline.js';
import { LOG_CHANNEL_ID } from '../lib/texts.js';

configurePipeline({ api, chatId: LOG_CHANNEL_ID });

export default async function (query, ctx) {
  if (isRetryUpdate(ctx)) return;
  try {
    if (!query?.from || typeof query.id !== 'string') return;
    await answerInlineQuery(query);
  } catch (err) {
    await reportHandlerError(err, { where: 'handlers/inline_query', update: ctx?.update });
    try {
      await api.answerInlineQuery({ inline_query_id: query.id, results: [], cache_time: 0 });
    } catch (e) { /* ignore */ }
  }
}
