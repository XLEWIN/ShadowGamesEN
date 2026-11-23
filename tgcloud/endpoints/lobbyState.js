// Live lobby state — used by the spectator view and room screens.
import { getLobby } from '../lib/lobby.js';

export default async function (input = {}) {
  const lobby = await getLobby(input.code);
  if (!lobby) return { ok: false, error: 'Room not found.' };
  return {
    ok: true, code: lobby.code, game: lobby.game,
    maxPlayers: lobby.maxPlayers, status: lobby.status,
    players: Array.isArray(lobby.players) ? lobby.players : [],
    spectators: Array.isArray(lobby.spectators) ? lobby.spectators : [],
  };
}
