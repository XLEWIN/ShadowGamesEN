// Register a player who opened a room link in the Mini App.
import { getLobby, createLobby, joinLobby, saveLobby, maxPlayersFor } from '../lib/lobby.js';

export default async function (input = {}, ctx = {}) {
  const user = ctx?.initData?.user;
  if (!user) return { ok: false, error: 'Open this from Telegram.' };
  let lobby = await getLobby(input.code);
  // A fresh inline invite has no lobby yet — the first joiner creates it.
  // An expired lobby is returned by getLobby, so it is never recreated here.
  if (!lobby) {
    const game = input.game === 'ludo' ? 'ludo' : 'chess';
    lobby = await createLobby({
      code: input.code, game, creatorId: user.id,
      creatorName: user.first_name || user.username || 'Player',
      creatorPhoto: user.photo_url || null,
      maxPlayers: maxPlayersFor(game, input.maxPlayers),
    });
  }
  if (lobby.status === 'expired') return { ok: false, expired: true, error: 'Session expired. Ask for a new invite.' };
  const result = joinLobby(lobby, user);
  if (result.ok) await saveLobby(lobby);
  return {
    ok: result.ok, already: !!result.already, full: !!result.full,
    players: lobby.players, maxPlayers: lobby.maxPlayers,
  };
}
