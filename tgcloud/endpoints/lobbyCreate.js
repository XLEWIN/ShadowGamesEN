// Called by the Mini App host after a PeerJS room is created.
import { getLobby, createLobby, saveLobby } from '../lib/lobby.js';

export default async function (input = {}, ctx = {}) {
  const user = ctx?.initData?.user;
  if (!user) return { ok: false, error: 'Open this from Telegram.' };
  const code = String(input.code || '').toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(code)) return { ok: false, error: 'Invalid room code.' };
  const game = input.game === 'ludo' ? 'ludo' : 'chess';
  const maxPlayers = game === 'chess' ? 2 : ([2, 3, 4].includes(Number(input.maxPlayers)) ? Number(input.maxPlayers) : 4);

  let lobby = await getLobby(code);
  if (!lobby) {
    lobby = await createLobby({
      code, game, creatorId: user.id,
      creatorName: user.first_name || user.username || 'Player',
      creatorPhoto: user.photo_url || null,
      maxPlayers,
    });
  } else {
    lobby.game = game;
    lobby.maxPlayers = maxPlayers;
    if (lobby.status === 'ended') lobby.status = 'open';
    await saveLobby(lobby);
  }
  return { ok: true, code: lobby.code, game: lobby.game, maxPlayers: lobby.maxPlayers };
}
