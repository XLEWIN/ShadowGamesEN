// Called by the Mini App host after a PeerJS room is created.
import { getLobby, createLobby, saveLobby } from '../lib/lobby.js';
import { safeCode, safeId, safeText, safeInt } from '../lib/guard.js';

export default async function (input = {}, ctx = {}) {
  const user = ctx?.initData?.user;
  const userId = safeId(user?.id);
  const code = safeCode(input.code);
  if (!user || userId === null || !code) return { ok: false, error: 'Invalid room request.' };
  const game = input.game === 'ludo' ? 'ludo' : 'chess';
  const maxPlayers = game === 'chess' ? 2 : safeInt(input.maxPlayers, { min: 2, max: 4, fallback: 4 });

  let lobby = await getLobby(code);
  if (!lobby) {
    lobby = await createLobby({
      code, game, creatorId: userId,
      creatorName: safeText(user.first_name || user.username, 64) || 'Player',
      creatorPhoto: safeText(user.photo_url, 300) || null,
      maxPlayers,
    });
  } else if (lobby.status === 'expired') {
    return { ok: false, expired: true, error: 'Session expired. Ask for a new invite.' };
  } else {
    lobby.game = game;
    lobby.maxPlayers = maxPlayers;
    if (lobby.status === 'ended') lobby.status = 'open';
    await saveLobby(lobby);
  }
  return { ok: true, code: lobby.code, game: lobby.game, maxPlayers: lobby.maxPlayers };
}
