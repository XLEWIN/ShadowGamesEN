// Inline query handler — Shadow Games challenges + UNO sticker cards.
// Handler filename = Telegram update type (see AGENTS.md).

import { api } from 'sdk';
import { configurePipeline, reportHandlerError, isRetryUpdate } from '../lib/pipeline.js';
import { makeInlineResults } from '../lib/uno_inline.js';
import { LOG_CHANNEL_ID } from '../lib/texts.js';
import { inviteResults } from '../lib/lobby_invite.js';

configurePipeline({ api, chatId: LOG_CHANNEL_ID });

export default async function (query, ctx) {
  if (isRetryUpdate(ctx)) return;
  try {
    if (!query?.from || typeof query.id !== 'string') return;
    const text = (query.query || '').trim().toLowerCase();
    // "invite chess ABCDE" must keep the host's room code so both players land
    // in the same room. A bare query gets a fresh code for a new table.
    const parts = text.split(/\s+/).filter(Boolean);
    let code = null;
    if (parts.length >= 2) {
      const candidate = parts[parts.length - 1].toUpperCase();
      if (/^[A-Z0-9]{5}$/.test(candidate) && !['chess', 'ludo'].includes(candidate.toLowerCase())) code = candidate;
    }
    const invites = inviteResults(query.from, code);
    if (/^(invite|challenge|shadow|vs)/.test(text)) {
      await api.answerInlineQuery({ inline_query_id: query.id, results: invites, cache_time: 0, is_personal: true });
      return;
    }
    // Every inline query (including a bare "@ShadowGameEnBot") offers the
    // challenge articles first — no need to type "invite".
    const { results, switchText } = await makeInlineResults(query.from.id, query.query);
    await api.answerInlineQuery({
      inline_query_id: query.id,
      results: [...invites, ...results],
      cache_time: 0,
      is_personal: true,
      ...(switchText ? { button: { text: switchText, start_parameter: 'select' } } : {}),
    });
  } catch (err) {
    await reportHandlerError(err, { where: 'handlers/inline_query', update: ctx?.update });
    try {
      await api.answerInlineQuery({ inline_query_id: query.id, results: [], cache_time: 0 });
    } catch (e) { /* ignore */ }
  }
}
