// Chosen inline result handler — plays the UNO sticker/card the user tapped.
// Handler filename = Telegram update type (see AGENTS.md).

import { api } from 'sdk';
import { configurePipeline, reportHandlerError, isRetryUpdate } from '../lib/pipeline.js';
import { processChosenResult } from '../lib/uno_inline.js';
import { LOG_CHANNEL_ID } from '../lib/texts.js';

configurePipeline({ api, chatId: LOG_CHANNEL_ID });

export default async function (chosen, ctx) {
  if (isRetryUpdate(ctx)) return;
  try {
    if (!chosen?.from || !chosen.result_id) return;
    await processChosenResult(chosen);
  } catch (err) {
    await reportHandlerError(err, { where: 'handlers/chosen_inline_result', update: ctx?.update });
  }
}
