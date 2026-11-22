import { api } from 'sdk';
import { configurePipeline, reportHandlerError, isRetryUpdate } from '../lib/pipeline.js';
import { answerCallbackQuery, editText } from '../lib/msg.js';

configurePipeline({ api, chatId: -1003884436085 });

export default async function (query, ctx) {
  if (isRetryUpdate(ctx)) return;
  try {
    if (!query?.from) return;
    const data = query.data || '';

    // Route by prefix
    if (data.startsWith('ludo:') || data.startsWith('chess:') || data.startsWith('ws:')) {
      // Placeholder — will be implemented per-game
      await answerCallbackQuery(query.id, 'Coming soon in serverless port');
      return;
    }

    await answerCallbackQuery(query.id);
  } catch (err) {
    await reportHandlerError(err, { where: 'handlers/callback_query', update: ctx?.update });
    try { await api.answerCallbackQuery({ callback_query_id: query.id }); } catch {}
  }
}
