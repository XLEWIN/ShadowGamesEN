// Callback query handler — ported from handlers/callbacks.py + maumau callbacks
import { api } from 'sdk';
import { db, eq, desc } from 'sdk/db';
import { configurePipeline, reportHandlerError, isRetryUpdate } from '../lib/pipeline.js';
import { sendText, editText, deleteMessage, answerCallbackQuery, escapeHtml } from '../lib/msg.js';
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

configurePipeline({ api, chatId: -1003884436085 });

export default async function (query, ctx) {
  if (isRetryUpdate(ctx)) return;
  try {
    if (!query?.data || !query.message) return;
    const data = query.data;
    const user = query.from;
    const chat = query.message.chat;
    if (!user || !chat) return;
    const chatId = chat.id;
    const msgId = query.message.message_id;

    if (data.startsWith('mm:') || data.startsWith('uno:')) {
      await handleUnoCallback(query, ctx);
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

async function handleGlobalRanking(query) {
  const rows = await db.select().from(gamePlayers).orderBy(desc(gamePlayers.score)).limit(25).all();
  if (!rows.length) { await answerCallbackQuery(query.id, 'No scores yet globally.'); return; }
  let text = `${E.GLOBE} <b>Top 25 Players (Global)</b>\n${E.BULLET}\n\n`;
  const medals = [E.MEDAL_1, E.MEDAL_2, E.MEDAL_3];
  rows.forEach((p, i) => { text += `${medals[i] || `  ${i + 1}.`} <b>${escapeHtml(p.displayName || 'Unknown')}</b>\n   💰 ${p.score} Xeons\n\n`; });
  await editText(query.message.chat.id, query.message.message_id, text, { parseMode: 'HTML' });
  await answerCallbackQuery(query.id);
}
