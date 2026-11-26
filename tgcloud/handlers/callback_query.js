// Callback query handler — ported from handlers/callbacks.py + maumau callbacks
import { api } from 'sdk';
import { db, eq, desc } from 'sdk/db';
import { configurePipeline, reportHandlerError, isRetryUpdate } from '../lib/pipeline.js';
import { sendText, editText, editCaption, deleteMessage, answerCallbackQuery, escapeHtml } from '../lib/msg.js';
import { E, EID, plain } from '../lib/emojis.js';
const BULLET = E.BULLET;
import { setState, deleteState } from '../lib/db.js';
import { btnPrimary, btnSuccess, btnDanger, btnDefault, buildKeyboard } from '../lib/keyboards.js';
import { gamePlayers } from '../schema.js';
import {
  getActiveGame, startNewGame, changeWord, setCustomWord, dropLead, volunteerLeader,
  getRoundWord,
} from '../lib/shadowgame.js';
import { mention } from '../lib/texts.js';
import { handleUnoCallback } from '../lib/uno_cmds.js';
import { handleLobbyCallback } from '../lib/lobby_actions.js';
import {
  leaderboardText, shadowRankingText, mystatsText,
  leaderboardKeyboard, rankingKeyboard,
} from '../lib/boards.js';
import { safeCallbackData, safeId, safeText } from '../lib/guard.js';
import { throttleCallback } from '../lib/ratelimit.js';
import { isAdmin } from '../lib/auth.js';
import { tryLock, unlock } from '../lib/lock.js';

configurePipeline({ api, chatId: -1003884436085 });

export default async function (query, ctx) {
  if (await isRetryUpdate(ctx)) return;
  try {
    if (!query?.id || !query.message) return;
    const data = safeCallbackData(query.data);
    const user = query.from;
    const chat = query.message.chat;
    const userId = safeId(user?.id);
    if (!data || !user || !chat || userId === null) return;
    if (!(await throttleCallback(userId))) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Too many taps — slow down.' });
      return;
    }
    const chatId = chat.id;
    const msgId = query.message.message_id;

    if (data.startsWith('lobby:')) {
      await handleLobbyCallback(query);
      return;
    }
    if (data.startsWith('mm:') || data.startsWith('uno:')) {
      await handleUnoCallback(query, ctx);
      return;
    }
    if (data.startsWith('board:')) {
      await handleBoardCallback(query, data.slice(6));
      return;
    }
    if (data.startsWith('ws:')) {
      // WordSeek callbacks — placeholder invites
      await answerCallbackQuery(query.id, 'WordSeek controls in serverless port');
      return;
    }
    if (data.startsWith('sgb:')) {
      const action = data.slice(4);
      if (action === 'global_ranking') { await handleGlobalRanking(query); return; }
      if (chat.type !== 'group' && chat.type !== 'supergroup') { await answerCallbackQuery(query.id, 'Use in a group'); return; }

      if (action.startsWith('mode:')) {
        if (!isAdmin(userId)) { await answerCallbackQuery(query.id, 'Admin only.', { showAlert: true }); return; }
        const category = action.slice(5);
        if (!['normal', 'fiction'].includes(category)) { await answerCallbackQuery(query.id, 'Invalid mode'); return; }
        const existing = await getActiveGame(chatId);
        if (existing) { await answerCallbackQuery(query.id, 'A game is already running. Use /stop first.', { showAlert: true }); return; }
        const result = await startNewGame(chatId, user.id, user.first_name || 'Player', user.username, chat.title, category);
        await deleteMessage(chatId, msgId);
        const label = category === 'normal' ? 'Normal' : 'Fiction';
        await sendText(chatId,
          `${E.GAME} ${mention(user.id, user.first_name || 'Player')} started a <b>${label}</b> mode game!\n\n${E.ARROW} ${mention(user.id, user.first_name || 'Player')} is explaining the word!`,
          { parseMode: 'HTML', replyMarkup: buildKeyboard([
            [btnSuccess('Change Word', 'sgb:change', EID.INFO), btnDefault('Set Word (DM)', 'sgb:setword', EID.FOLDER), btnDanger('End Round', 'sgb:drop', EID.CROSS)],
          ]) });
        await answerCallbackQuery(query.id);
        return;
      }

      const game = await getActiveGame(chatId);
      if (!game) { await answerCallbackQuery(query.id, 'No active game in this chat.'); return; }
      const lockKey = `game:${chatId}`;
      if (!(await tryLock(lockKey))) { await answerCallbackQuery(query.id, 'Game is busy — try again.'); return; }
      try {
      const isLeader = Number(user.id) === Number(game.currentLeaderId);

      switch (action) {
        case 'see': {
          if (!isLeader) { await answerCallbackQuery(query.id, 'You are not the current leader.'); return; }
          const word = game.currentRoundId ? await getRoundWord(game.currentRoundId) : null;
          await answerCallbackQuery(query.id, word ? `Your word: ${word.toUpperCase()}\n\nExplain it without saying it!` : 'No word set for this round.', { showAlert: true });
          return;
        }
        case 'setword': {
          if (!isLeader) { await answerCallbackQuery(query.id, 'You are not the current leader.'); return; }
          await setState(`setword:${user.id}`, { gameChatId: chatId, gameId: game.id });
          try {
            await sendText(user.id, `${E.PIN} Send the word you want the players to guess.`, { parseMode: 'HTML' });
            await answerCallbackQuery(query.id, plain(`${E.CHECK} Check your DM!`));
          } catch (e) {
            await answerCallbackQuery(query.id, 'Start the bot in DM first, then try again.', { showAlert: true });
          }
          return;
        }
        case 'change': {
          if (!isLeader) { await answerCallbackQuery(query.id, 'You are not the current leader.'); return; }
          const word = await changeWord(chatId);
          await answerCallbackQuery(query.id, word ? `New word: ${word.toUpperCase()}` : 'Could not change the word.', { showAlert: !!word });
          return;
        }
        case 'drop': {
          if (!isLeader) { await answerCallbackQuery(query.id, 'You are not the current leader.'); return; }
          await dropLead(chatId);
          await editText(chatId, msgId, `${E.INFO} A new leader must be selected.`,
            { parseMode: 'HTML', replyMarkup: buildKeyboard([[btnPrimary('Become Leader', 'sgb:volunteer', EID.USER)]]) });
          await answerCallbackQuery(query.id, 'No winner this round.');
          return;
        }
        case 'volunteer': {
          const result = await volunteerLeader(chatId, user.id, user.first_name || 'Player', user.username);
          if (!result) { await answerCallbackQuery(query.id, 'A leader is already set.'); return; }
          await editText(chatId, msgId, `${E.SUCCESS} ${mention(user.id, user.first_name || 'Player')} is now the leader!`,
            { parseMode: 'HTML', replyMarkup: buildKeyboard([
              [btnSuccess('Change Word', 'sgb:change', EID.INFO), btnDefault('Set Word (DM)', 'sgb:setword', EID.FOLDER), btnDanger('End Round', 'sgb:drop', EID.CROSS)],
            ]) });
          await answerCallbackQuery(query.id);
          return;
        }
        case 'stop': {
          await answerCallbackQuery(query.id, 'Use /stop in the group.');
          return;
        }
        default: await answerCallbackQuery(query.id, 'Unknown action.');
      }
      } finally { await unlock(lockKey); }
      return;
    }

    if (data.startsWith('start:')) {
      if (data === 'start:help') {
        await sendText(chatId, `${E.INFO} Use /help for the full command list.`, { parseMode: 'HTML' });
      }
      await answerCallbackQuery(query.id);
      return;
    }
    await answerCallbackQuery(query.id);
  } catch (err) {
    await reportHandlerError(err, { where: 'handlers/callback_query', update: ctx?.update });
    try { await api.answerCallbackQuery({ callback_query_id: query.id }); } catch (e) { }
  }
}

async function handleBoardCallback(query, action) {
  const chatId = query.message?.chat?.id;
  const user = query.from;
  let text;
  let markup;
  if (['chat', 'global', 'week', '4', '5', '6'].includes(action)) {
    const opts = {
      global: action === 'global',
      week: action === 'week',
      length: ['4', '5', '6'].includes(action) ? action : null,
    };
    text = await leaderboardText(chatId, opts);
    const active = {
      chat: action === 'chat', global: action === 'global', week: action === 'week',
      ...(opts.length ? { [opts.length]: true } : {}),
    };
    markup = leaderboardKeyboard(active);
  } else if (action === 'shadow') {
    text = await shadowRankingText(chatId);
    markup = rankingKeyboard();
  } else if (action === 'mystats') {
    text = await mystatsText(user?.id, user?.first_name || 'Player');
    markup = rankingKeyboard();
  } else {
    await answerCallbackQuery(query.id);
    return;
  }
  try {
    if (!(await editCaption(chatId, query.message.message_id, text, { parseMode: 'HTML', replyMarkup: markup }))) {
      await editText(chatId, query.message.message_id, text, { parseMode: 'HTML', replyMarkup: markup });
    }
  } catch (e) { /* message may be gone */ }
  await answerCallbackQuery(query.id);
}

async function handleGlobalRanking(query) {
  const text = await shadowRankingText();
  if (!(await editCaption(query.message.chat.id, query.message.message_id, text, { parseMode: 'HTML', replyMarkup: rankingKeyboard() }))) {
    await editText(query.message.chat.id, query.message.message_id, text, { parseMode: 'HTML', replyMarkup: rankingKeyboard() });
  }
  await answerCallbackQuery(query.id);
}
