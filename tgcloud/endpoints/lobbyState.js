// Live lobby state — used by the spectator view and room screens.
// Also tells each caller whether THEY are the host (player slot 1), so the
// Mini App never lets a late joiner act as a second clock authority.
import { getLobby } from '../lib/lobby.js';
import { getState } from '../lib/db.js';
import { safeCode, safeId } from '../lib/guard.js';

export default async function (input = {}, ctx = {}) {
  const code = safeCode(input.code);
  if (!code) return { ok: false, error: 'Invalid room code.' };
  const lobby = await getLobby(code);
  if (!lobby) return { ok: false, error: 'Room not found.' };
  const players = Array.isArray(lobby.players) ? lobby.players : [];
  const uid = safeId(ctx?.initData?.user?.id);
  return {
    ok: true, code: lobby.code, game: lobby.game,
    maxPlayers: lobby.maxPlayers, status: lobby.status,
    config: await getState(`lobby:cfg:${code}`),
    players,
    spectators: Array.isArray(lobby.spectators) ? lobby.spectators : [],
    playerCount: players.length,
    // Slot 1 is always the creator/host — only they may choose the clock.
    youAreHost: uid !== null && players.length > 0 && Number(players[0].userId) === uid,
  };
}
