// Bridge between the Mini App and tgcloud endpoints for live lobbies.
import { botDeepLink, roomParams } from './room.js';

export function callServer(name, input = {}) {
  return new Promise((resolve) => {
    const tgw = window.Telegram?.WebApp;
    if (!tgw?.Serverless?.call) return resolve(null);
    try {
      tgw.Serverless.call(name, input, (err, result) => resolve(err ? null : result));
    } catch (e) {
      resolve(null);
    }
  });
}

// Open inline mode in a group with the branded Shadow Games challenge.
export function inviteFriends(game, code) {
  const tgw = window.Telegram?.WebApp;
  if (!tgw?.switchInlineQuery) return false;
  try {
    tgw.switchInlineQuery(`invite ${game} ${code}`, ['groups', 'supergroups', 'all_chats']);
    return true;
  } catch (e) {
    return false;
  }
}

// Returns { ok, isHost } — null when the endpoint is unavailable.
export function claimHost(code) {
  return callServer('lobbyClaimHost', { code });
}

// 'alive' | 'expired' | 'unknown' — unknown fails open if the endpoint is slow.
export async function sessionState(code) {
  const state = await Promise.race([
    callServer('lobbyState', { code }),
    new Promise((resolve) => setTimeout(() => resolve(undefined), 2500)),
  ]);
  if (!state) return 'unknown';
  if (!state.ok || state.status === 'expired' || state.status === 'ended') return 'expired';
  return 'alive';
}

export function spectateCode() {
  return roomParams().spectate;
}

export function roomCode() {
  return roomParams().room;
}

export { botDeepLink };
