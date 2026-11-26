// Register a spectator for a live lobby.
import { getLobby, addSpectator, saveLobby } from '../lib/lobby.js';
import { safeCode, safeId, safeText } from '../lib/guard.js';

export default async function (input = {}, ctx = {}) {
  const user = ctx?.initData?.user;
  const userId = safeId(user?.id);
  const code = safeCode(input.code);
  if (!user || userId === null || !code) return { ok: false, error: 'Invalid spectate request.' };
  const lobby = await getLobby(code);
  if (!lobby) return { ok: false, error: 'Room not found.' };
  addSpectator(lobby, {
    id: userId,
    name: safeText(user.first_name || user.username, 64) || 'Spectator',
  });
  await saveLobby(lobby);
  return { ok: true, spectators: lobby.spectators };
}
