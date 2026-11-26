// Live lobby state — used by the spectator view and room screens.
import { getLobby } from '../lib/lobby.js';
import { getState } from '../lib/db.js';
import { safeCode } from '../lib/guard.js';

export default async function (input = {}) {
  const code = safeCode(input.code);
  if (!code) return { ok: false, error: 'Invalid room code.' };
  const lobby = await getLobby(code);
  if (!lobby) return { ok: false, error: 'Room not found.' };
  return {
    ok: true, code: lobby.code, game: lobby.game,
    maxPlayers: lobby.maxPlayers, status: lobby.status,
    config: await getState(`lobby:cfg:${code}`),
    players: Array.isArray(lobby.players) ? lobby.players : [],
    spectators: Array.isArray(lobby.spectators) ? lobby.spectators : [],
  };
}
