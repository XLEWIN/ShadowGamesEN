// Register a player who opened a room link in the Mini App.
import { getLobby, createLobby, joinLobby, saveLobby, maxPlayersFor } from '../lib/lobby.js';
import { safeCode, safeId, safeText, safeInt } from '../lib/guard.js';

export default async function (input = {}, ctx = {}) {
  const user = ctx?.initData?.user;
  const userId = safeId(user?.id);
  const code = safeCode(input.code);
  if (!user || userId === null || !code) return { ok: false, error: 'Invalid join request.' };
  let lobby = await getLobby(code);
  // A fresh inline invite has no lobby yet — the first joiner creates it.
  // An expired lobby is returned by getLobby, so it is never recreated here.
  if (!lobby) {
    const game = input.game === 'ludo' ? 'ludo' : 'chess';
    lobby = await createLobby({
      code, game, creatorId: userId,
      creatorName: safeText(user.first_name || user.username, 64) || 'Player',
      creatorPhoto: safeText(user.photo_url, 300) || null,
      maxPlayers: maxPlayersFor(game, safeInt(input.maxPlayers, { min: 2, max: 4, fallback: 4 })),
    });
  }
  if (lobby.status === 'expired') return { ok: false, expired: true, error: 'Session expired. Ask for a new invite.' };
  const result = joinLobby(lobby, {
    id: userId,
    first_name: safeText(user.first_name, 64),
    username: safeText(user.username, 32),
    photo_url: safeText(user.photo_url, 300),
  });
  if (result.ok) await saveLobby(lobby);
  return {
    ok: result.ok, already: !!result.already, full: !!result.full,
    players: lobby.players, maxPlayers: lobby.maxPlayers,
  };
}
