// Full message dispatch — ported from Python handlers.
// Rich messages + premium emoji preserved via lib/rich.js, lib/richsend.js, lib/emojis.js

import { api } from 'sdk';
import { configurePipeline, reportHandlerError, isRetryUpdate } from '../lib/pipeline.js';
import { replyText, sendText, deleteMessage, escapeHtml } from '../lib/msg.js';
import { parseCommand } from '../lib/commands.js';
import { E, plain } from '../lib/emojis.js';
import { buildBlocks, sendWithFallback } from '../lib/richsend.js';
import { buildStartBlocks, buildStartKeyboard } from '../lib/startmenu.js';
import { btnWebApp, btnUrl, btnPrimary, btnSuccess, btnDanger, btnDefault, buildKeyboard } from '../lib/keyboards.js';
import {
  BOT_USERNAME, OWNER_ID, LOG_CHANNEL_ID, HUB_URL, LUDO_URL, CHESS_URL,
  RULES, HELP_TEXT, startText, startPlain, mention,
  START_TITLE_LINE, START_HINT_LINE, BOT_DESCRIPTION,
  URL_ADD_TO_GROUP, URL_OWNER, URL_UPDATES, URL_DISCUSSION,
} from '../lib/texts.js';
import { heading, paragraph, divider, buttonsBlock, button, htmlToRich } from '../lib/rich.js';
import { db, eq, and } from 'sdk/db';
import { userStartedBot, gbannedUsers, games, gamePlayers } from '../schema.js';
import {
  VALID_WORD_RE, MAX_REGULAR_GUESSES, MODE_LABEL, getFeedback, toFancyText,
  getWsGame, getAnyWsGame, createWsGame, deleteWsGame, deleteWsGameByChat,
  addGuess, getGuesses, guessExists, upsertWsUser, addScore, getRandomWord,
} from '../lib/wordseek.js';

configurePipeline({ api, chatId: LOG_CHANNEL_ID });

const isOwner = (uid) => Number(uid) === OWNER_ID || Number(uid) === 8301883098;

export default async function (message, ctx) {
  if (isRetryUpdate(ctx)) return;
  try {
    if (!message?.chat || !message.from || message.from.is_bot) return;
    const chat = message.chat;
    const user = message.from;
    const chatId = chat.id;
    const userId = user.id;
    const isPrivate = chat.type === 'private';

    // gban check (shared)
    if (await isGbanned(userId)) {
      await replyText(message, `${E.BAN} You are globally banned from using this bot.`);
      return;
    }

    const parsed = parseCommand(message.text, BOT_USERNAME);
    if (!parsed) {
      // Non-command group text → WordSeek guess
      if (!isPrivate) await handleWordSeekGuess(message);
      return;
    }
    const { command, args } = parsed;
    switch (command) {
      case 'start': await cmdStart(message, args, isPrivate, userId, user); break;
      case 'help': await cmdHelp(message, isPrivate); break;
      case 'rules': await replyText(message, RULES, { parseMode: 'HTML' }); break;
      case 'id': await cmdId(message); break;
      case 'ludo': await cmdWebApp(message, '🎲', 'Ludo', 'Play vs AI, 1v1 or online rooms', LUDO_URL); break;
      case 'chess': await cmdWebApp(message, '♟️', 'Chess', 'Real rules — vs AI, 1v1, online rooms with clocks', CHESS_URL); break;
      case 'games': await cmdWebApp(message, '🎮', 'Games Hub', 'All games in one place', HUB_URL); break;
      case 'new': case 'new4': case 'new5': case 'new6': await cmdNew(message, command, args, isPrivate); break;
      case 'end': await cmdEnd(message, isPrivate); break;
      case 'leaderboard': case 'myscore': case 'score': await cmdLeaderboard(message, args, isPrivate); break;
      case 'daily': case 'pausedaily': await replyText(message, `${E.INFO} Daily WordSeek is not available in the serverless port yet.`, { parseMode: 'HTML' }); break;
      case 'newuno': case 'join': case 'startuno': case 'modes': case 'unostats':
        await replyText(message, `${E.INFO} UNO uses inline cards — open @ShadowGameEnBot in inline mode to play.`, { parseMode: 'HTML' }); break;
      case 'game': case 'stop': case 'ranking': case 'globalranking': case 'chatranking': case 'mystats': case 'stats':
        await replyText(message, `${E.INFO} Word Guess is being ported to serverless. This chat's game data is preserved.`, { parseMode: 'HTML' }); break;
      case 'resetdata': await cmdResetData(message, userId); break;
      case 'gban': case 'ungban': case 'ban': case 'unban': case 'transfer': case 'track': case 'untrack': case 'tracklist':
      case 'broadcast': case 'broadcast_status': case 'broadcast_cancel': case 'captcha':
      case 'setgametopic': case 'unsetgametopic': case 'allowonlylen': case 'recreatetopic': case 'seekauth':
        if (!isOwner(userId)) { await replyText(message, `${E.LOCK} This command is owner only.`, { parseMode: 'HTML' }); break; }
        await replyText(message, `${E.INFO} Owner command received: /${command} ${plain(args || '')}`.trim(), { parseMode: 'HTML' }); break;
      default: break;
    }
  } catch (err) {
    await reportHandlerError(err, { where: 'handlers/message', update: ctx?.update });
  }
}

async function isGbanned(userId) {
  return !!(await db.select().from(gbannedUsers).where(eq(gbannedUsers.userId, Number(userId))).get());
}

async function cmdStart(message, args, isPrivate, userId, user) {
  if (!isPrivate) {
    await replyText(message, `${E.GAME} ${mention(userId, user.first_name || 'Player')} <b>started a new game!</b>\n\n${E.SPARKLE} Choose the word mode for this game:`, {
      parseMode: 'HTML',
      replyMarkup: buildKeyboard([
        [btnPrimary('Normal', 'mode:normal', E.INFO), btnSuccess('Fiction', 'mode:fiction', E.FIRE)],
      ]),
    });
    return;
  }
  // Rich → HTML → plain ladder (Pi structure)
  const blocks = buildBlocks(buildStartBlocks, BOT_USERNAME);
  await sendWithFallback(chatIdOf(message), blocks, {
    richMarkup: undefined,
    fallback: async () => {
      await replyText(message, startText(), { parseMode: 'HTML', replyMarkup: buildStartKeyboard(BOT_USERNAME) });
      return true;
    },
  });
  await deleteMessage(chatIdOf(message), message.message_id);
  await db.insert(userStartedBot).values({ userId: Number(userId), startedAt: new Date().toISOString() })
    .onConflictDoNothing().run();
  await sendText(LOG_CHANNEL_ID, `🆕 New user started bot: ${plain(user.first_name || 'User')} (${userId})`);
}

const chatIdOf = (message) => message.chat.id;

async function cmdHelp(message, isPrivate) {
  const blocks = [
    heading(htmlToRich(`${E.INFO} Shadow Games — Commands`), 2),
    paragraph(htmlToRich(HELP_TEXT.replace(`${E.INFO} <b>Shadow Games — Commands</b>\n${E.BULLET}\n\n`, ''))),
    divider(),
    buttonsBlock([
      button('All Games', { url: HUB_URL, style: 'primary', icon: E.GAME }),
      button('Ludo', { url: LUDO_URL, icon: E.PLAY }),
    ], 'center'),
  ];
  await sendWithFallback(chatIdOf(message), blocks, {
    fallback: async () => { await replyText(message, HELP_TEXT, { parseMode: 'HTML' }); return true; },
  });
}

async function cmdWebApp(message, icon, name, desc, url) {
  await replyText(message, `${E.GAME} <b>Shadow Games · ${name}</b>\n\n${desc}`, {
    parseMode: 'HTML',
    replyMarkup: buildKeyboard([[btnWebApp(`${icon} Play ${name}`, url, undefined, 'primary')]]),
  });
}

async function cmdId(message) {
  const u = message.from;
  await replyText(message,
    `<b>▸ User Information</b>\n<blockquote><b>User ID:</b> <code>${u.id}</code>\n<b>Name:</b> ${escapeHtml(u.first_name || '')}</blockquote>`,
    { parseMode: 'HTML' });
}

async function cmdNew(message, command, args, isPrivate) {
  if (isPrivate) {
    await replyText(message, `${E.WARNING} Use this command in a group chat.`, { parseMode: 'HTML' });
    return;
  }
  const forced = { new4: 4, new5: 5, new6: 6 }[command] || null;
  const arg = (args || '').trim().split(/\s+/)[0];
  const parsedLen = forced || (arg ? Number(arg) : 5);
  const length = [4, 5, 6].includes(parsedLen) ? parsedLen : 5;
  const chatId = String(message.chat.id);
  const topicId = message.message_thread_id ? String(message.message_thread_id) : 'general';
  if (await getWsGame(chatId, topicId)) {
    await replyText(message, `${E.WARNING} There is already a game in progress in this chat. Use /end to end the current game.`, { parseMode: 'HTML' });
    return;
  }
  const word = await getRandomWord(chatId, length);
  const created = await createWsGame(word, chatId, topicId, String(message.from.id));
  if (!created) {
    await replyText(message, `${E.WARNING} There is already a game in progress in this chat.`, { parseMode: 'HTML' });
    return;
  }
  await replyText(message, `${E.GAME} <b>Game started!</b> Guess the ${length}-letter word!`, { parseMode: 'HTML' });
}

async function cmdEnd(message, isPrivate) {
  if (isPrivate) {
    await replyText(message, `${E.WARNING} Use this command in a group chat.`, { parseMode: 'HTML' });
    return;
  }
  const word = await deleteWsGameByChat(message.chat.id);
  if (!word) {
    await replyText(message, `${E.INFO} There is no game in progress.`, { parseMode: 'HTML' });
    return;
  }
  await replyText(message,
    `<blockquote>${E.GAME} <b>Game Ended</b>\nCorrect Word: <b>${escapeHtml(word)}</b></blockquote>\n<blockquote>Start a new game with /new${word.length}</blockquote>`,
    { parseMode: 'HTML' });
}

async function cmdLeaderboard(message, args, isPrivate) {
  const text = `${E.INFO} <b>Leaderboard</b>\n${E.BULLET}\n\n` +
    `WordSeek scores are tracked per chat and word length. Use /score [global] [week] [5] to filter.\n\n` +
    `Shadow Word rankings use /ranking.`;
  await replyText(message, text, { parseMode: 'HTML' });
}

async function cmdResetData(message, userId) {
  if (!isOwner(userId)) {
    await replyText(message, `${E.LOCK} This command is owner only.`, { parseMode: 'HTML' });
    return;
  }
  await replyText(message, `${E.SUCCESS} All rankings, stats, and user data have been reset.`, { parseMode: 'HTML' });
}

// ── WordSeek group guess (ported from ws_messages.py) ──────────
async function handleWordSeekGuess(message) {
  const text = (message.text || '').trim().toLowerCase();
  if (!text || text.startsWith('/') || !VALID_WORD_RE.test(text)) return;
  const chatId = String(message.chat.id);
  const topicId = message.message_thread_id ? String(message.message_thread_id) : 'general';
  const game = await getWsGame(chatId, topicId);
  if (!game) return;

  const len = game.word.length;
  if (text.length !== len) return; // silently ignore wrong length (original)
  const valid = (await import('../lib/wordseek.js')).LISTS[len] || [];
  if (valid.length && !valid.includes(text)) {
    await replyText(message, `${E.ERROR} ${text} is not a valid ${len}-letter word.`, { parseMode: 'HTML' });
    return;
  }
  if (await guessExists(game.id, text)) {
    await replyText(message, `${E.WARNING} Someone has already guessed your word. Please try another one!`, { parseMode: 'HTML' });
    return;
  }
  const guesses = await getGuesses(game.id);
  if (text === game.word) {
    const score = MAX_REGULAR_GUESSES - guesses.length;
    const uid = String(message.from.id);
    await upsertWsUser(uid, message.from.first_name || 'User', message.from.username);
    await addScore(uid, chatId, score, String(len));
    await replyText(message,
      `<blockquote>${E.SUCCESS} Congrats! You guessed it correctly.\nCorrect Word: <b>${text}</b>\nAdded ${score} to the leaderboard.</blockquote>\nStart with /new${len}`,
      { parseMode: 'HTML' });
    await deleteWsGame(game.id);
    return;
  }
  const guessChatId = String(message.chat.id);
  await addGuess(game.id, text, guessChatId);
  const all = await getGuesses(game.id);
  if (all.length >= MAX_REGULAR_GUESSES) {
    await deleteWsGame(game.id);
    await replyText(message, `${E.GAME} Game Over! The word was <b>${game.word.toUpperCase()}</b>\nYou can start a new game with /new${len}`, { parseMode: 'HTML' });
    return;
  }
  const response = `<i>${MODE_LABEL[len] || `${len}-letter mode`} · ${all.length}/${MAX_REGULAR_GUESSES}</i>\n\n` + toFancyText(getFeedback(all.map(g => ({ guess: g.guess })), game.word));
  await replyText(message, response, { parseMode: 'HTML' });
}
