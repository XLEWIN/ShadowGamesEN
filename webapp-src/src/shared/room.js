// Shared room/lobby helpers used by Hub, Ludo and Chess (abstraction layer).

export const ROOM_CODE_RE = /^[A-Z0-9]{5}$/;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function normalizeRoomCode(code) {
  return String(code || '').trim().toUpperCase();
}

export function makeRoomCode() {
  let code = '';
  for (let i = 0; i < 5; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return code;
}

export function roomParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    room: normalizeRoomCode(params.get('room')),
    spectate: normalizeRoomCode(params.get('spectate')),
  };
}

export function roomPageUrl(game, code, spectate = false) {
  return `./${game}/?${spectate ? 'spectate' : 'room'}=${encodeURIComponent(code)}`;
}

export function botDeepLink(game, code, spectate = false) {
  const payload = spectate ? `watch-${game}-${code}` : `${game}-${code}`;
  return `https://t.me/ShadowGameEnBot?start=${payload}`;
}

// A player opening an invite before the host arrives takes over hosting,
// keeping the SAME code the invite was issued with.
export function promoteToHost(onlineRef, code, createRoom, delay = 6000) {
  return setTimeout(() => {
    const o = onlineRef.current;
    if (o && !o.isHost && !o.conn?.open) {
      try { o.peer.destroy(); } catch (e) { /* ignore */ }
      createRoom(code);
    }
  }, delay);
}

export function cancelPromote(timer) {
  if (timer) clearTimeout(timer);
}
