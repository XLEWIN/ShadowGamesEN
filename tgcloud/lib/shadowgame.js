// Word Guess game engine — port of core/engine.py + db/{games,words,players}.py
import { db, eq, and, sql, desc } from 'sdk/db';
import { games, rounds, gamePlayers, words, usedWords } from '../schema.js';
import { default_words_normal } from './data/default_words_normal.js';
import { default_words_fiction } from './data/default_words_fiction.js';

const normalize = (w) => String(w || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export async function getActiveGame(chatId) {
  return await db.select().from(games).where(and(eq(games.chatId, Number(chatId)), eq(games.gameActive, 1))).get() || null;
}

export async function createGame(chatId, creatorId, chatName, category = 'normal') {
  const now = new Date().toISOString();
  const [row] = await db.insert(games).values({
    chatId: Number(chatId), chatName: chatName || null, category,
    gameActive: 1, createdAt: now, updatedAt: now,
  }).returning().run();
  return row;
}

export async function endGame(chatId) {
  const g = await getActiveGame(chatId);
  if (!g) return false;
  const now = new Date().toISOString();
  await db.update(games).set({ gameActive: 0, updatedAt: now }).where(eq(games.id, g.id)).run();
  await db.update(rounds).set({ status: 'ENDED', endedAt: now })
    .where(and(eq(rounds.gameId, g.id), eq(rounds.status, 'ACTIVE'))).run();
  return true;
}

export async function setLeader(chatId, userId) {
  const g = await getActiveGame(chatId);
  if (!g) return;
  await db.update(games).set({ currentLeaderId: userId, updatedAt: new Date().toISOString() }).where(eq(games.id, g.id)).run();
}
export async function setRound(chatId, roundId) {
  const g = await getActiveGame(chatId);
  if (!g) return;
  await db.update(games).set({ currentRoundId: roundId, updatedAt: new Date().toISOString() }).where(eq(games.id, g.id)).run();
}
export async function resetLeaderSelection(chatId) {
  const g = await getActiveGame(chatId);
  if (!g) return;
  await db.update(games).set({ currentLeaderId: null, currentRoundId: null, updatedAt: new Date().toISOString() }).where(eq(games.id, g.id)).run();
}

async function addOrUpdatePlayer(gameId, userId, displayName, username) {
  const now = new Date().toISOString();
  await db.insert(gamePlayers).values({
    gameId, userId: Number(userId), displayName, username: username || null,
    score: 0, wordsGuessed: 0, createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({
    target: [gamePlayers.gameId, gamePlayers.userId],
    set: { displayName, username: username || null, updatedAt: now },
  }).run();
}

async function pickWord(gameId, category, exclude) {
  const pool = (category === 'fiction' ? default_words_fiction : default_words_normal)
    .filter(w => normalize(w) !== normalize(exclude));
  const usedRows = await db.select().from(usedWords).where(eq(usedWords.gameId, gameId)).all();
  const used = new Set(usedRows.map(r => r.wordNormalized));
  let available = pool.filter(w => !used.has(normalize(w)));
  if (!available.length) available = pool;
  const word = available[Math.floor(Math.random() * available.length)];
  const now = new Date().toISOString();
  await db.insert(usedWords).values({ gameId, wordNormalized: normalize(word), usedAt: now }).onConflictDoNothing().run();
  return word;
}

async function createRound(gameId, word, leaderId) {
  const now = new Date().toISOString();
  const [row] = await db.insert(rounds).values({
    gameId, word, leaderId: Number(leaderId), status: 'ACTIVE', startedAt: now,
  }).returning().run();
  return row;
}

export async function startNewGame(chatId, userId, displayName, username, chatName, category = 'normal') {
  const game = await createGame(chatId, userId, chatName, category);
  await addOrUpdatePlayer(game.id, userId, displayName, username);
  const word = await pickWord(game.id, category, null);
  const round = await createRound(game.id, word, userId);
  await setLeader(chatId, userId);
  await setRound(chatId, round.id);
  return { game, round, word };
}

export async function dropLead(chatId) {
  const g = await getActiveGame(chatId);
  if (!g) return false;
  if (g.currentRoundId) await endRound(g.currentRoundId, null);
  await resetLeaderSelection(chatId);
  return true;
}

export async function getRoundWord(roundId) {
  const row = await db.select().from(rounds).where(eq(rounds.id, roundId)).get();
  return row?.word || null;
}

export async function handleGuess(chatId, userId, displayName, username, text) {
  const game = await getActiveGame(chatId);
  if (!game || !game.currentLeaderId || !game.currentRoundId) return null;
  const word = await getRoundWord(game.currentRoundId);
  if (!word) return null;
  const norm = normalize(text);
  if (Number(userId) === Number(game.currentLeaderId)) {
    if (norm === normalize(word)) {
      await endRound(game.currentRoundId, null);
      await resetLeaderSelection(chatId);
      return { wasLeader: true, winnerId: null, winnerName: displayName };
    }
    return null;
  }
  if (norm !== normalize(word)) return null;
  if (!await endRound(game.currentRoundId, userId)) return null;
  await db.update(gamePlayers).set({
    score: sql`${gamePlayers.score} + 1`,
    wordsGuessed: sql`${gamePlayers.wordsGuessed} + 1`,
  }).where(and(eq(gamePlayers.gameId, game.id), eq(gamePlayers.userId, Number(userId)))).run();
  await setLeader(chatId, userId);
  const newWord = await pickWord(game.id, game.category, word);
  const newRound = await createRound(game.id, newWord, userId);
  await setRound(chatId, newRound.id);
  await addOrUpdatePlayer(game.id, userId, displayName, username);
  return { wasLeader: false, winnerId: userId, winnerName: displayName, newWord, game };
}

async function endRound(roundId, winnerId) {
  const now = new Date().toISOString();
  const result = await db.update(rounds).set({ status: 'ENDED', winnerId, endedAt: now })
    .where(and(eq(rounds.id, roundId), eq(rounds.status, 'ACTIVE'))).run();
  return result.rowsAffected > 0;
}

export async function changeWord(chatId) {
  const g = await getActiveGame(chatId);
  if (!g?.currentRoundId) return null;
  const round = await db.select().from(rounds).where(eq(rounds.id, g.currentRoundId)).get();
  if (!round || round.status !== 'ACTIVE') return null;
  const newWord = await pickWord(g.id, g.category, round.word);
  await db.update(rounds).set({ word: newWord }).where(eq(rounds.id, g.currentRoundId)).run();
  return newWord;
}

export async function setCustomWord(chatId, newWord) {
  const g = await getActiveGame(chatId);
  if (!g?.currentRoundId) return false;
  const round = await db.select().from(rounds).where(eq(rounds.id, g.currentRoundId)).get();
  if (!round || round.status !== 'ACTIVE') return false;
  await db.update(rounds).set({ word: newWord }).where(eq(rounds.id, g.currentRoundId)).run();
  return true;
}

export async function volunteerLeader(chatId, userId, displayName, username) {  const g = await getActiveGame(chatId);
  if (!g || g.currentLeaderId !== null) return null;
  const now = new Date().toISOString();
  const res = await db.update(games).set({ currentLeaderId: Number(userId), updatedAt: now })
    .where(and(eq(games.id, g.id), eq(games.currentLeaderId, null))).run();
  if (!res.rowsAffected) return null;
  const word = await pickWord(g.id, g.category, null);
  const round = await createRound(g.id, word, userId);
  await setRound(chatId, round.id);
  await addOrUpdatePlayer(g.id, userId, displayName, username);
  return { word };
}

export async function getScoreboard(chatId) {
  const g = await getActiveGame(chatId);
  if (!g) return [];
  return await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, g.id))
    .orderBy(desc(gamePlayers.score)).all();
}
