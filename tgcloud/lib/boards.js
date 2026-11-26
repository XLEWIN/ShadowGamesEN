// Shared leaderboard / ranking renderers — used by commands and inline buttons.
import { db } from './db.js';
import { wsLeaderboard, wsUsers, gamePlayers, games } from '../schema.js';
import { E, EID } from './emojis.js';
import { btnPrimary, btnSuccess, btnDanger, btnDefault, buildKeyboard } from './keyboards.js';

export const rankMedal = (i) => [E.MEDAL_1, E.MEDAL_2, E.MEDAL_3][i] || `${i + 1}.`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

export async function leaderboardText(chatId, opts = {}) {
  const { global = false, week = false, length = null } = opts;
  let rows = await db.select().from(wsLeaderboard).all();
  if (!global) rows = rows.filter(r => r.chatId === String(chatId));
  if (length) rows = rows.filter(r => r.wordLength === String(length));
  if (week) rows = rows.filter(r => Date.now() - Date.parse(r.createdAt) < 7 * 86400000);
  const totals = new Map();
  for (const r of rows) totals.set(r.userId, (totals.get(r.userId) || 0) + r.score);
  if (!totals.size) return `${E.INFO} No WordSeek scores yet${global ? '' : ' in this chat'}. Play with /new5 to get on the board.`;
  const users = await db.select().from(wsUsers).all();
  const names = new Map(users.map(u => [u.id, u.name]));
  const board = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  const scope = [global ? 'Global' : 'This Chat', week ? 'This Week' : 'All Time', length ? `${length}-letter` : null].filter(Boolean).join(' · ');
  let text = `${E.TROPHY} <b>WordSeek Leaderboard</b>\n${E.BULLET}\n\n${E.INFO} <b>${scope}</b>\n\n`;
  board.forEach(([uid, score], i) => {
    text += `${rankMedal(i)} <b>${esc(names.get(uid) || `Player ${uid}`)}</b>\n   ${E.TROPHY} ${score} Xeons\n\n`;
  });
  return text;
}

export async function shadowRankingText(chatId = null) {
  const allGames = await db.select().from(games).all();
  const ids = new Set(allGames.filter(g => chatId === null || String(g.chatId) === String(chatId)).map(g => g.id));
  const players = await db.select().from(gamePlayers).all();
  const totals = new Map();
  for (const p of players) {
    if (!ids.has(p.gameId)) continue;
    const cur = totals.get(p.userId) || { score: 0, words: 0, name: 'Unknown' };
    cur.score += p.score || 0;
    cur.words += p.wordsGuessed || 0;
    if (p.displayName && cur.name === 'Unknown') cur.name = p.displayName;
    totals.set(p.userId, cur);
  }
  const board = [...totals.entries()].map(([userId, v]) => ({ userId, ...v }))
    .sort((a, b) => b.score - a.score).slice(0, 25);
  if (!board.length) return `${E.INFO} No Shadow Word scores${chatId === null ? ' yet globally' : ' in this chat'} yet. Play with /game to get on the board.`;
  let text = `${chatId === null ? E.GLOBE : E.TROPHY} <b>Top 25 Players (${chatId === null ? 'Global' : 'This Chat'})</b>\n${E.BULLET}\n\n`;
  board.forEach((p, i) => {
    text += `${rankMedal(i)} <b>${esc(p.name)}</b>\n   ${E.TROPHY} ${p.score} Xeons · ${E.GAME} ${p.words} words\n\n`;
  });
  return text;
}

export async function mystatsText(userId, name = 'Player') {
  const shadow = await db.select().from(gamePlayers).all();
  const mine = shadow.filter(p => p.userId === Number(userId));
  const ws = (await db.select().from(wsLeaderboard).all()).filter(r => String(r.userId) === String(userId));
  const shadowXeons = mine.reduce((s, r) => s + (r.score || 0), 0);
  const wsXeons = ws.reduce((s, r) => s + (r.score || 0), 0);
  const words = mine.reduce((s, r) => s + (r.wordsGuessed || 0), 0);
  if (!mine.length && !ws.length) return `${E.INFO} You haven't played yet. Use /new5 for WordSeek or /game for Shadow Word.`;
  return `${E.USER} <b>Your Profile</b>\n${E.BULLET}\n\n` +
    `${E.INFO} <b>Name:</b> ${esc(name)}\n` +
    `${E.TROPHY} <b>Shadow Word Xeons:</b> ${shadowXeons}\n` +
    `${E.TROPHY} <b>WordSeek Xeons:</b> ${wsXeons}\n` +
    `${E.TROPHY} <b>Total Xeons:</b> ${shadowXeons + wsXeons}\n` +
    `${E.GAME} <b>Words Guessed:</b> ${words}\n` +
    `${E.PLAY} <b>Games Played:</b> ${mine.length + ws.length}\n\n${E.BULLET}`;
}

export function leaderboardKeyboard(active = {}) {
  const on = (key) => active[key] ? 'success' : null;
  return buildKeyboard([
    [
      btnPrimary('This Chat', 'board:chat', EID.USER, on('chat') || 'primary'),
      btnPrimary('Global', 'board:global', EID.GLOBE, on('global') || 'primary'),
      btnPrimary('This Week', 'board:week', EID.TIME, on('week') || 'primary'),
    ],
    [
      btnDefault('4 letters', 'board:4', EID.NUMBER_1, on('4') || 'primary'),
      btnDefault('5 letters', 'board:5', EID.STAR, on('5') || 'primary'),
      btnDefault('6 letters', 'board:6', EID.CIRCLE, on('6') || 'primary'),
    ],
    [btnSuccess('Shadow Word Ranking', 'board:shadow', EID.TROPHY)],
  ]);
}

export function rankingKeyboard() {
  return buildKeyboard([
    [btnPrimary('Global Ranking', 'sgb:global_ranking', EID.TROPHY)],
    [btnDefault('My Stats', 'board:mystats', EID.USER, 'primary')],
    [btnDanger('WordSeek Board', 'board:chat', EID.INFO)],
  ]);
}
