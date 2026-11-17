// Shadow Games · Ludo — pure game logic (no DOM). Mirrors the original.

export const ORDER = ['blue', 'yellow', 'green', 'red'];
export const COLORS = {
  red:    { name: 'Red',    hex: '#d64533', light: '#ff8a75', dark: '#6b1a10' },
  yellow: { name: 'Yellow', hex: '#e0bd3a', light: '#ffee9c', dark: '#6e5200' },
  green:  { name: 'Green',  hex: '#27ae5f', light: '#7dffa8', dark: '#064a22' },
  blue:   { name: 'Blue',   hex: '#2f66c4', light: '#8fd0ff', dark: '#0d2748' },
};

export const MAIN_PATH = [
  [6,1],[6,2],[6,3],[6,4],[6,5],
  [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],
  [1,8],[2,8],[3,8],[4,8],[5,8],
  [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],
  [7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],
  [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],
  [13,6],[12,6],[11,6],[10,6],[9,6],
  [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
  [7,0],[6,0],
];
export const START_INDEX = { blue: 0, yellow: 13, green: 26, red: 39 };
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
export const HOME_PATH = {
  blue:   [[7,1],[7,2],[7,3],[7,4],[7,5]],
  yellow: [[1,7],[2,7],[3,7],[4,7],[5,7]],
  green:  [[7,13],[7,12],[7,11],[7,10],[7,9]],
  red:    [[13,7],[12,7],[11,7],[10,7],[9,7]],
};
export const BASE_PCT = {
  blue:   [[11.2,11.2],[28.8,11.2],[11.2,28.8],[28.8,28.8]],
  yellow: [[71.2,11.2],[88.8,11.2],[71.2,28.8],[88.8,28.8]],
  red:    [[11.2,71.2],[28.8,71.2],[11.2,88.8],[28.8,88.8]],
  green:  [[71.2,71.2],[88.8,71.2],[71.2,88.8],[88.8,88.8]],
};
export const FINISH_STEP = 56;
export const HOME_ENTRY_STEP = 51;

export const cellKey = (r, c) => r + ',' + c;
export const MAIN_PATH_INDEX = Object.fromEntries(MAIN_PATH.map((p, i) => [cellKey(p[0], p[1]), i]));
export const HOME_LOOKUP = (() => {
  const m = {};
  for (const color of ORDER) HOME_PATH[color].forEach(([r, c]) => { m[cellKey(r, c)] = color; });
  return m;
})();
export const ARM_FILL = {};
for (const [col, [a, b]] of Object.entries({ blue: [0,4], yellow: [11,17], green: [25,31], red: [36,43] })) {
  for (let i = a; i <= b; i++) ARM_FILL[i] = col;
}

export function freshTokens() {
  const t = {};
  for (const c of ORDER) t[c] = [{ step: -1 }, { step: -1 }, { step: -1 }, { step: -1 }];
  return t;
}

export function legalMoves(tokens, color, dice) {
  const moves = [];
  tokens[color].forEach((tok, i) => {
    if (tok.step === FINISH_STEP) return;
    if (tok.step < 0) { if (dice === 6) moves.push(i); return; }
    if (tok.step + dice <= FINISH_STEP) moves.push(i);
  });
  return moves;
}

export function applyMove(tokens, color, idx, dice) {
  const tok = tokens[color][idx];
  const events = [];
  tok.step = tok.step < 0 ? 0 : tok.step + dice;
  if (tok.step === FINISH_STEP) {
    events.push('finish');
    return events;
  }
  if (tok.step < HOME_ENTRY_STEP) {
    const absCell = (START_INDEX[color] + tok.step) % 52;
    if (!SAFE.has(absCell)) {
      for (const opp of ORDER) {
        if (opp === color) continue;
        tokens[opp].forEach(ot => {
          if (ot.step >= 0 && ot.step < HOME_ENTRY_STEP) {
            const oAbs = (START_INDEX[opp] + ot.step) % 52;
            if (oAbs === absCell) {
              ot.step = -1;
              events.push('capture');
            }
          }
        });
      }
    }
  }
  return events;
}

export function aiPickMove(tokens, color, dice, moves) {
  let best = null, bestScore = -Infinity;
  for (const i of moves) {
    const tok = tokens[color][i];
    let score = Math.random() * 4;
    const newStep = tok.step < 0 ? 0 : tok.step + dice;
    if (newStep === FINISH_STEP) score += 1000;
    else if (tok.step < 0) score += 140;
    else score += newStep * 3;
    if (newStep < HOME_ENTRY_STEP) {
      const absCell = (START_INDEX[color] + newStep) % 52;
      if (!SAFE.has(absCell)) {
        for (const opp of ORDER) {
          if (opp === color) continue;
          for (const ot of tokens[opp]) {
            if (ot.step >= 0 && ot.step < HOME_ENTRY_STEP &&
                (START_INDEX[opp] + ot.step) % 52 === absCell) score += 450;
          }
        }
      } else score += 25;
    }
    if (tok.step < 0) score += 40;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

export function tokenXY(color, token, idx) {
  if (token.step < 0) {
    const [x, y] = BASE_PCT[color][idx];
    return [x, y];
  }
  if (token.step >= FINISH_STEP) {
    const ang = { blue: Math.PI, yellow: -Math.PI / 2, green: 0, red: Math.PI / 2 }[color];
    return [50 + Math.cos(ang) * 2.9, 50 + Math.sin(ang) * 2.9];
  }
  if (token.step >= HOME_ENTRY_STEP) {
    const [r, c] = HOME_PATH[color][token.step - HOME_ENTRY_STEP];
    return [((c + 0.5) / 15) * 100, ((r + 0.5) / 15) * 100];
  }
  const p = MAIN_PATH[(START_INDEX[color] + token.step) % 52];
  return [((p[1] + 0.5) / 15) * 100, ((p[0] + 0.5) / 15) * 100];
}

export function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
export const PEER_PREFIX = 'sglu-';
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];
