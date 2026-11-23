// Mark a lobby as live when the host starts the match, so expiry no longer applies.
import { getLobby, setLobbyStatus } from '../lib/lobby.js';

export default async function (input = {}, ctx = {}) {
  if (!ctx?.initData?.user) return { ok: false, error: 'Open from Telegram.' };
  const code = String(input.code || '').toUpperCase();
  const lobby = await getLobby(code);
  if (!lobby) return { ok: false, error: 'Room not found.' };
  if (lobby.status === 'expired') return { ok: false, expired: true, error: 'Session expired.' };
  if (lobby.status !== 'live') await setLobbyStatus(code, 'live');
  return { ok: true, status: 'live' };
}
