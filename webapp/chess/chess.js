/* Shadow Games Â· Chess â€” foony board + Shadow Games identity.
   Rules engine: vendored chess.js (full legality: castling, en passant,
   promotion, check/checkmate, stalemate, threefold, 50-move, material). */

import { Chess } from './vendor/chess.js';

'use strict';

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Board geometry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const FILES = 'abcdefgh';
const RANKS_WHITE = [8, 7, 6, 5, 4, 3, 2, 1];
const RANKS_BLACK = [1, 2, 3, 4, 5, 6, 7, 8];

const PIECE_IMG = {
  wp: 'assets/chessSetDefault_PawnWhite_160.webp',
  wn: 'assets/chessSetDefault_KnightWhite_160.webp',
  wb: 'assets/chessSetDefault_BishopWhite_160.webp',
  wr: 'assets/chessSetDefault_RookWhite_160.webp',
  wq: 'assets/chessSetDefault_QueenWhite_160.webp',
  wk: 'assets/chessSetDefault_KingWhite_160.webp',
  bp: 'assets/chessSetDefault_PawnBlack_160.webp',
  bn: 'assets/chessSetDefault_KnightBlack_160.webp',
  bb: 'assets/chessSetDefault_BishopBlack_160.webp',
  br: 'assets/chessSetDefault_RookBlack_160.webp',
  bq: 'assets/chessSetDefault_QueenBlack_160.webp',
  bk: 'assets/chessSetDefault_KingBlack_160.webp',
};

const AI_INFO = {
  casual:    { depth: 1, randomness: 0.9, name: 'Bulby' },
  tactician: { depth: 2, randomness: 0.15, name: 'Bomby' },
  master:    { depth: 3, randomness: 0, name: 'Bruno' },
};
const AVATARS = {
  you: 'assets/guest.webp',
  bulby: 'assets/bulby.webp',
  bomby: 'assets/bomby.webp',
  bruno: 'assets/bruno.webp',
  petey: 'assets/petey.webp',
};

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Game state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const state = {
  mode: null,              // 'ai' | 'local' | 'online'
  players: [],             // [{name, color, isBot, isLocal, isRemote}]
  game: new Chess(),
  orientation: 'w',        // 'w' white at bottom | 'b' black at bottom
  selected: null,          // square string e.g. 'e2'
  legalTargets: [],        // [{to, capture, promotion}]
  over: false,
  result: null,            // 'checkmate' | 'stalemate' | 'draw' | ...
  winner: null,            // 'w' | 'b' | null
  difficulty: 'tactician',
  online: null,            // PeerJS session
  muted: false,
  clock: { w: 300, b: 300, inc: 3, active: false, last: 0 },
};

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Audio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
let audioCtx = null;
function tone(freq, dur = 0.08, type = 'triangle', vol = 0.06) {
  if (state.muted) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* ignore */ }
}
const sfx = {
  move: () => tone(520, .06, 'triangle', .06),
  capture: () => { tone(300, .09, 'square', .05); setTimeout(() => tone(210, .12, 'square', .05), 70); },
  check: () => { tone(784, .12, 'sine', .07); setTimeout(() => tone(988, .14, 'sine', .07), 100); },
  castle: () => { tone(392, .08, 'triangle', .06); setTimeout(() => tone(587, .1, 'triangle', .06), 80); },
  promote: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .14, 'triangle', .07), i * 80)),
  illegal: () => tone(150, .09, 'square', .045),
  win: () => [523, 587, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .2, 'triangle', .08), i * 120)),
  draw: () => [392, 330, 294].forEach((f, i) => setTimeout(() => tone(f, .18, 'sine', .06), i * 140)),
};

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Telegram glue â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
function tgReady() {
  if (!tg) return;
  try {
    tg.ready(); tg.expand();
    tg.disableVerticalSwipes && tg.disableVerticalSwipes();
    tg.setHeaderColor && tg.setHeaderColor('#05070f');
    tg.setBackgroundColor && tg.setBackgroundColor('#05070f');
  } catch (e) { /* not in Telegram */ }
}
function tgName() {
  try {
    const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
    return u ? (u.first_name || 'You') : 'You';
  } catch (e) { return 'You'; }
}
function haptic(kind) {
  try { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred(kind || 'light'); } catch (e) { }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ DOM helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const $ = (id) => document.getElementById(id);
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  $(id).classList.add('active');
}
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

/* ────────────────────────── Clocks ────────────────────────── */
const fmtClock = (sec) => {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

function resetClock(seconds, inc) {
  state.clock = { w: seconds, b: seconds, inc, active: true, last: performance.now() };
  updateClockDom();
}

function updateClockDom() {
  document.querySelectorAll('.pcard').forEach(card => {
    const color = card.dataset.color;
    if (!color) return;
    const t = state.clock[color];
    const el = card.querySelector('.pc-clock');
    if (el) {
      el.textContent = fmtClock(t);
      el.classList.toggle('low', t <= 10 && t > 0);
    }
  });
}

let clockInterval = null;
function startClockLoop() {
  stopClockLoop();
  clockInterval = setInterval(() => {
    if (!state.clock.active || state.over) { stopClockLoop(); return; }
    tickClock();
  }, 100);
}
function stopClockLoop() {
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
}

function tickClock() {
  const c = state.clock;
  const now = performance.now();
  let dt = (now - c.last) / 1000;
  c.last = now;
  if (dt > 2) return; // tab was hidden — don't jump the clock
  const active = state.game.turn();
  c[active] = Math.max(0, c[active] - dt);
  if (c[active] <= 0) {
    c.active = false;
    timeoutLoser(active);
    return;
  }
  updateClockDom();
}

function addClockIncrement() {
  const c = state.clock;
  if (!c || !c.active) return;
  const mover = state.game.turn() === 'w' ? 'b' : 'w';
  c[mover] += c.inc;
  c.last = performance.now();
  updateClockDom();
}

function timeoutLoser(loser) {
  const winner = loser === 'w' ? 'b' : 'w';
  state.over = true;
  state.result = 'timeout';
  state.winner = winner;
  stopClockLoop();
  sfx.draw();
  showGameOver();
  if (state.mode === 'online' && state.online?.isHost) broadcastState();
  updateClockDom();
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Board build â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const SQ_LIGHT = 'sq-light', SQ_DARK = 'sq-dark';
let tilesBuilt = false;

function squareColorClass(square) {
  const f = FILES.indexOf(square[0]);
  const r = 8 - parseInt(square[1], 10);
  return (f + r) % 2 === 1 ? SQ_LIGHT : SQ_DARK;
}

function buildBoard() {
  if (tilesBuilt) return;
  tilesBuilt = true;
  const host = $('chess-tiles');
  host.innerHTML = '';
  const ranks = state.orientation === 'w' ? RANKS_WHITE : RANKS_BLACK;
  const files = state.orientation === 'w' ? FILES.split('') : FILES.split('').reverse();
  for (const rank of ranks) {
    for (const file of files) {
      const d = document.createElement('div');
      const sq = file + rank;
      d.className = 'sq ' + squareColorClass(sq);
      d.dataset.square = sq;
      host.appendChild(d);
    }
  }
  // coordinates
  buildCoords();
}

function buildCoords() {
  document.querySelectorAll('.coord').forEach(el => el.remove());
  const board = $('board');
  const files = state.orientation === 'w' ? FILES.split('') : FILES.split('').reverse();
  const ranks = state.orientation === 'w' ? RANKS_WHITE : RANKS_BLACK;
  files.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'coord coord-file';
    d.style.left = (4.6 + (i + 0.5) * (90.8 / 8)) + '%';
    d.textContent = f;
    board.appendChild(d);
  });
  ranks.forEach((r, i) => {
    const d = document.createElement('div');
    d.className = 'coord coord-rank';
    d.style.top = (4.6 + (i + 0.5) * (90.8 / 8)) + '%';
    d.textContent = String(r);
    board.appendChild(d);
  });
}

function tileAt(square) {
  return $('chess-tiles').querySelector(`[data-square="${square}"]`);
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Rendering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function render() {
  const board = state.game.board();   // 8x8, row0 = rank8, cols a..h
  const piecesLayer = $('chess-pieces');
  piecesLayer.innerHTML = '';
  const ranks = state.orientation === 'w' ? RANKS_WHITE : RANKS_BLACK;
  const files = state.orientation === 'w' ? FILES.split('') : FILES.split('').reverse();
  // keep a map square->class for overlays
  document.querySelectorAll('.sq').forEach(el => el.classList.remove('last-move', 'selected', 'in-check'));

  const history = state.game.history({ verbose: true });
  const last = history.length ? history[history.length - 1] : null;
  if (last) {
    const f = tileAt(last.from); if (f) f.classList.add('last-move');
    const t = tileAt(last.to); if (t) t.classList.add('last-move');
  }
  if (state.game.inCheck()) {
    // find the king of the side to move
    const turn = state.game.turn();
    const squares = state.game.board();
    outer: for (const row of squares) {
      for (const p of row) {
        if (p && p.type === 'k' && p.color === turn) {
          const el = tileAt(p.square); if (el) el.classList.add('in-check');
          break outer;
        }
      }
    }
  }
  if (state.selected) {
    const el = tileAt(state.selected); if (el) el.classList.add('selected');
  }

  ranks.forEach((rank, ri) => {
    files.forEach((file, fi) => {
      const piece = board[8 - rank][FILES.indexOf(file)];
      if (!piece) return;
      const key = piece.color + piece.type;
      const el = document.createElement('div');
      el.className = 'piece';
      el.dataset.square = file + rank;
      el.style.left = (fi * 12.5) + '%';
      el.style.top = (ri * 12.5) + '%';
      el.style.backgroundImage = `url('${PIECE_IMG[key]}')`;
      piecesLayer.appendChild(el);
    });
  });

  // legal-target dots
  document.querySelectorAll('.move-dot, .capture-ring').forEach(el => el.remove());
  for (const t of state.legalTargets) {
    const sq = tileAt(t.to);
    if (!sq) continue;
    const dot = document.createElement('div');
    dot.className = t.capture ? 'capture-ring' : 'move-dot';
    sq.appendChild(dot);
  }

  updatePlayerCards();
  updateCaptured();
  updateMoves();
  updateHeader();
}

function updateHeader() {
  const p = currentPlayerModel();
  const pill = $('turn-pill');
  pill.classList.toggle('black-turn', state.game.turn() === 'b' && !state.over);
  $('turn-text').textContent = state.over ? 'Game over' : (p ? `${p.name} to move` : 'To move');
}

function currentPlayerModel() {
  return state.players.find(p => p.color === state.game.turn());
}

function localPlayerModel() {
  return state.players.find(p => p.isLocal);
}

function pieceCount(color) {
  const counts = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
  for (const row of state.game.board()) {
    for (const p of row) if (p && p.color === color) counts[p.type]++;
  }
  return counts;
}
const BASE_COUNTS = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
function capturedBy(color) {
  const mine = pieceCount(color === 'w' ? 'b' : 'w');
  const out = [];
  for (const [t, n] of Object.entries(BASE_COUNTS)) {
    for (let i = 0; i < n - (mine[t] || 0); i++) out.push(t);
  }
  return out;
}

function updateCaptured() {
  const me = localPlayerModel();
  const myColor = me ? me.color : 'w';
  const mineCap = capturedBy(myColor);
  const oppCap = capturedBy(myColor === 'w' ? 'w' : 'b');
  const mk = (t, color) => `<img src="${PIECE_IMG[color + t]}" alt="${t}" />`;
  $('cap-row-you').innerHTML = mineCap.map(t => mk(t, myColor === 'w' ? 'b' : 'w')).join('');
  $('cap-row-opp').innerHTML = oppCap.map(t => mk(t, myColor)).join('');
  const values = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const adv = mineCap.reduce((s, t) => s + values[t], 0) - oppCap.reduce((s, t) => s + values[t], 0);
  $('cap-adv').textContent = adv > 0 ? `+${adv}` : (adv < 0 ? `${adv}` : '');
}

function updateMoves() {
  const hist = state.game.history();
  let html = '';
  for (let i = 0; i < hist.length; i += 2) {
    const n = i / 2 + 1;
    html += `<div><b>${n}.</b> ${escapeHtml(hist[i])}${hist[i + 1] ? ' ' + escapeHtml(hist[i + 1]) : ''}</div>`;
  }
  const el = $('moves-list');
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

function updatePlayerCards() {
  const box = $('player-cards');
  box.innerHTML = '';
  state.players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'pcard' + (state.game.turn() === p.color && !state.over ? ' active' : '');
    const av = p.avatar || AVATARS.you;
    const tag = p.isBot ? 'AI' : (p.isLocal ? 'YOU' : (p.isRemote ? 'OPPONENT' : 'PLAYER'));
    div.dataset.color = p.color;
    div.innerHTML = `<img class="pc-av" src="${av}" alt="" />
      <span class="pc-info"><span class="pc-name">${escapeHtml(p.name)}</span><span class="pc-tag">${tag}</span></span>
      <span class="pc-clock" data-clock="${p.color}">${fmtClock(state.clock[p.color] ?? 0)}</span>`;
    box.appendChild(div);
  });
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Input â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function onSquareTap(ev) {
  const el = (ev.target.closest && (ev.target.closest('.piece') || ev.target.closest('.sq')));
  if (!el || state.over) return;
  const square = el.dataset.square;
  if (!square) return;
  const p = currentPlayerModel();
  const me = localPlayerModel();
  // Whose turn may act: both humans in local mode; only the local seat elsewhere
  const myTurn = (state.mode === 'local') || (me && me.color === state.game.turn());
  if (state.mode !== 'local' && !me) return;
  if (!myTurn) return;
  if (state.mode === 'ai' && p && p.isBot) return;

  // 1. Attempt move to a legal target?
  if (state.selected && state.legalTargets.some(t => t.to === square)) {
    attemptMove(state.selected, square);
    return;
  }

  // 2. Select one of my pieces?
  const piece = state.game.get(square);
  if (piece && piece.color === state.game.turn()) {
    state.selected = square;
    state.legalTargets = state.game.moves({ square, verbose: true }).map(m => ({
      to: m.to,
      capture: !!m.captured,
      promotion: !!m.promotion,
    }));
    haptic('light');
    render();
    return;
  }

  // 3. Deselect
  state.selected = null;
  state.legalTargets = [];
  render();
}

function attemptMove(from, to, promotion) {
  // detect promotion choice needed
  if (!promotion && needsPromotionChoice(from, to)) {
    showPromotionPicker(from, to);
    return;
  }
  const me = localPlayerModel();
  if (state.mode === 'online' && state.online && !state.online.isHost) {
    // guest: send to host
    state.online.conn.send({ type: 'move', from, to, promotion: promotion || 'q' });
    state.selected = null;
    state.legalTargets = [];
    render();
    return;
  }
  const move = { from, to, promotion: promotion || undefined };
  let m;
  try {
    m = state.game.move(move);
  } catch (err) {
    sfx.illegal();
    toast('Illegal move');
    return;
  }
  state.selected = null;
  state.legalTargets = [];
  haptic('medium');
  if (m.captured) sfx.capture(); else sfx.move();
  if (m.flags.includes('k') || m.flags.includes('q')) sfx.castle();
  if (m.promotion) sfx.promote();

  if (state.game.inCheck()) sfx.check();
  onMoveApplied(m);
}

function needsPromotionChoice(from, to) {
  const p = state.game.get(from);
  if (!p || p.type !== 'p') return false;
  const lastRank = p.color === 'w' ? '8' : '1';
  return to[1] === lastRank && state.game.moves({ square: from, verbose: true }).some(m => m.to === to && m.promotion);
}

function showPromotionPicker(from, to) {
  const row = $('promo-row');
  row.innerHTML = '';
  const color = state.game.turn();
  for (const piece of ['q', 'r', 'b', 'n']) {
    const btn = document.createElement('button');
    btn.className = 'promo-piece';
    btn.innerHTML = `<img src="${PIECE_IMG[color + piece]}" alt="${piece}" style="width:100%;height:100%" />`;
    btn.addEventListener('click', () => {
      $('promo-overlay').classList.remove('active');
      haptic('medium');
      attemptMove(from, to, piece);
    });
    row.appendChild(btn);
  }
  $('promo-overlay').classList.add('active');
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Move pipeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function onMoveApplied(m) {
  addClockIncrement();
  checkGameOver();
  if (state.over) { render(); return; }
  const p = currentPlayerModel();
  if (state.mode === 'ai' && p && p.isBot) {
    setTimeout(() => { aiMove(); }, 420);
  }
  if (state.mode === 'online' && state.online?.isHost) broadcastState();
  render();
}

function checkGameOver() {
  const g = state.game;
  if (g.isCheckmate()) {
    state.over = true;
    state.winner = g.turn() === 'w' ? 'b' : 'w';
    state.result = 'checkmate';
  } else if (g.isStalemate()) {
    state.over = true; state.winner = null; state.result = 'stalemate';
  } else if (g.isInsufficientMaterial()) {
    state.over = true; state.winner = null; state.result = 'insufficient';
  } else if (g.isThreefoldRepetition()) {
    state.over = true; state.winner = null; state.result = 'threefold';
  } else if (g.isDrawByFiftyMoves()) {
    state.over = true; state.winner = null; state.result = 'fifty';
  }
  if (state.over) {
    setTimeout(showGameOver, 350);
  }
}

function showGameOver() {
  stopClockLoop();
  state.clock.active = false;
  const kicker = $('win-kicker');
  const title = $('win-title');
  const sub = $('win-sub');
  const me = localPlayerModel();
  const myColor = me ? me.color : 'w';
  const winnerP = state.players.find(p => p.color === state.winner);

  if (state.result === 'checkmate') {
    const youWon = state.winner === myColor;
    kicker.textContent = youWon ? 'VICTORY' : (state.mode === 'ai' ? 'DEFEAT' : 'GAME OVER');
    title.textContent = 'Checkmate!';
    sub.textContent = youWon
      ? (state.mode === 'ai' ? 'You defeated the Shadow AI.' : 'Well played.')
      : (winnerP ? `${winnerP.name} wins.` : 'Better luck next time.');
    if (youWon) sfx.win(); else sfx.draw();
  } else if (state.result === 'timeout') {
    const winnerP = state.players.find(p => p.color === state.winner);
    const youWon = state.winner === myColor;
    kicker.textContent = 'TIME\'S UP';
    title.textContent = 'Flag fall!';
    sub.textContent = winnerP
      ? `${winnerP.name} wins on time.`
      : 'Time expired.';
    if (youWon) sfx.win(); else sfx.draw();
  } else {
    const reasons = {
      stalemate: 'Stalemate', insufficient: 'Insufficient material',
      threefold: 'Threefold repetition', fifty: 'Fifty-move rule',
    };
    kicker.textContent = 'DRAW';
    title.textContent = reasons[state.result] || 'Draw';
    sub.textContent = 'The game ends in a draw.';
    sfx.draw();
  }
  $('win-overlay').classList.add('active');
  if (state.mode === 'online' && state.online?.isHost) broadcastState();
  updatePlayerCards();
  updateHeader();
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ AI engine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
// Piece-square tables (from White's perspective, a1=bottom-left)
const PST = {
  p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 20,20,25,30,30,25,20,20, 10,10,15,25,25,15,10,10, 5,5,10,20,20,10,5,5, 0,0,0,-5,-5,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0],
  n: [-50,-38,-30,-30,-30,-30,-38,-50, -38,-25,0,0,0,0,-25,-38, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -38,-25,0,5,5,0,-25,-38, -50,-38,-30,-30,-30,-30,-38,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,5,0,0,0,0,5,-10, -10,10,10,10,10,10,10,-10, -10,0,10,10,10,10,0,-10, -10,5,5,10,10,5,5,-10, -10,0,5,5,5,5,0,-10, -10,0,0,0,0,0,0,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0, 8,10,10,10,10,10,10,8, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, -5,0,5,5,5,5,0,-5, -10,0,5,5,5,5,0,-10, -10,0,0,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-30,-30,-30,-30,-30,-30,-30, -30,-30,-30,-30,-30,-30,-30,-30, -30,-30,-30,-30,-30,-30,-30,-30, -30,-30,-30,-20,-20,-30,-30,-30, -30,-30,-10,0,0,-10,-30,-30, -30,-30,0,10,10,0,-30,-30, 20,30,10,0,0,10,30,20, 20,30,10,0,0,10,30,20],
};
function pstValue(piece, index) {
  const table = PST[piece.type];
  if (piece.color === 'w') return table[index];
  // mirror vertically for black
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
      const idx = r * 8 + c;
      const v = VAL[p.type] + pstValue(p, idx);
      score += p.color === 'w' ? v : -v;
    }
  }
  return score;
}

const ORDER_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 99 };
function orderMoves(moves) {
  return [...moves].sort((a, b) => {
    const ca = (a.captured ? 10 * ORDER_VALUE[a.captured] - ORDER_VALUE[a.piece] : 0) + (a.promotion ? 900 : 0);
    const cb = (b.captured ? 10 * ORDER_VALUE[b.captured] - ORDER_VALUE[b.piece] : 0) + (b.promotion ? 900 : 0);
    return cb - ca;
  });
}

function negamax(game, depth, alpha, beta, sign) {
  if (depth === 0) return sign * evaluate(game);
  const moves = game.moves({ verbose: true });
  if (moves.length === 0) {
    if (game.inCheck()) return -100000 - depth; // checkmate sooner = worse for us? actually: being mated is bad
    return 0; // stalemate
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

function aiMove() {
  if (state.over) return;
  const info = AI_INFO[state.difficulty] || AI_INFO.tactician;
  const moves = state.game.moves({ verbose: true });
  if (!moves.length) return;
  const depth = info.depth;
  const sign = state.game.turn() === 'w' ? 1 : -1;

  let bestScore = -Infinity;
  const scored = [];
  for (const m of orderMoves(moves)) {
    state.game.move(m);
    const s = -negamax(state.game, depth - 1, -Infinity, Infinity, -sign);
    state.game.undo();
    scored.push({ m, s });
    if (s > bestScore) bestScore = s;
  }
  let chosen;
  if (info.randomness > 0) {
    // pick randomly among moves within a window of the best
    const window = info.randomness * 80; // centipawns
    const candidates = scored.filter(x => x.s >= bestScore - window);
    chosen = candidates[Math.floor(Math.random() * candidates.length)].m;
  } else {
    chosen = scored.reduce((a, b) => (b.s > a.s ? b : a)).m;
  }
  let applied;
  try {
    applied = state.game.move(chosen);
  } catch (e) { return; }
  addClockIncrement();
  haptic('light');
  if (applied.captured) sfx.capture(); else sfx.move();
  if (applied.flags.includes('k') || applied.flags.includes('q')) sfx.castle();
  if (applied.promotion) sfx.promote();
  if (state.game.inCheck()) sfx.check();
  checkGameOver();
  if (!state.over && state.mode === 'online' && state.online?.isHost) broadcastState();
  render();
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Online (PeerJS) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const PEER_PREFIX = 'sgch-';
function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
const discoverOnline = () => typeof Peer !== 'undefined';
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];
const peerConfig = () => ({ debug: 1, config: { iceServers: ICE_SERVERS } });

function renderRoomPlayers(players) {
  const box = $('room-players');
  box.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'room-player';
    div.innerHTML = `<img src="${AVATARS.you}" alt="" />
      <span class="rp-name">${escapeHtml(p.name)}${p.isYou ? ' (You)' : ''}</span>
      <span class="rp-tag">${p.isHost ? 'HOST' : 'JOINED'}</span>`;
    box.appendChild(div);
  });
}

function setOnlineStatus(msg, cls) {
  const el = $('online-status');
  el.textContent = msg || '';
  el.className = 'online-status' + (cls ? ' ' + cls : '');
}

function createRoom() {
  if (!discoverOnline()) { setOnlineStatus('Online unavailable (network). Try vs AI instead.', 'error'); return; }
  const code = makeRoomCode();
  setOnlineStatus('Creating roomâ€¦');
  const peer = new Peer(PEER_PREFIX + code, peerConfig());
  const myName = tgName();
  state.online = { isHost: true, code, peer, conn: null, started: false };
  $('time-room-wrap').classList.remove('hidden');
  $('room-code').textContent = code;
  renderRoomPlayers([{ name: myName, isHost: true, isYou: true }]);
  $('start-online').disabled = true;
  $('start-online').textContent = 'WAITING FOR OPPONENTâ€¦';
  showScreen('screen-room');
  peer.on('open', () => setOnlineStatus('Room ready â€” share the code!', 'ok'));
  peer.on('error', err => setOnlineStatus('Peer error: ' + (err.type || err), 'error'));
  peer.on('connection', conn => {
    if (state.online.conn) { conn.close(); return; }
    conn.on('open', () => {
      state.online.conn = conn;
      conn._name = null;
      conn.on('data', d => hostOnData(d));
      conn.on('close', () => hostOnLeave());
      hostBroadcastRoom();
    });
  });
}

function joinRoom(code) {
  if (!discoverOnline()) { setOnlineStatus('Online unavailable (network).', 'error'); return; }
  code = code.trim().toUpperCase();
  if (code.length !== 5) { setOnlineStatus('Room code must be 5 characters.', 'error'); return; }
  setOnlineStatus('Connectingâ€¦');
  const myName = tgName();
  const peer = new Peer(undefined, peerConfig());
  state.online = { isHost: false, code, peer, conn: null, started: false };
  $('time-room-wrap').classList.add('hidden');
  peer.on('open', () => {
    const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
    state.online.conn = conn;
    conn.on('open', () => {
      conn.send({ type: 'hello', name: myName });
      setOnlineStatus('Connected! Waiting for hostâ€¦', 'ok');
    });
    conn.on('data', d => clientOnData(d));
    conn.on('close', () => { toast('Host disconnected.'); leaveGame(); });
    conn.on('error', () => setOnlineStatus('Connection failed. Check the code.', 'error'));
    showScreen('screen-room');
    $('room-code').textContent = code;
    $('start-online').style.display = 'none';
    renderRoomPlayers([{ name: 'You', isYou: true }]);
  });
  peer.on('error', err => setOnlineStatus('Peer error: ' + (err.type || err) + ' â€” is the code right?', 'error'));
}

function hostBroadcastRoom() {
  const myName = tgName();
  const names = [myName, state.online.conn?._name || 'Opponent'];
  const payload = { type: 'room', players: names.map(n => ({ name: n })) };
  if (state.online.conn) { try { state.online.conn.send(payload); } catch (e) { } }
  renderRoomPlayers(names.map((n, i) => ({ name: n, isHost: i === 0, isYou: i === 0 })));
  $('start-online').disabled = !(state.online.conn);
  if (state.online.conn) $('start-online').textContent = 'START GAME';
}

function hostOnData(data) {
  if (!data || typeof data !== 'object') return;
  if (data.type === 'hello') {
    state.online.conn._name = String(data.name || 'Opponent').slice(0, 24);
    hostBroadcastRoom();
    return;
  }
  if (data.type === 'move' && !state.over) {
    // guest's move â€” validate and apply
    const move = { from: data.from, to: data.to, promotion: data.promotion };
    let m;
    try {
      m = state.game.move(move);
    } catch (e) {
      try { state.online.conn.send({ type: 'illegal' }); } catch (e2) { }
      return;
    }
    addClockIncrement();
    haptic('light');
    if (m.captured) sfx.capture(); else sfx.move();
    if (state.game.inCheck()) sfx.check();
    checkGameOver();
    broadcastState();
    render();
    return;
  }
  if (data.type === 'rematch') {
    resetOnlineMatch();
    return;
  }
}

function hostOnLeave() {
  if (!state.online) return;
  try { state.online.conn.close(); } catch (e) { }
  state.online.conn = null;
  if (!state.online.started) {
    hostBroadcastRoom();
    return;
  }
  toast('Opponent disconnected.');
  state.over = true;
  state.result = 'abandoned';
  state.winner = 'w';
  $('win-kicker').textContent = 'ABANDONED';
  $('win-title').textContent = 'Opponent left';
  $('win-sub').textContent = 'The match is awarded to you.';
  $('win-overlay').classList.add('active');
  render();
}

function resetOnlineMatch() {
  const tSel = $('seg-time-room').querySelector('.selected');
  const seconds = +(tSel?.dataset.t || 300);
  const inc = +(tSel?.dataset.inc || 3);
  state.game = new Chess();
  state.over = false;
  state.result = null;
  state.winner = null;
  state.selected = null;
  state.legalTargets = [];
  resetClock(seconds, inc);
  startClockLoop();
  $('win-overlay').classList.remove('active');
  broadcastState();
  render();
  updateClockDom();
}

function clientOnData(data) {
  if (!data || typeof data !== 'object') return;
  if (data.type === 'room') {
    renderRoomPlayers(data.players.map((p, i) => ({ name: p.name, isHost: i === 0, isYou: i === data.players.length - 1 })));
    return;
  }
  if (data.type === 'start') {
    state.online.started = true;
    state.orientation = 'b';
    startMatch('online', [
      { name: data.players[0].name, color: 'w', isBot: false, isLocal: false, isRemote: true, avatar: AVATARS.you },
      { name: data.players[1].name, color: 'b', isBot: false, isLocal: true, isRemote: false, avatar: AVATARS.you },
    ], { seconds: +(data.clockSeconds || 300), inc: +(data.inc || 3) });
    return;
  }
  if (data.type === 'state') {
    applyRemoteState(data);
    return;
  }
  if (data.type === 'illegal') {
    toast('Illegal move');
    return;
  }
}

function hostStartOnline() {
  if (!state.online || !state.online.isHost || !state.online.conn) return;
  const myName = tgName();
  const opp = state.online.conn._name || 'Opponent';
  const tSel = $('seg-time-room').querySelector('.selected');
  const clockSeconds = +(tSel?.dataset.t || 300);
  const inc = +(tSel?.dataset.inc || 3);
  state.online.started = true;
  state.online.conn.send({ type: 'start', players: [{ name: myName }, { name: opp }], clockSeconds, inc });
  state.orientation = 'w';
  startMatch('online', [
    { name: myName, color: 'w', isBot: false, isLocal: true, isRemote: false, avatar: AVATARS.you },
    { name: opp, color: 'b', isBot: false, isLocal: false, isRemote: true, avatar: AVATARS.you },
  ], { seconds: clockSeconds, inc });
  state.online.syncInterval = setInterval(() => {
    if (!state.online || !state.online.conn || state.over) {
      clearInterval(state.online && state.online.syncInterval);
      return;
    }
    broadcastState();
  }, 2000);
}

function broadcastState() {
  if (!state.online || !state.online.isHost || !state.online.conn) return;
  const payload = {
    type: 'state',
    fen: state.game.fen(),
    history: state.game.history(),
    over: state.over,
    result: state.result,
    winner: state.winner,
    clock: { w: state.clock.w, b: state.clock.b, inc: state.clock.inc },
  };
  try { state.online.conn.send(payload); } catch (e) { }
}

function applyRemoteState(data) {
  state.game = new Chess(data.fen);
  state.over = data.over;
  state.result = data.result;
  state.winner = data.winner;
  state.selected = null;
  state.legalTargets = [];
  const hist = data.history || [];
  // chess.js has no direct set-history; render SAN list manually
  state.remoteHistory = hist;
  if (data.clock) {
    state.clock = {
      w: data.clock.w,
      b: data.clock.b,
      inc: data.clock.inc,
      active: !data.over,
      last: performance.now(),
    };
  }
  $('win-overlay').classList.toggle('active', false);
  render();
  updateClockDom();
  if (state.over) showGameOver();
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Match setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function startMatch(mode, players, clockSpec) {
  const spec = clockSpec || { seconds: 300, inc: 3 };
  state.mode = mode;
  state.players = players;
  state.game = new Chess();
  state.over = false;
  state.result = null;
  state.winner = null;
  state.selected = null;
  state.legalTargets = [];
  $('win-overlay').classList.remove('active');
  $('promo-overlay').classList.remove('active');
  buildBoard();
  showScreen('screen-game');
  resetClock(spec.seconds, spec.inc);
  startClockLoop();
  render();
  updateClockDom();
}

function startAiGame() {
  const diff = $('seg-difficulty').querySelector('.selected').dataset.v;
  state.difficulty = diff;
  const colorChoice = $('pick-color').querySelector('.selected').dataset.v;
  let myColor = colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice;
  const ai = AI_INFO[diff];
  const aiName = ai.name + ' (AI)';
  const aiColor = myColor === 'w' ? 'b' : 'w';
  const players = [
    { name: tgName(), color: myColor, isBot: false, isLocal: true, isRemote: false, avatar: AVATARS.you },
    { name: aiName, color: aiColor, isBot: true, isLocal: false, isRemote: false, avatar: AVATARS[ai.name.toLowerCase()] || AVATARS.bulby },
  ].sort((a, b) => (a.color === 'w' ? -1 : 1) - (b.color === 'w' ? -1 : 1));
  const tSel = $('seg-time-ai').querySelector('.selected');
  state.orientation = myColor;   // human at the bottom
  startMatch('ai', players, { seconds: +(tSel?.dataset.t || 300), inc: +(tSel?.dataset.inc || 3) });
  if (myColor === 'b') {
    setTimeout(() => aiMove(), 500);
  }
}

function startLocalGame() {
  const players = [
    { name: 'Player 1', color: 'w', isBot: false, isLocal: true, isRemote: false, avatar: AVATARS.you },
    { name: 'Player 2', color: 'b', isBot: false, isLocal: true, isRemote: false, avatar: AVATARS.petey },
  ];
  state.orientation = 'w';
  const tSel = $('seg-time-local').querySelector('.selected');
  startMatch('local', players, { seconds: +(tSel?.dataset.t || 300), inc: +(tSel?.dataset.inc || 3) });
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Move-list render for online â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const _origUpdateMoves = updateMoves;
updateMoves = function () {
  if (state.mode === 'online' && !state.online?.isHost && state.remoteHistory) {
    let html = '';
    const h = state.remoteHistory;
    for (let i = 0; i < h.length; i += 2) {
      const n = i / 2 + 1;
      html += `<div><b>${n}.</b> ${escapeHtml(h[i])}${h[i + 1] ? ' ' + escapeHtml(h[i + 1]) : ''}</div>`;
    }
    const el = $('moves-list');
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
    return;
  }
  _origUpdateMoves();
};

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Wire up UI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function bindUI() {
  tgReady();

  $('btn-ai').addEventListener('click', () => { haptic(); showScreen('screen-setup-ai'); });
  $('btn-local').addEventListener('click', () => { haptic(); showScreen('screen-setup-local'); });
  $('btn-online').addEventListener('click', () => { haptic(); showScreen('screen-online'); setOnlineStatus(''); });
  document.querySelectorAll('[data-goto]').forEach(b =>
    b.addEventListener('click', () => { haptic(); showScreen(b.dataset.goto); }));

  for (const id of ['seg-difficulty', 'seg-time-ai', 'seg-time-local', 'seg-time-room']) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('click', e => {
      const btn = e.target.closest('.seg-btn'); if (!btn) return;
      haptic();
      el.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  }
  $('pick-color').addEventListener('click', e => {
    const btn = e.target.closest('button[data-v]'); if (!btn) return;
    haptic();
    $('pick-color').querySelectorAll('button[data-v]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });

  $('start-ai').addEventListener('click', () => { haptic('medium'); startAiGame(); });
  $('start-local').addEventListener('click', () => { haptic('medium'); startLocalGame(); });

  $('btn-create-room').addEventListener('click', () => { haptic(); createRoom(); });
  $('btn-join-room').addEventListener('click', () => { haptic(); joinRoom($('join-code').value); });
  $('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom($('join-code').value); });
  $('copy-code').addEventListener('click', async () => {
    const code = $('room-code').textContent.trim();
    try { await navigator.clipboard.writeText(code); toast('Code copied: ' + code); }
    catch (e) { toast('Code: ' + code); }
  });
  $('start-online').addEventListener('click', () => { haptic('medium'); hostStartOnline(); });
  $('leave-room').addEventListener('click', () => {
    if (state.online?.peer) { try { state.online.peer.destroy(); } catch (e) { } }
    state.online = null;
    showScreen('screen-online');
  });

  $('quit-game').addEventListener('click', () => { haptic(); leaveGame(); });
  $('toggle-sound').addEventListener('click', () => {
    state.muted = !state.muted;
    $('toggle-sound').textContent = state.muted ? 'ðŸ”‡' : 'ðŸ”Š';
    toast(state.muted ? 'Sound off' : 'Sound on');
  });

  $('chess-tiles').addEventListener('pointerdown', onSquareTap);
  $('chess-pieces').addEventListener('pointerdown', onSquareTap);

  $('win-again').addEventListener('click', () => {
    haptic('medium');
    if (state.mode === 'ai') startAiGame();
    else if (state.mode === 'local') startLocalGame();
    else if (state.mode === 'online' && state.online?.isHost) resetOnlineMatch();
    else if (state.mode === 'online' && state.online?.conn) {
      try { state.online.conn.send({ type: 'rematch' }); toast('Rematch requestedâ€¦'); } catch (e) { }
    }
  });
  $('win-menu').addEventListener('click', () => {
    haptic();
    $('win-overlay').classList.remove('active');
    leaveGame();
  });

  window.addEventListener('resize', () => { if ($('screen-game').classList.contains('active')) render(); });
}

function leaveGame() {
  stopClockLoop();
  if (state.online?.syncInterval) clearInterval(state.online.syncInterval);
  if (state.online?.peer) { try { state.online.peer.destroy(); } catch (e) { } }
  state.online = null;
  showScreen('screen-menu');
}

/* Expose a small debug handle (used by automated smoke tests) */
try { window.__chess = { state, render, aiMove, negamax, evaluate: (g) => evaluate(g) }; } catch (e) { }

bindUI();
