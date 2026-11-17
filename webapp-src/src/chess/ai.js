// Shadow Games · Chess — AI evaluation (material + PST, negamax α-β)
import { Chess } from './vendor/chess.js';

export const AI_INFO = {
  casual:    { depth: 1, randomness: 0.9, name: 'Bulby' },
  tactician: { depth: 2, randomness: 0.15, name: 'Bomby' },
  master:    { depth: 3, randomness: 0, name: 'Bruno' },
};

const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const PST_PAWN = [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 20,20,25,30,30,25,20,20, 10,10,15,25,25,15,10,10, 5,5,10,20,20,10,5,5, 0,0,0,-5,-5,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0];
const PST_KNIGHT = [-50,-38,-30,-30,-30,-30,-38,-50, -38,-25,0,0,0,0,-25,-38, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -38,-25,0,5,5,0,-25,-38, -50,-38,-30,-30,-30,-30,-38,-50];
const PST_BISHOP = [-20,-10,-10,-10,-10,-10,-10,-20, -10,5,0,0,0,0,5,-10, -10,10,10,10,10,10,10,-10, -10,0,10,10,10,10,0,-10, -10,5,5,10,10,5,5,-10, -10,0,5,5,5,5,0,-10, -10,0,0,0,0,0,0,-10, -20,-10,-10,-10,-10,-10,-10,-20];
const PST_ROOK = [0,0,0,0,0,0,0,0, 8,10,10,10,10,10,10,8, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0];
const PST_QUEEN = [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, -5,0,5,5,5,5,0,-5, -10,0,5,5,5,5,0,-10, -10,0,0,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20];
const PST_KING = [-30,-30,-30,-30,-30,-30,-30,-30, -30,-30,-30,-30,-30,-30,-30,-30, -30,-30,-30,-30,-30,-30,-30,-30, -30,-30,-30,-20,-20,-30,-30,-30, -30,-30,-10,0,0,-10,-30,-30, -30,-30,0,10,10,0,-30,-30, 20,30,10,0,0,10,30,20, 20,30,10,0,0,10,30,20];
const PST = { p: PST_PAWN, n: PST_KNIGHT, b: PST_BISHOP, r: PST_ROOK, q: PST_QUEEN, k: PST_KING };

function pstValue(piece, index) {
  const table = PST[piece.type];
  if (piece.color === 'w') return table[index];
  const row = Math.floor(index / 8), col = index % 8;
  return table[(7 - row) * 8 + col];
}
function evaluate(game) {
  let score = 0;
  const b = game.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = b[r][c];
      if (!p) continue;
      const v = VAL[p.type] + pstValue(p, r * 8 + c);
      score += p.color === 'w' ? v : -v;
    }
  }
  return score;
}

const ORDER_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 99 };
const orderMoves = (moves) => [...moves].sort((a, b) => {
  const ca = (a.captured ? 10 * ORDER_VALUE[a.captured] - ORDER_VALUE[a.piece] : 0) + (a.promotion ? 900 : 0);
  const cb = (b.captured ? 10 * ORDER_VALUE[b.captured] - ORDER_VALUE[b.piece] : 0) + (b.promotion ? 900 : 0);
  return cb - ca;
});

function negamax(game, depth, alpha, beta, sign) {
  if (depth === 0) return sign * evaluate(game);
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) {
    if (game.inCheck()) return -100000 - depth;
    return 0;
  }
  let best = -Infinity;
  for (const m of orderMoves(moves)) {
    game.move(m);
    const score = -negamax(game, depth - 1, -beta, -alpha, -sign);
    game.undo();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export function chooseAiMove(game, difficulty) {
  const info = AI_INFO[difficulty] || AI_INFO.tactician;
  const moves = game.moves({ verbose: true });
  if (!moves.length) return null;
  const sign = game.turn() === 'w' ? 1 : -1;
  const depth = info.depth;
  const scored = [];
  let bestScore = -Infinity;
  for (const m of orderMoves(moves)) {
    game.move(m);
    const s = -negamax(game, depth - 1, -Infinity, Infinity, -sign);
    game.undo();
    scored.push({ m, s });
    if (s > bestScore) bestScore = s;
  }
  if (info.randomness > 0) {
    const window = info.randomness * 80;
    const candidates = scored.filter(x => x.s >= bestScore - window);
    return candidates[Math.floor(Math.random() * candidates.length)].m;
  }
  return scored.reduce((a, b) => (b.s > a.s ? b : a)).m;
}
