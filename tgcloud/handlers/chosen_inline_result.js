// Chosen inline result handler — plays the UNO sticker/card the user tapped.
// Handler filename = Telegram update type (see AGENTS.md).

import { api } from 'sdk';
import { configurePipeline, reportHandlerError, isRetryUpdate } from '../lib/pipeline.js';
import { processChosenResult } from '../lib/uno_inline.js';
import { LOG_CHANNEL_ID } from '../lib/texts.js';
import { safeCallbackData, safeId } from '../lib/guard.js';
import { throttle } from '../lib/ratelimit.js';

configurePipeline({ api, chatId: LOG_CHANNEL_ID });

export default async function (chosen, ctx) {
  if (await isRetryUpdate(ctx)) return;
  try {
    const userId = safeId(chosen?.from?.id);
    const resultId = safeCallbackData(chosen?.result_id);
    if (userId === null || !resultId) return;
    if (!(await throttle('chosen', userId, { limit: 10, windowMs: 10_000 }))) return;
    await processChosenResult({ ...chosen, result_id: resultId, from: { ...chosen.from, id: userId } });
  } catch (err) {
    await reportHandlerError(err, { where: 'handlers/chosen_inline_result', update: ctx?.update });
  }
}
