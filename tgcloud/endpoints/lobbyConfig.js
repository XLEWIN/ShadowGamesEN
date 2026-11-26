// Store the first player's chosen game settings for a join-based lobby.
import { getState, setState } from '../lib/db.js';
import { getLobby } from '../lib/lobby.js';
import { safeCode, safeInt } from '../lib/guard.js';

export default async function (input = {}, ctx = {}) {
  if (!ctx?.initData?.user) return { ok: false, error: 'Open from Telegram.' };
  const code = safeCode(input.code);
  if (!code) return { ok: false, error: 'Invalid room code.' };
  const lobby = await getLobby(code);
  if (!lobby || lobby.status === 'expired') return { ok: false, error: 'Room not available.' };
  const seconds = safeInt(input.seconds, { min: 60, max: 600, fallback: 300 });
  const inc = safeInt(input.inc, { min: 0, max: 30, fallback: 3 });
  await setState(`lobby:cfg:${code}`, { seconds, inc });
  return { ok: true, seconds, inc };
}
