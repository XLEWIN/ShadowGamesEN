// Bridge between the Mini App and tgcloud endpoints for live lobbies.

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

export function spectateCode() {
  return new URLSearchParams(window.location.search).get('spectate') || '';
}

export function roomCode() {
  return new URLSearchParams(window.location.search).get('room') || '';
}
