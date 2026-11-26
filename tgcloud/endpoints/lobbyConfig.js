// Store the first player's chosen game settings for a join-based lobby.
// Only the host (player slot 1) is allowed to write — late joiners can never
// override the mode that will actually be played.
import { getState, setState } from '../lib/db.js';
import { getLobby } from '../lib/lobby.js';
import { safeCode, safeId, safeInt } from '../lib/guard.js';

export default async function (input = {}, ctx = {}) {
  const uid = safeId(ctx?.initData?.user?.id);
  if (uid === null) return { ok: false, error: 'Open from Telegram.' };
  const code = safeCode(input.code);
  if (!code) return { ok: false, error: 'Invalid room code.' };

  const lobby = await getLobby(code);
  if (lobby) {
    if (lobby.status === 'expired') return { ok: false, expired: true, error: 'Session expired.' };
    const players = Array.isArray(lobby.players) ? lobby.players : [];
    if (players.length && Number(players[0].userId) !== uid) {
      return { ok: false, error: 'Only the host can set the clock.' };
    }
  }
  // No lobby yet: the host is still setting up, so accept the config and let
  // the later lobbyCreate reuse this code.

  const seconds = safeInt(input.seconds, { min: 60, max: 600, fallback: 300 });
  const inc = safeInt(input.inc, { min: 0, max: 30, fallback: 3 });
  await setState(`lobby:cfg:${code}`, { seconds, inc });
  return { ok: true, seconds, inc };
}
