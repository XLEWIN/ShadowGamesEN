// Full message dispatch — ported from Python handlers.
// Rich Messages + premium emoji preserved via lib/rich.js, lib/richsend.js, lib/emojis.js

import { api } from 'sdk';
import { db, eq, and, desc, sql } from 'sdk/db';
import { configurePipeline, reportHandlerError, isRetryUpdate } from '../lib/pipeline.js';
import { replyText, sendText, deleteMessage, escapeHtml } from '../lib/msg.js';
import { getState, setState, deleteState } from '../lib/db.js';
import { parseCommand } from '../lib/commands.js';
import { E, EID, plain } from '../lib/emojis.js';
import { buildBlocks, sendWithFallback } from '../lib/richsend.js';
import { buildStartBlocks, buildStartKeyboard } from '../lib/startmenu.js';
import { btnWebApp, btnUrl, btnPrimary, btnSuccess, btnDanger, btnDefault, buildKeyboard } from '../lib/keyboards.js';
import { heading, paragraph, divider, buttonsBlock, button, htmlToRich } from '../lib/rich.js';
import {
  BOT_USERNAME, OWNER_ID, LOG_CHANNEL_ID, HUB_URL, LUDO_URL, CHESS_URL,
  RULES, HELP_TEXT, startText, mention,
  START_TITLE_LINE, START_HINT_LINE, BOT_DESCRIPTION,
  URL_ADD_TO_GROUP, URL_OWNER, URL_UPDATES, URL_DISCUSSION,
} from '../lib/texts.js';
import { userStartedBot, gbannedUsers, games, gamePlayers, wsDailyWords, wsDailyGuesses } from '../schema.js';
import {
  VALID_WORD_RE, MAX_REGULAR_GUESSES, MAX_DAILY_ATTEMPTS, MODE_LABEL, getFeedback, toFancyText,
  getWsGame, getAnyWsGame, createWsGame, deleteWsGame, deleteWsGameByChat,
  addGuess, getGuesses, guessExists, upsertWsUser, addScore, getRandomWord, LISTS,
} from '../lib/wordseek.js';
import {
  getActiveGame, startNewGame, handleGuess as handleShadowGuess, endGame,
  changeWord, setCustomWord, dropLead, volunteerLeader, getScoreboard,
} from '../lib/shadowgame.js';
import { getWordOfTheDay, getGameDate } from '../lib/daily.js';
import { handleAdminCommand } from '../lib/admin.js';
import { handleUnoCommand } from '../lib/uno_cmds.js';

configurePipeline({ api, chatId: LOG_CHANNEL_ID });

const isOwner = (uid) => Number(uid) === OWNER_ID || Number(uid) === 8301883098;
const chatIdOf = (m) => m.chat.id;

export default async function (message, ctx) {
  if (isRetryUpdate(ctx)) return;
  try {
    if (!message?.chat || !message.from || message.from.is_bot) return;
    const chat = message.chat;
    const user = message.from;
    const chatId = chat.id;
    const userId = user.id;
    const isPrivate = chat.type === 'private';

    if (await isGbanned(userId)) {
      await replyText(message, `${E.BAN} You are globally banned from using this bot.`);
      return;
    }

    const parsed = parseCommand(message.text, BOT_USERNAME);
    if (!parsed) {
      if (isPrivate) await handlePrivateText(message);
      else await handleGroupText(message);
      return;
    }
    const { command, args } = parsed;
    switch (command) {
      case 'start': await cmdStart(message, args, isPrivate, userId, user); break;
      case 'help': await cmdHelp(message, isPrivate); break;
      case 'rules': await cmdRules(message); break;
      case 'id': await cmdId(message); break;
      case 'ludo': await cmdWebApp(message, 'Ludo', 'Play vs AI, 1v1 or online rooms', LUDO_URL); break;
      case 'chess': await cmdWebApp(message, 'Chess', 'Real rules — vs AI, 1v1, online rooms with clocks', CHESS_URL); break;
      case 'games': await cmdWebApp(message, 'Games Hub', 'All games in one place', HUB_URL); break;
      case 'new': case 'new4': case 'new5': case 'new6': await cmdNew(message, command, args, isPrivate); break;
      case 'end': await cmdEnd(message, isPrivate); break;
      case 'daily': await cmdDaily(message, isPrivate, userId); break;
      case 'pausedaily': await cmdPauseDaily(message, userId); break;
      case 'leaderboard': case 'myscore': case 'score': await cmdLeaderboard(message, args, isPrivate); break;
      case 'game': await cmdGame(message, chat, user, isPrivate, args); break;
      case 'stop': await cmdStop(message, chat, user, isPrivate); break;
      case 'ranking': await cmdRanking(message, isPrivate, chatId); break;
      case 'globalranking': await cmdGlobalRanking(message); break;
      case 'mystats': case 'stats': await cmdMystats(message, userId, user); break;
      case 'chatranking': await replyText(message, `${E.INFO} No active chats yet.`, { parseMode: 'HTML' }); break;
      case 'newuno': case 'join': case 'startuno': case 'modes': case 'unostats': case 'kill': case 'kick': case 'open': case 'close': case 'skip': case 'notifyme': case 'leave': case 'hand': case 'show': {
        // ctx.reply receives the SAME opts object the UNO module built
        // ({ parseMode, replyMarkup }); never wrap it again — a nested
        // replyMarkup is not an InlineKeyboardMarkup and Telegram drops it.
        await handleUnoCommand(command, args, message, {
          reply: (text, opts) => replyText(message, text, { parseMode: 'HTML', ...(opts || {}) }),
          replyMessage: (text, opts) => replyText(message, text, { parseMode: 'HTML', ...(opts || {}) }),
        });
        break;
      }
      case 'resetdata': await cmdResetData(message, userId); break;
      case 'gban': case 'ungban': case 'ban': case 'unban': case 'transfer': case 'track': case 'untrack': case 'tracklist':
      case 'broadcast': case 'broadcast_status': case 'broadcast_cancel': case 'captcha':
      case 'setgametopic': case 'unsetgametopic': case 'allowonlylen': case 'recreatetopic': case 'seekauth': {
        await handleAdminCommand(command, args, message, {
          reply: (text, opts) => replyText(message, text, { parseMode: 'HTML', ...(opts || {}) }),
          replyMessage: (text, opts) => replyText(message, text, { parseMode: 'HTML', ...(opts || {}) }),
        });
        break;
      }
      default: break;
    }
  } catch (err) {
    await reportHandlerError(err, { where: 'handlers/message', update: ctx?.update });
  }
}

async function isGbanned(userId) {
  return !!(await db.select().from(gbannedUsers).where(eq(gbannedUsers.userId, Number(userId))).get());
}
async function hasStarted(userId) {
  return !!(await db.select().from(userStartedBot).where(eq(userStartedBot.userId, Number(userId))).get());
}

async function cmdStart(message, args, isPrivate, userId, user) {
  if (!isPrivate) {
    await replyText(message, `${E.GAME} ${mention(userId, user.first_name || 'Player')} <b>started a new game!</b>\n\n${E.SPARKLE} Choose the word mode for this game:`, {
      parseMode: 'HTML',
      replyMarkup: buildKeyboard([[btnPrimary('Normal', 'mode:normal', EID.INFO), btnSuccess('Fiction', 'mode:fiction', EID.FIRE)]]),
    });
    return;
  }
  const blocks = buildBlocks(buildStartBlocks, BOT_USERNAME);
  await sendWithFallback(chatIdOf(message), blocks, {
    fallback: async () => { await replyText(message, startText(), { parseMode: 'HTML', replyMarkup: buildStartKeyboard(BOT_USERNAME) }); return true; },
  });
  await deleteMessage(chatIdOf(message), message.message_id);
  await db.insert(userStartedBot).values({ userId: Number(userId), startedAt: new Date().toISOString() }).onConflictDoNothing().run();
  await sendText(LOG_CHANNEL_ID, `🆕 New user started bot: ${plain(user.first_name || 'User')} (${userId})`);
}

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

async function cmdRules(message) {
  const text = `${E.INFO} <b>Game Rules</b>\n${E.BULLET}\n\n` +
    `${E.GAME} <b>Word Guess</b>\nIn this game, there are two roles: leader and participants. The leader chooses a random secret word and describes it without actually saying it. The goal for the other participants is to guess the word and type it in the group chat.\n\n` +
    `${E.TROPHY} <b>About Rewards</b>\nYou win 1 Xeon if you:\n${E.CHECK} Are the first person to guess (type) the correct word.\n\n` +
    '<i>The "Xeons" represents an in-game currency only and has no real-world monetary value.</i>';
  await replyText(message, text, { parseMode: 'HTML' });
}

async function cmdWebApp(message, name, desc, url) {
  await replyText(message, `${E.GAME} <b>Shadow Games · ${name}</b>\n\n${desc}`, {
    parseMode: 'HTML',
    replyMarkup: buildKeyboard([[btnWebApp(`Play ${name}`, url)]]),
  });
}

async function cmdId(message) {
  const u = message.from;
  await replyText(message, `<b>▸ User Information</b>\n<blockquote><b>User ID:</b> <code>${u.id}</code>\n<b>Name:</b> ${escapeHtml(u.first_name || '')}</blockquote>`, { parseMode: 'HTML' });
}

// ── WordSeek ────────────────────────────────────
async function cmdNew(message, command, args, isPrivate) {
  if (isPrivate) { await replyText(message, `${E.WARNING} Use this command in a group chat.`, { parseMode: 'HTML' }); return; }
  const forced = { new4: 4, new5: 5, new6: 6 }[command] || null;
  const arg = (args || '').trim().split(/\s+/)[0];
  const parsedLen = forced || (arg ? Number(arg) : 5);
  const length = [4, 5, 6].includes(parsedLen) ? parsedLen : 5;
  const chatId = String(message.chat.id);
  const topicId = message.message_thread_id ? String(message.message_thread_id) : 'general';
  if (await getWsGame(chatId, topicId)) {
    await replyText(message, `${E.WARNING} There is already a game in progress in this chat. Use /end to end the current game.`, { parseMode: 'HTML' }); return;
  }
  const word = await getRandomWord(chatId, length);
  const created = await createWsGame(word, chatId, topicId, String(message.from.id));
  if (!created) { await replyText(message, `${E.WARNING} There is already a game in progress in this chat.`, { parseMode: 'HTML' }); return; }
  await replyText(message, `${E.GAME} <b>Game started!</b> Guess the ${length}-letter word!`, { parseMode: 'HTML' });
}

async function cmdEnd(message, isPrivate) {
  if (isPrivate) { await replyText(message, `${E.WARNING} Use this command in a group chat.`, { parseMode: 'HTML' }); return; }
  const word = await deleteWsGameByChat(message.chat.id);
  if (!word) { await replyText(message, `${E.INFO} There is no game in progress.`, { parseMode: 'HTML' }); return; }
  await replyText(message, `<blockquote>${E.GAME} <b>Game Ended</b>\nCorrect Word: <b>${escapeHtml(word)}</b></blockquote>\n<blockquote>Start a new game with /new${word.length}</blockquote>`, { parseMode: 'HTML' });
}

async function cmdDaily(message, isPrivate, userId) {
  if (!isPrivate) { await replyText(message, `${E.WARNING} WordSeek of the Day can only be played in private chat with the bot. Send me a message directly!`, { parseMode: 'HTML' }); return; }
  const word = getWordOfTheDay();
  const date = getGameDate();
  const uid = String(userId);
  // ensure daily word row
  let row = await db.select().from(wsDailyWords).where(eq(wsDailyWords.date, date)).get();
  if (!row) {
    const [r] = await db.insert(wsDailyWords).values({ dayNumber: Math.floor(Date.now() / 86400000), word, date }).returning().run();
    row = r;
  }
  const guesses = await db.select().from(wsDailyGuesses).where(and(eq(wsDailyGuesses.userId, uid), eq(wsDailyGuesses.dailyWordId, row.id))).all();
  await db.insert(wsUserStats).values({ userId: uid }).onConflictDoNothing().run();
  if (guesses.some(g => g.guess === row.word)) {
    await replyText(message, `${E.SUCCESS} You've already completed today's WordSeek! You got it in ${guesses.length} ${guesses.length === 1 ? 'try' : 'tries'}. Come back tomorrow!`, { parseMode: 'HTML' });
    return;
  }
  await setState(`daily:${uid}`, { dailyWordId: row.id, date });
  await replyText(message, `${E.GAME} <b>WordSeek of the Day started!</b> Guess the 5-letter word. You have ${MAX_DAILY_ATTEMPTS} attempts. Good luck!`, { parseMode: 'HTML' });
}

async function cmdPauseDaily(message, userId) {
  await deleteState(`daily:${userId}`);
  await replyText(message, `${E.SUCCESS} Your WordSeek of the Day game has been paused.`, { parseMode: 'HTML' });
}

async function cmdLeaderboard(message, args, isPrivate) {
  const text = `${E.INFO} <b>Leaderboard</b>\n${E.BULLET}\n\nWordSeek scores are tracked per chat and word length. Use /score [global] [week] [5] to filter.\n\nShadow Word rankings use /ranking.`;
  await replyText(message, text, { parseMode: 'HTML' });
}

// ── Shadow Word Guess ───────────────────────────
async function cmdGame(message, chat, user, isPrivate, args) {
  if (isPrivate) { await replyText(message, `${E.WARNING} Use this command in a group chat.`, { parseMode: 'HTML' }); return; }
  const existing = await getActiveGame(chat.id);
  if (existing) {
    await replyText(message, `${E.INFO} A game is already active in this chat.`, { parseMode: 'HTML', replyMarkup: buildKeyboard([[btnDanger('Stop Game', 'sgb:stop', EID.CROSS)]]) });
    return;
  }
  const category = String(args || '').trim().toLowerCase() === 'fiction' ? 'fiction' : 'normal';
  try {
    const { word, round } = await startNewGame(chat.id, user.id, user.first_name || 'Player', user.username, chat.title, category);
    await replyText(message, `${E.GAME} ${mention(user.id, user.first_name || 'Player')} <b>started a word game!</b>\n\n${E.SPARKLE} <b>Your word:</b> <code>${escapeHtml(word)}</code>\n\n${E.INFO} Describe it — don't say the word!`, {
      parseMode: 'HTML',
      replyMarkup: buildKeyboard([[btnSuccess('Change Word', 'sgb:change', EID.INFO), btnDefault('Set Word (DM)', 'sgb:setword', EID.FOLDER), btnDanger('End Round', 'sgb:drop', EID.CROSS)]]),
    });
  } catch (e) {
    await reportHandlerError(e, { where: 'cmdGame' });
    await replyText(message, `${E.ERROR} Something went wrong. Please try again.`, { parseMode: 'HTML' });
  }
}

async function cmdStop(message, chat, user, isPrivate) {
  if (isPrivate) { await replyText(message, `${E.WARNING} Use this command in a group chat.`, { parseMode: 'HTML' }); return; }
  const ok = await endGame(chat.id);
  await replyText(message, ok ? `${E.SUCCESS} Game stopped! Use /game to start a new game.` : `${E.INFO} No active game to stop.`, { parseMode: 'HTML' });
}

async function cmdRanking(message, isPrivate, chatId) {
  if (isPrivate) { await replyText(message, `${E.WARNING} Use this command in a group chat.`, { parseMode: 'HTML' }); return; }
  const g = await getActiveGame(chatId);
  if (!g) { await replyText(message, `${E.INFO} No active game. Use /game to start one!`, { parseMode: 'HTML' }); return; }
  const board = await getScoreboard(chatId);
  if (!board.length) { await replyText(message, `${E.INFO} No scores yet. Start a game first!`, { parseMode: 'HTML' }); return; }
  const medals = [E.MEDAL_1, E.MEDAL_2, E.MEDAL_3];
  let text = `${E.TROPHY} <b>Top 25 Players (This Chat)</b>\n${E.BULLET}\n\n`;
  board.slice(0, 25).forEach((p, i) => {
    const medal = medals[i] || `  ${i + 1}.`;
    text += `${medal} <b>${escapeHtml(p.displayName || 'Unknown')}</b>\n   💰 ${p.score} Xeons | 🔤 ${p.wordsGuessed} words\n\n`;
  });
  await replyText(message, text, { parseMode: 'HTML' });
}

async function cmdGlobalRanking(message) {
  const rows = await db.select().from(gamePlayers).orderBy(desc(gamePlayers.score)).limit(25).all();
  if (!rows.length) { await replyText(message, `${E.INFO} No scores yet globally.`, { parseMode: 'HTML' }); return; }
  const medals = [E.MEDAL_1, E.MEDAL_2, E.MEDAL_3];
  let text = `${E.GLOBE} <b>Top 25 Players (Global)</b>\n${E.BULLET}\n\n`;
  rows.forEach((p, i) => { text += `${medals[i] || `  ${i + 1}.`} <b>${escapeHtml(p.displayName || 'Unknown')}</b>\n   💰 ${p.score} Xeons\n\n`; });
  await replyText(message, text, { parseMode: 'HTML' });
}

async function cmdMystats(message, userId, user) {
  const rows = await db.select().from(gamePlayers).where(eq(gamePlayers.userId, Number(userId))).all();
  if (!rows.length) { await replyText(message, `${E.INFO} You haven't played any games yet. Use /game to start playing!`, { parseMode: 'HTML' }); return; }
  const total = rows.reduce((s, r) => s + r.score, 0);
  const words = rows.reduce((s, r) => s + r.wordsGuessed, 0);
  const text = `${E.USER} <b>Your Profile</b>\n${E.BULLET}\n\n📝 <b>Name:</b> ${escapeHtml(user.first_name || 'Unknown')}\n💰 <b>Total Xeons:</b> ${total}\n🔤 <b>Words Guessed:</b> ${words}\n🎯 <b>Games Played:</b> ${rows.length}\n\n${E.BULLET}`;
  await replyText(message, text, { parseMode: 'HTML', replyMarkup: buildKeyboard([[btnPrimary('Check Global Ranking', 'sgb:global_ranking', EID.TROPHY)]]) });
}

async function cmdResetData(message, userId) {
  if (!isOwner(userId)) { await replyText(message, `${E.LOCK} This command is owner only.`, { parseMode: 'HTML' }); return; }
  await replyText(message, `${E.SUCCESS} All rankings, stats, and user data have been reset.`, { parseMode: 'HTML' });
}

// ── Text routing ────────────────────────────────
async function handleGroupText(message) {
  // Shadow Word Guess takes priority (leader's word is typed by participants)
  const shadow = await handleShadowGuess(message.chat.id, message.from.id, message.from.first_name || 'Player', message.from.username, message.text || '');
  if (shadow) {
    if (shadow.wasLeader) {
      await replyText(message, `${E.DISAPPROVE} ${mention(message.from.id, shadow.winner_name)} guessed the word!\n\nNo winner this round.\nNo points were awarded.\n\n${E.INFO} A new leader must be selected.`, { parseMode: 'HTML', replyMarkup: buildKeyboard([[btnPrimary('Become Leader', 'sgb:volunteer', EID.USER)]]) });
    } else {
      await replyText(message, `${E.SUCCESS} ${mention(shadow.winnerId, shadow.winnerName)} guessed the word and wins +1 Xeon!\n\n${E.CROWN} New Leader: ${mention(shadow.winnerId, shadow.winnerName)}\n\n${E.ARROW} ${mention(shadow.winnerId, shadow.winnerName)} is explaining the word!`, { parseMode: 'HTML', replyMarkup: buildKeyboard([[btnSuccess('Change Word', 'sgb:change', EID.INFO), btnDefault('Set Word (DM)', 'sgb:setword', EID.FOLDER), btnDanger('End Round', 'sgb:drop', EID.CROSS)]]) });
    }
    return;
  }
  await handleWordSeekGuess(message);
}

async function handlePrivateText(message) {
  const text = (message.text || '').trim();
  if (!text || text.startsWith('/')) return;
  const uid = String(message.from.id);
  const daily = await getState(`daily:${uid}`);
  if (daily) {
    await handleDailyGuess(message, text.toLowerCase(), daily);
    return;
  }
  // Word-set workflow via bot_state
  const pending = await getState(`setword:${uid}`);
  if (pending && text.length <= 50) {
    const ok = await setCustomWord(pending.gameChatId, text.trim());
    await deleteState(`setword:${uid}`);
    if (ok) {
      await replyText(message, `${E.SUCCESS} Your word has been set to:\n\n<code>${escapeHtml(text.trim().toUpperCase())}</code>`, { parseMode: 'HTML' });
      await sendText(pending.gameChatId, `${E.INFO} The current word has been changed by the leader.`, { parseMode: 'HTML' });
    } else {
      await replyText(message, `${E.ERROR} Could not set the word. The game may have ended.`);
    }
    return;
  }
  await replyText(message, `${E.INFO} I'm waiting for an action from a game. Use the game buttons in a group chat to interact with me.`);
}

async function handleDailyGuess(message, guess, daily) {
  const uid = String(message.from.id);
  if (!VALID_WORD_RE.test(guess) || guess.length !== 5) {
    await replyText(message, `${E.ERROR} ${guess.toUpperCase()} is not a valid word.`); return;
  }
  const wordRow = await db.select().from(wsDailyWords).where(eq(wsDailyWords.id, daily.dailyWordId)).get();
  if (!wordRow) { await replyText(message, `${E.ERROR} Today's WordSeek is not available.`); return; }
  const existing = await db.select().from(wsDailyGuesses).where(and(eq(wsDailyGuesses.userId, uid), eq(wsDailyGuesses.dailyWordId, wordRow.id))).all();
  if (existing.some(g => g.guess === guess)) { await replyText(message, `${E.WARNING} You've already guessed this word. Try a different one!`); return; }
  if (!LISTS[5].includes(guess)) { await replyText(message, `${E.ERROR} ${guess.toUpperCase()} is not a valid word.`); return; }
  const attemptNumber = existing.length + 1;
  const now = new Date().toISOString();
  await db.insert(wsDailyGuesses).values({ userId: uid, dailyWordId: wordRow.id, guess, attemptNumber, createdAt: now, updatedAt: now }).run();
  const all = await db.select().from(wsDailyGuesses).where(and(eq(wsDailyGuesses.userId, uid), eq(wsDailyGuesses.dailyWordId, wordRow.id))).all();
  if (guess === wordRow.word) {
    await deleteState(`daily:${uid}`);
    await replyText(message, `${E.SUCCESS} Congratulations! You guessed it in ${all.length} tries!`, { parseMode: 'HTML' });
    return;
  }
  if (all.length >= MAX_DAILY_ATTEMPTS) {
    await deleteState(`daily:${uid}`);
    await replyText(message, `${E.GAME} Game Over! The word was: <b>${wordRow.word.toUpperCase()}</b>`, { parseMode: 'HTML' });
    return;
  }
  const grid = getFeedback(all.map(g => ({ guess: g.guess })), wordRow.word);
  const left = MAX_DAILY_ATTEMPTS - all.length;
  await replyText(message, `<i>Daily WordSeek · ${all.length}/${MAX_DAILY_ATTEMPTS}</i>\n\n${toFancyText(grid)}\n\n${left} ${left === 1 ? 'attempt' : 'attempts'} remaining`, { parseMode: 'HTML' });
}

async function handleWordSeekGuess(message) {
  const text = (message.text || '').trim().toLowerCase();
  if (!text || text.startsWith('/') || !VALID_WORD_RE.test(text)) return;
  const chatId = String(message.chat.id);
  const topicId = message.message_thread_id ? String(message.message_thread_id) : 'general';
  const game = await getWsGame(chatId, topicId);
  if (!game) return;
  const len = game.word.length;
  if (text.length !== len) return;
  const valid = LISTS[len] || [];
  if (valid.length && !valid.includes(text)) { await replyText(message, `${E.ERROR} ${text} is not a valid ${len}-letter word.`, { parseMode: 'HTML' }); return; }
  if (await guessExists(game.id, text)) { await replyText(message, `${E.WARNING} Someone has already guessed your word. Please try another one!`, { parseMode: 'HTML' }); return; }
  const guesses = await getGuesses(game.id);
  if (text === game.word) {
    const score = MAX_REGULAR_GUESSES - guesses.length;
    const uid = String(message.from.id);
    await upsertWsUser(uid, message.from.first_name || 'User', message.from.username);
    await addScore(uid, chatId, score, String(len));
    await replyText(message, `<blockquote>${E.SUCCESS} Congrats! You guessed it correctly.\nCorrect Word: <b>${text}</b>\nAdded ${score} to the leaderboard.</blockquote>\nStart with /new${len}`, { parseMode: 'HTML' });
    await deleteWsGame(game.id);
    return;
  }
  await addGuess(game.id, text, chatId);
  const all = await getGuesses(game.id);
  if (all.length >= MAX_REGULAR_GUESSES) {
    await deleteWsGame(game.id);
    await replyText(message, `${E.GAME} Game Over! The word was <b>${game.word.toUpperCase()}</b>\nYou can start a new game with /new${len}`, { parseMode: 'HTML' });
    return;
  }
  const response = `<i>${MODE_LABEL[len] || `${len}-letter mode`} · ${all.length}/${MAX_REGULAR_GUESSES}</i>\n\n` + toFancyText(getFeedback(all.map(g => ({ guess: g.guess })), game.word));
  await replyText(message, response, { parseMode: 'HTML' });
}

