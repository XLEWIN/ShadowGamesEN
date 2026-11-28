// Host heartbeat while waiting for the second player. A regular read would
// otherwise expire a table the host is actively waiting in.
import { getLobby, saveLobby } from '../lib/lobby.js';
import { safeCode, safeId } from '../lib/guard.js';

export default async function (input = {}, ctx = {}) {
  const uid = safeId(ctx?.initData?.user?.id);
  const code = safeCode(input.code);
  if (uid === null || !code) return { ok: false, error: 'Invalid request.' };
  const lobby = await getLobby(code);
  if (!lobby) return { ok: false, error: 'Room not found.' };
  if (lobby.status !== 'open') return { ok: true, status: lobby.status };
  // Only the player in slot 1 (the host) keeps the table alive.
  const players = Array.isArray(lobby.players) ? lobby.players : [];
  if (players.length && Number(players[0].userId) !== uid) return { ok: true, status: lobby.status };
  await saveLobby(lobby); // touches updatedAt
  return { ok: true, status: lobby.status };
}
