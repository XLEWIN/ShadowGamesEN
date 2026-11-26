// Mark a lobby as live when the host starts the match, so expiry no longer applies.
import { getLobby, setLobbyStatus } from '../lib/lobby.js';
import { safeCode, safeId } from '../lib/guard.js';

export default async function (input = {}, ctx = {}) {
  if (safeId(ctx?.initData?.user?.id) === null) return { ok: false, error: 'Open from Telegram.' };
  const code = safeCode(input.code);
  if (!code) return { ok: false, error: 'Invalid room code.' };
  const lobby = await getLobby(code);
  if (!lobby) return { ok: false, error: 'Room not found.' };
  if (lobby.status === 'expired') return { ok: false, expired: true, error: 'Session expired.' };
  if (lobby.status !== 'live') await setLobbyStatus(code, 'live');
  return { ok: true, status: 'live' };
}
