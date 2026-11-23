// Register a player who opened a room link in the Mini App.
import { getLobby, joinLobby, saveLobby } from '../lib/lobby.js';

export default async function (input = {}, ctx = {}) {
  const user = ctx?.initData?.user;
  if (!user) return { ok: false, error: 'Open this from Telegram.' };
  const lobby = await getLobby(input.code);
  if (!lobby) return { ok: false, error: 'Room not found.' };
  if (lobby.status === 'expired') return { ok: false, expired: true, error: 'Session expired. Ask for a new invite.' };
  const result = joinLobby(lobby, user);
  if (result.ok) await saveLobby(lobby);
  return {
    ok: result.ok, already: !!result.already, full: !!result.full,
    players: lobby.players, maxPlayers: lobby.maxPlayers,
  };
}
