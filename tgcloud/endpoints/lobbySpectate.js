// Register a spectator for a live lobby.
import { getLobby, addSpectator, saveLobby } from '../lib/lobby.js';

export default async function (input = {}, ctx = {}) {
  const user = ctx?.initData?.user;
  if (!user) return { ok: false, error: 'Open this from Telegram.' };
  const lobby = await getLobby(input.code);
  if (!lobby) return { ok: false, error: 'Room not found.' };
  addSpectator(lobby, user);
  await saveLobby(lobby);
  return { ok: true, spectators: lobby.spectators };
}
