// WordSeek game logic + DB helpers (ported from db/wordseek.py + utils/word_selector.py + ws_messages.py)

import { db, eq, and, sql, desc, asc } from 'sdk/db';
import {
  wsGames, wsGuesses, wsLeaderboard, wsUsers, wsUserStats, wsDailyWords, wsDailyGuesses, wsWordHistory,
} from '../schema.js';
import { words4 } from './data/words4.js';
import { words5 } from './data/words5.js';
import { words6 } from './data/words6.js';

export const VALID_WORD_RE = /^[a-z]{4,6}$/;
export const MAX_REGULAR_GUESSES = 30;
export const MAX_DAILY_ATTEMPTS = 6;
export const MODE_LABEL = { 4: '4-letter mode', 5: '5-letter mode', 6: '6-letter mode' };
export const LISTS = { 4: words4, 5: words5, 6: words6 };

// ── fancy text (Wordle feedback) ──────────────────────────────
export function tileStates(guess, solution) {
  const g = guess.toUpperCase(), s = solution.toUpperCase();
  const counts = {};
  for (const ch of s) counts[ch] = (counts[ch] || 0) + 1;
  const out = Array(g.length).fill('absent');
  for (let i = 0; i < g.length; i++) {
    if (g[i] === s[i]) { out[i] = 'correct'; counts[g[i]]--; }
  }
  for (let i = 0; i < g.length; i++) {
    if (out[i] === 'absent' && (counts[g[i]] || 0) > 0) { out[i] = 'present'; counts[g[i]]--; }
  }
  return out;
}

const FANCY = {};
// bold sans-serif unicode digits/letters (ported from utils/fancy_text.py)
const FANCY_UP = [...'𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭'];
const FANCY_LO = [...'𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇'];
const FANCY_DIG = [...'𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵'];
// These glyphs are surrogate pairs — index by code point, not UTF-16 unit,
// otherwise the output has lone surrogates and Telegram rejects the message.
for (let i = 0; i < 26; i++) {
  FANCY[String.fromCharCode(65 + i)] = FANCY_UP[i];
  FANCY[String.fromCharCode(97 + i)] = FANCY_LO[i];
}
for (let i = 0; i < 10; i++) FANCY[String(i)] = FANCY_DIG[i];
export function toFancyText(text) {
  return [...String(text)].map(ch => FANCY[ch] || ch).join('');
}

export function getFeedback(rows, solution) {
  const tiles = { correct: '🟩', present: '🟨', absent: '🟥' };
  return rows.map(r => {
    const states = tileStates(r.guess, solution);
    return states.map(s => tiles[s]).join(' ') + ' ' + r.guess.toUpperCase();
  }).join('\n');
}

// ── DB helpers ────────────────────────────────────────────────
export async function getWsGame(chatId, topicId = 'general') {
  return await db.select().from(wsGames).where(and(eq(wsGames.activeChat, String(chatId)), eq(wsGames.topicId, String(topicId)))).get() || null;
}
export async function getAnyWsGame(chatId) {
  return await db.select().from(wsGames).where(eq(wsGames.activeChat, String(chatId))).get() || null;
}
export async function createWsGame(word, chatId, topicId, startedBy) {
  if (await getWsGame(chatId, topicId)) return null;
  const now = new Date().toISOString();
  const [row] = await db.insert(wsGames).values({ word, activeChat: String(chatId), topicId: String(topicId), startedBy: String(startedBy), createdAt: now, updatedAt: now }).returning().run();
  return row || null;
}
export async function deleteWsGame(id) { await db.delete(wsGames).where(eq(wsGames.id, id)).run(); }
export async function deleteWsGameByChat(chatId) {
  const g = await getAnyWsGame(chatId);
  await db.delete(wsGames).where(eq(wsGames.activeChat, String(chatId))).run();
  return g?.word || null;
}
export async function addGuess(gameId, guess, chatId) {
  const now = new Date().toISOString();
  await db.insert(wsGuesses).values({ guess, gameId, chatId: String(chatId), createdAt: now, updatedAt: now }).run();
}
export async function getGuesses(gameId) {
  return await db.select().from(wsGuesses).where(eq(wsGuesses.gameId, gameId)).orderBy(asc(wsGuesses.id)).all();
}
export async function guessExists(gameId, guess) {
  return !!(await db.select().from(wsGuesses).where(and(eq(wsGuesses.gameId, gameId), eq(wsGuesses.guess, guess))).get());
}
export async function upsertWsUser(id, name, username) {
  const now = new Date().toISOString();
  await db.insert(wsUsers).values({ id: String(id), name, username, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: wsUsers.id, set: { name, username, updatedAt: now } }).run();
}
export async function addScore(userId, chatId, score, wordLength) {
  const now = new Date().toISOString();
  await db.insert(wsLeaderboard).values({ userId: String(userId), chatId: String(chatId), score, wordLength: String(wordLength), createdAt: now, updatedAt: now }).run();
}

// ── Word selection with per-chat history ──────────────────────
export async function getWordHistory(chatId, length) {
  return await db.select().from(wsWordHistory).where(and(eq(wsWordHistory.chatId, String(chatId)), eq(wsWordHistory.wordLength, length))).all();
}
export async function addWordHistory(chatId, length, word) {
  await db.insert(wsWordHistory).values({ chatId: String(chatId), wordLength: length, word, usedAt: new Date().toISOString() })
    .onConflictDoNothing().run();
  // keep last 50
  const rows = await getWordHistory(chatId, length);
  if (rows.length > 50) {
    for (const r of rows.slice(0, rows.length - 50)) {
      await db.delete(wsWordHistory).where(eq(wsWordHistory.id, r.id)).run();
    }
  }
}
export async function getRandomWord(chatId, length = 5) {
  const list = LISTS[length] || LISTS[5];
  if (!list.length) throw new Error('No word list for length ' + length);
  const used = new Set((await getWordHistory(chatId, length)).map(r => r.word));
  let available = list.filter(w => !used.has(w));
  if (available.length < 10) {
    used.clear();
    await db.delete(wsWordHistory).where(and(eq(wsWordHistory.chatId, String(chatId)), eq(wsWordHistory.wordLength, length))).run();
    available = list;
  }
  const word = available[Math.floor(Math.random() * available.length)];
  await addWordHistory(chatId, length, word);
  return word;
}
