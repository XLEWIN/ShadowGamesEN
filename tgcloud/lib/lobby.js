// Webapp game lobbies (Ludo/Chess) — shared by bot handlers and Mini App endpoints.
// One open lobby per chat+game; codes are 5 chars, same alphabet as the webapp.

import { db, eq, and, sql, deleteState } from './db.js';
import { webappLobbies } from '../schema.js';
import { E, EID } from './emojis.js';
import { mention, gameBoardUrl } from './texts.js';
import { btnUrl, buildKeyboard } from './keyboards.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const WEBAPP_BASE = 'https://app8670418995.tgcloud.ai/';
export const SESSION_MS = 2 * 60 * 1000; // unstarted join sessions expire after 2 min

export function generateCode() {
  let code = '';
  for (let i = 0; i < 5; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return code;
}

export function roomUrl(game, code, spectate = false) {
  const base = `${WEBAPP_BASE}${game}/`;
  return spectate ? `${base}?spectate=${encodeURIComponent(code)}` : `${base}?room=${encodeURIComponent(code)}`;
}

// Join-based games (chess) go straight to the clubhouse lobby at ?join=CODE.
export function gameJoinUrl(game, code) {
  return `${WEBAPP_BASE}${game}/?join=${encodeURIComponent(code)}`;
}

export function maxPlayersFor(game, requested) {
  const n = Number(requested);
  if (game === 'chess') return 2;
  if (game === 'ludo') return [2, 3, 4].includes(n) ? n : 4;
  return 2;
}

export function isStale(createdAt) {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && Date.now() - t > SESSION_MS;
}

// Lazy expiry: any read of an old unstarted lobby marks it expired.
export async function expireIfStale(lobby) {
  if (!lobby || lobby.status !== 'open' || !isStale(lobby.createdAt)) return lobby;
  await db.update(webappLobbies)
    .set({ status: 'expired', updatedAt: new Date().toISOString() })
    .where(eq(webappLobbies.code, lobby.code)).run();
  await deleteState(`lobby:host:${lobby.code}`);
  lobby.status = 'expired';
  return lobby;
}

export async function getLobby(code) {
  if (!code) return null;
  const row = (await db.select().from(webappLobbies)
    .where(eq(webappLobbies.code, String(code).toUpperCase())).get()) || null;
  return expireIfStale(row);
}

export async function getOpenLobby(chatId, game) {
  const rows = await db.select().from(webappLobbies)
    .where(and(
      eq(webappLobbies.chatId, String(chatId)),
      eq(webappLobbies.game, game),
      eq(webappLobbies.status, 'open'),
    )).all();
  for (const row of rows) await expireIfStale(row);
  return rows.find(r => r.status === 'open') || null;
}

export async function createLobby({ game, creatorId, creatorName = 'Player', creatorPhoto = null, maxPlayers, chatId = null, messageId = null, code = null }) {
  code = code ? String(code).toUpperCase() : generateCode();
  const max = maxPlayersFor(game, maxPlayers);
  const now = new Date().toISOString();
  await db.insert(webappLobbies).values({
    code, game, maxPlayers: max,
    creatorId: Number(creatorId), chatId: chatId === null ? null : String(chatId),
    messageId: messageId ?? null,
    players: [{ userId: Number(creatorId), name: creatorName, photoUrl: creatorPhoto || null }],
    spectators: [], status: 'open', createdAt: now, updatedAt: now,
  }).run();
  return getLobby(code);
}

export async function saveLobby(lobby) {
  await db.update(webappLobbies).set({
    players: lobby.players || [],
    spectators: lobby.spectators || [],
    status: lobby.status || 'open',
    messageId: lobby.messageId ?? null,
    updatedAt: new Date().toISOString(),
  }).where(eq(webappLobbies.code, lobby.code)).run();
  return lobby;
}

export async function setLobbyStatus(code, status) {
  await db.update(webappLobbies).set({ status, updatedAt: new Date().toISOString() })
    .where(eq(webappLobbies.code, code)).run();
}

export async function deleteLobby(code) {
  await db.delete(webappLobbies).where(eq(webappLobbies.code, code)).run();
}

export function joinLobby(lobby, user) {
  const players = Array.isArray(lobby.players) ? [...lobby.players] : [];
  if (players.some(p => Number(p.userId) === Number(user.id))) {
    return { ok: false, already: true, lobby };
  }
  if (lobby.status !== 'open') return { ok: false, full: true, lobby };
  if (players.length >= lobby.maxPlayers) return { ok: false, full: true, lobby };
  players.push({
    userId: Number(user.id),
    name: user.first_name || user.username || 'Player',
    photoUrl: user.photo_url || user.photoUrl || null,
  });
  lobby.players = players;
  return { ok: true, lobby };
}

export function addSpectator(lobby, user) {
  const spectators = Array.isArray(lobby.spectators) ? [...lobby.spectators] : [];
  if (!spectators.some(s => Number(s.userId) === Number(user.id))) {
    spectators.push({ userId: Number(user.id), name: user.first_name || user.username || 'Spectator' });
  }
  lobby.spectators = spectators;
  return lobby;
}

export function isFull(lobby) {
  return (lobby.players?.length || 0) >= lobby.maxPlayers;
}

// Direct Mini App launch — the bot now has a registered Main Web App.
export function startAppLink(game, code, spectate = false) {
  const payload = spectate ? `watch-${game}-${code}` : `${game}-${code}`;
  return `https://t.me/ShadowGameEnBot?startapp=${payload}`;
}

export function parseStartPayload(payload) {
  const parts = String(payload || '').trim().split('-');
  if (!parts.length) return null;
  const watching = parts[0] === 'watch';
  const game = watching ? parts[1] : parts[0];
  const code = (watching ? parts[2] : parts[1] || '').toUpperCase();
  if (!['ludo', 'chess'].includes(game) || !/^[A-Z0-9]{5}$/.test(code)) return null;
  return { game, code, spectate: watching };
}

export function lobbyKeyboard(lobby) {
  return buildKeyboard([
    [
      btnUrl('Join the game', startAppLink(lobby.game, lobby.code), EID.PLAY, 'success'),
      btnUrl('Spectate', startAppLink(lobby.game, lobby.code, true), EID.WATCH, 'primary'),
    ],
    // Bottom row: a real URL (hyperlink-type) button to the board.
    [btnUrl(`Open ${lobby.game.toUpperCase()} board`, gameBoardUrl(lobby.game), EID.GAME, 'primary')],
  ]);
}

export const TAGLINE = 'A little competition never hurt. Pick a table and bring your friends.';

export function inviteText(lobby, inviterName = 'Player', inviterId = 0) {
  const players = Array.isArray(lobby.players) ? lobby.players : [];
  const roster = players.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
  return `${E.SPARKLE} <b>Shadow Games</b>\n\n` +
    `${E.ARROW} <b>VS FRIEND</b> challenge from ${mention(inviterId, inviterName)}\n\n` +
    `${E.INFO} ${TAGLINE}\n\n` +
    `${E.GAME} <b>${lobby.game.toUpperCase()}</b> · ${players.length}/${lobby.maxPlayers} players` +
    (roster ? `\n\n${E.USER} <b>Table</b>\n${roster}` : '') +
    `\n\n${E.WATCH} Spectators are welcome — tap below to join or watch.` +
    `\n<a href="${gameBoardUrl(lobby.game)}">Open ${lobby.game.toUpperCase()} board</a>`;
}
