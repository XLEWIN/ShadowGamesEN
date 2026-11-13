/* Shadow Games · Ludo — original implementation (board, rules, AI, online rooms) */
'use strict';

/* ────────────────────────── Board geometry (15×15 grid) ────────────────────────── */
const ORDER = ['blue', 'yellow', 'green', 'red'];
const COLORS = {
  red:    { name: 'Red',    hex: '#d64533', dark: '#6b1a10', light: '#ff8a75', text: '#2b0505' },
  yellow: { name: 'Yellow', hex: '#e0bd3a', dark: '#6e5200', light: '#ffee9c', text: '#2b1c04' },
  green:  { name: 'Green',  hex: '#27ae5f', dark: '#064a22', light: '#7dffa8', text: '#052b12' },
  blue:   { name: 'Blue',   hex: '#2f5fb8', dark: '#0d2748', light: '#8fd0ff', text: '#041a30' },
};
const AVATARS = {
  red: 'assets/petey.webp',
  yellow: 'assets/bomby.webp',
  green: 'assets/bruno.webp',
  blue: 'assets/bulby.webp',
};
const avatarFor = (pl) => (pl && pl.isBot) ? (AVATARS[pl.color] || 'assets/guest.webp') : 'assets/guest.webp';

// 52 main path cells, clockwise-ish, starting at Red's entry square.
const MAIN_PATH = [
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
const START_INDEX = { blue: 0, yellow: 13, green: 26, red: 39 };
// Path indices that are safe from capture (starts + star cells).
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

const HOME_PATH = {
  blue:   [[7,1],[7,2],[7,3],[7,4],[7,5]],
  yellow: [[1,7],[2,7],[3,7],[4,7],[5,7]],
  green:  [[7,13],[7,12],[7,11],[7,10],[7,9]],
  red:    [[13,7],[12,7],[11,7],[10,7],[9,7]],
};

const BASE_SPOTS = {
  blue:   [[1.7,1.7],[1.7,4.3],[4.3,1.7],[4.3,4.3]],
  yellow: [[1.7,10.7],[1.7,13.3],[4.3,10.7],[4.3,13.3]],
  red:    [[10.7,1.7],[10.7,4.3],[13.3,1.7],[13.3,4.3]],
  green:  [[10.7,10.7],[10.7,13.3],[13.3,10.7],[13.3,13.3]],
};

const FINISH_STEP = 56;      // a pawn reaching this step is home
const HOME_ENTRY_STEP = 51;  // steps 51..55 are the home stretch

/* ────────────────────────── Game state ────────────────────────── */
const state = {
  mode: null,            // 'bots' | 'local' | 'online'
  players: [],           // [{color, name, isBot, isLocal, isRemote, peerId?}]
  tokens: {},            // color -> [{step: -1|0..56}]  (-1 = base)
  turnIdx: 0,
  sixes: 0,
  dice: null,
  awaitingMove: false,
  busy: false,
  over: false,
  winner: null,
  highlight: [],         // pawn indices of current player that can move
  online: null,          // PeerJS session
  muted: false,
};

const currentPlayer = () => state.players[state.turnIdx];
const currentColor = () => currentPlayer()?.color;

function freshTokens() {
  const t = {};
  for (const c of ORDER) t[c] = [{ step: -1 }, { step: -1 }, { step: -1 }, { step: -1 }];
  return t;
}

/* ────────────────────────── Audio (WebAudio, no assets) ────────────────────────── */
let audioCtx = null;
function tone(freq, dur = 0.09, type = 'square', vol = 0.05) {
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
  } catch (e) { /* audio unavailable */ }
}
const sfx = {
  roll: () => { tone(300, .07); setTimeout(() => tone(420, .07), 70); setTimeout(() => tone(520, .09), 140); },
  move: () => tone(660, .06, 'triangle', .06),
  capture: () => { tone(180, .15, 'sawtooth', .07); setTimeout(() => tone(120, .2, 'sawtooth', .07), 110); },
  home: () => { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, .14, 'triangle', .07), i * 90)); },
  win: () => { [523, 587, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .22, 'triangle', .08), i * 130)); },
  illegal: () => tone(140, .1, 'square', .05),
};

/* ────────────────────────── Telegram Mini App glue ────────────────────────── */
const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
function tgReady() {
  if (!tg) return;
  try {
    tg.ready(); tg.expand();
    tg.disableVerticalSwipes && tg.disableVerticalSwipes();
    tg.setHeaderColor && tg.setHeaderColor('#120a1e');
    tg.setBackgroundColor && tg.setBackgroundColor('#120a1e');
  } catch (e) { /* not in Telegram — fine */ }
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

/* ────────────────────────── DOM helpers ────────────────────────── */
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

function setBanner(msg, ms = 2600) {
  const el = $('turn-banner');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = 'All pawns start in base.'; }, ms);
}

/* ────────────────────────── Dice rendering ────────────────────────── */
const PIP_LAYOUTS = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};
function drawDie(n) {
  const face = $('dice-face');
  face.innerHTML = '';
  const cells = new Array(9).fill(false);
  (PIP_LAYOUTS[n] || []).forEach(i => cells[i] = true);
  for (let i = 0; i < 9; i++) {
    const d = document.createElement('div');
    if (cells[i]) d.className = 'pip';
    face.appendChild(d);
  }
}

/* ────────────────────────── Board rendering ────────────────────────── */
const canvas = () => $('board');
const ctx2d = () => canvas().getContext('2d');
let cell = 32, originX = 0, originY = 0, dpr = 1;

function boardSize() {
  return Math.min(window.innerWidth - 16, window.innerHeight * 0.66, 640);
}
function fitCanvas() {
  const size = boardSize();
  dpr = Math.max(1, window.devicePixelRatio || 1);
  const c = canvas();
  c.style.width = size + 'px';
  c.style.height = size + 'px';
  c.width = Math.round(size * dpr);
  c.height = Math.round(size * dpr);
  cell = size / 15;
  originX = 0; originY = 0;
}

const cellXY = (r, c) => [originX + (c + 0.5) * cell, originY + (r + 0.5) * cell];

function drawBoard(highlightTokens) {
  const c = canvas();
  const g = ctx2d();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const S = cell * 15;

  // background panel
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#171226';
  roundRect(g, 0, 0, S, S, cell * 0.5);
  g.fill();

  // base yards (foony layout: TL blue, TR yellow, BL red, BR green)
  drawYard(g, 0, 0, COLORS.blue, '#16324f', '#234b71');
  drawYard(g, 0, 9, COLORS.yellow, '#3f3106', '#584510');
  drawYard(g, 9, 0, COLORS.red, '#471510', '#5f211a');
  drawYard(g, 9, 9, COLORS.green, '#06301c', '#0c4a2a');

  // main path cells
  const START_FILL = { 0: COLORS.blue.hex, 13: COLORS.yellow.hex, 26: COLORS.green.hex, 39: COLORS.red.hex };
  MAIN_PATH.forEach(([r, cIdx], i) => {
    const fill = START_FILL[i] || '#d9d9de';
    drawCell(g, r, cIdx, fill);
    if (SAFE.has(i)) drawStar(g, r, cIdx, START_FILL[i] ? '#f2c832' : '#8b8b94');
  });

  // home stretches
  for (const color of ORDER) {
    HOME_PATH[color].forEach(([r, cIdx]) => drawCell(g, r, cIdx, COLORS[color].hex));
  }

  // center: 4 triangles (pinwheel) + gold coin
  const mid = cell * 7.5;
  const tri = (pts, fill) => { g.fillStyle = fill; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); g.fill(); };
  tri([[mid, mid], [cell * 6, cell * 6], [cell * 6, cell * 9]], COLORS.blue.hex);
  tri([[mid, mid], [cell * 6, cell * 6], [cell * 9, cell * 6]], COLORS.yellow.hex);
  tri([[mid, mid], [cell * 9, cell * 6], [cell * 9, cell * 9]], COLORS.green.hex);
  tri([[mid, mid], [cell * 6, cell * 9], [cell * 9, cell * 9]], COLORS.red.hex);
  g.fillStyle = '#14101f';
  g.beginPath(); g.arc(mid, mid, cell * 1.02, 0, Math.PI * 2); g.fill();
  g.strokeStyle = COLORS.yellow.hex; g.lineWidth = cell * 0.09; g.stroke();
  g.fillStyle = COLORS.yellow.hex;
  g.font = `900 ${cell * 0.8}px 'Exo 2', sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('SG', mid, mid + cell * 0.05);

  // grid lines over path area
  g.strokeStyle = 'rgba(10, 10, 16, 0.4)';
  g.lineWidth = 1;
  for (const [r, cIdx] of MAIN_PATH) strokeCell(g, r, cIdx);
  for (const color of ORDER) for (const [r, cIdx] of HOME_PATH[color]) strokeCell(g, r, cIdx);

  // tokens
  drawTokens(g, highlightTokens || new Set());
}

function drawCell(g, r, c, fill) {
  g.fillStyle = fill;
  roundRect(g, c * cell + 1, r * cell + 1, cell - 2, cell - 2, cell * 0.14);
  g.fill();
}
function strokeCell(g, r, c) {
  roundRect(g, c * cell + 1, r * cell + 1, cell - 2, cell - 2, cell * 0.14);
  g.stroke();
}
function drawYard(g, r0, c0, col, panelFill, pathFill) {
  const x = c0 * cell, y = r0 * cell, s = cell * 6;
  // outer panel
  g.fillStyle = panelFill;
  roundRect(g, x + 1, y + 1, s - 2, s - 2, cell * 0.4);
  g.fill();
  g.strokeStyle = col.hex; g.lineWidth = cell * 0.1;
  roundRect(g, x + cell * 0.4, y + cell * 0.4, s - cell * 0.8, s - cell * 0.8, cell * 0.32);
  g.stroke();
  // inner dark area where pawns sit
  g.fillStyle = pathFill;
  roundRect(g, x + cell * 1.15, y + cell * 1.15, s - cell * 2.3, s - cell * 2.3, cell * 0.22);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = cell * 0.05; g.stroke();
}
function drawStar(g, r, c, color) {
  const [x, y] = cellXY(r, c);
  const R = cell * 0.26, ri = R * 0.45;
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : ri;
    const px = x + Math.cos(ang) * rad, py = y + Math.sin(ang) * rad;
    i === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
  }
  g.closePath(); g.fill();
}
function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Pawn sprites (foony-style glossy pawns) — preload and re-render when ready
const PIECE_IMG = {};
for (const color of ORDER) {
  const img = new Image();
  img.onload = () => render();
  img.onerror = () => render();
  img.src = `assets/pieces_${color}.webp`;
  PIECE_IMG[color] = img;
}

// Where a token should be drawn (pixel center coords)
function tokenXY(color, token, idx) {
  if (token.step < 0) {
    const [r, c] = BASE_SPOTS[color][idx];
    return [(c + 0.5) * cell, (r + 0.5) * cell];
  }
  if (token.step >= FINISH_STEP) {
    const ang = { blue: Math.PI, yellow: -Math.PI / 2, green: 0, red: Math.PI / 2 }[color];
    return [cell * 7.5 + Math.cos(ang) * cell * 0.42, cell * 7.5 + Math.sin(ang) * cell * 0.42];
  }
  if (token.step >= HOME_ENTRY_STEP) {
    const [r, c] = HOME_PATH[color][token.step - HOME_ENTRY_STEP];
    return cellXY(r, c);
  }
  const p = MAIN_PATH[(START_INDEX[color] + token.step) % 52];
  return cellXY(p[0], p[1]);
}

let tokenPositions = [];   // last drawn positions, for hit testing
function drawTokens(g, highlight) {
  tokenPositions = [];
  // group tokens that share a cell to offset them
  const buckets = new Map();
  for (const color of ORDER) {
    if (!state.tokens[color]) continue;
    state.tokens[color].forEach((tok, i) => {
      const [x, y] = tokenXY(color, tok, i);
      const key = tok.step < 0 ? `${color}-base-${i}` :
        tok.step >= FINISH_STEP ? `done-${color}-${i}` :
        `${Math.round(x)},${Math.round(y)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ color, idx: i, x, y, step: tok.step });
    });
  }
  for (const [key, list] of buckets) {
    const n = list.length;
    list.forEach((t, i) => {
      let x = t.x, y = t.y, radius = cell * 0.33;
      if (n > 1 && t.step >= 0) {
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
        const off = cell * 0.17;
        x += Math.cos(ang) * off; y += Math.sin(ang) * off;
        radius = cell * 0.22;
      }
      const col = COLORS[t.color];
      const hl = highlight.has(`${t.color}:${t.idx}`);

      // ground shadow ellipse
      g.beginPath(); g.ellipse(x, y + radius * 0.72, radius * 0.95, radius * 0.4, 0, 0, Math.PI * 2);
      g.fillStyle = 'rgba(0,0,0,0.42)'; g.fill();

      // pawn sprite (fallback: glossy circle)
      const img = PIECE_IMG[t.color];
      if (img && img.complete && img.naturalWidth > 0) {
        const size = radius * 2.5;
        const spriteY = y + radius * 0.55 - size * 0.5;
        if (hl) {
          g.save();
          g.shadowColor = '#ffffff';
          g.shadowBlur = cell * 0.45;
          g.drawImage(img, x - size / 2, spriteY, size, size);
          g.drawImage(img, x - size / 2, spriteY, size, size);
          g.restore();
        } else {
          g.drawImage(img, x - size / 2, spriteY, size, size);
        }
      } else {
        const grad = g.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.15, x, y, radius);
        grad.addColorStop(0, col.light);
        grad.addColorStop(0.55, col.hex);
        grad.addColorStop(1, col.dark);
        g.beginPath(); g.arc(x, y, radius, 0, Math.PI * 2);
        g.fillStyle = grad; g.fill();
        g.lineWidth = cell * 0.055; g.strokeStyle = hl ? '#ffffff' : 'rgba(0,0,0,0.55)'; g.stroke();
      }

      if (hl) {
        g.beginPath(); g.arc(x, y, radius + cell * 0.09, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = cell * 0.06;
        g.stroke();
      }
      tokenPositions.push({ color: t.color, idx: t.idx, x, y, r: radius, step: t.step });
    });
  }
}

function render(highlight) {
  if (!$('board')) return;
  drawBoard(highlight || new Set());
}

/* ────────────────────────── Turn / rules engine ────────────────────────── */
function legalMoves(color, dice) {
  const moves = [];
  state.tokens[color].forEach((tok, i) => {
    if (tok.step === FINISH_STEP) return;
    if (tok.step < 0) {
      if (dice === 6) moves.push(i);
      return;
    }
    if (tok.step + dice <= FINISH_STEP) moves.push(i);
  });
  return moves;
}

function applyMove(color, idx, dice) {
  const tok = state.tokens[color][idx];
  const events = [];
  tok.step = tok.step < 0 ? 0 : tok.step + dice;
  if (tok.step === FINISH_STEP) {
    events.push('finish');
    sfx.home();
    return events;
  }
  // capture?
  if (tok.step < HOME_ENTRY_STEP) {
    const absCell = (START_INDEX[color] + tok.step) % 52;
    if (!SAFE.has(absCell)) {
      for (const opp of ORDER) {
        if (opp === color) continue;
        state.tokens[opp].forEach(ot => {
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
  if (events.includes('capture')) sfx.capture(); else sfx.move();
  return events;
}

function nextTurn(fromIdx, extraRoll) {
  state.dice = null;
  state.awaitingMove = false;
  state.highlight = [];
  $('dice-btn').disabled = true;
  if (!extraRoll) {
    state.sixes = 0;
    state.turnIdx = (fromIdx + 1) % state.players.length;
  }
  updateHeader();
}

function advanceAfterMove(events) {
  const captured = events.includes('capture');
  const finishedAll = state.tokens[currentColor()].every(t => t.step === FINISH_STEP);
  if (finishedAll) return endGame(currentColor());

  const extra = captured || state.dice === 6;
  if (state.dice === 6) state.sixes += 1; else state.sixes = 0;

  if (state.sixes >= 3) {
    toast('Three 6s in a row — turn forfeited!');
    setBanner('Three 6s — turn lost!');
    state.sixes = 0;
    return passToNext();
  }
  if (extra) {
    // same player rolls again
    state.dice = null;
    state.awaitingMove = false;
    state.highlight = [];
    updateHeader();
    scheduleIfBot();
    return;
  }
  passToNext();
}

function passToNext() {
  state.dice = null;
  state.awaitingMove = false;
  state.highlight = [];
  state.sixes = 0;
  state.turnIdx = (state.turnIdx + 1) % state.players.length;
  updateHeader();
  scheduleIfBot();
}

function endGame(color) {
  state.over = true;
  state.winner = color;
  sfx.win();
  haptic('heavy');
  $('win-title').textContent = COLORS[color].name + ' wins!';
  const names = state.players.filter(p => p.color !== color).map(p => p.name).join(', ');
  $('win-sub').textContent = names ? 'Better luck next time, ' + names : '';
  $('win-tokens').textContent = '🔴 🟢 🟡 🔵 → 🏆';
  $('win-overlay').classList.add('active');
  updateHeader();
}

function updateHeader() {
  const p = currentPlayer();
  if (!p) return;
  $('turn-dot').style.background = COLORS[p.color].hex;
  $('turn-dot').style.color = COLORS[p.color].hex;
  $('turn-text').textContent = state.over ? 'Game over' :
    (p.isBot ? `${p.name}'s turn` : (state.mode === 'local' ? `${COLORS[p.color].name}'s turn` : 'Your turn'));
  $('dice-hint').textContent = state.over ? '' : (canRoll() ? 'ROLL THE DICE!' : 'PICK A PAWN!');
  // players strip (foony-style cards with avatars)
  const strip = $('players-strip');
  strip.innerHTML = '';
  state.players.forEach((pl, i) => {
    const finished = state.tokens[pl.color].filter(t => t.step === FINISH_STEP).length;
    const isYou = !pl.isBot && pl.isLocal;
    const tag = pl.isBot ? 'BOT' : (isYou ? 'YOU' : 'PLAYER');
    const div = document.createElement('div');
    div.className = 'pstrip' + (i === state.turnIdx && !state.over ? ' active' : '');
    div.innerHTML = `<img class="ps-av" src="${avatarFor(pl)}" alt="" />
      <span class="ps-info">
        <span class="ps-name" style="color:${COLORS[pl.color].hex}">${escapeHtml(pl.name)}</span>
        <span class="ps-tag">${tag}</span>
      </span>
      <span class="ps-count">🏠 ${finished}/4</span>`;
    strip.appendChild(div);
  });
  // Keep roll button in sync and mirror state to online clients
  $('dice-btn').disabled = !canRoll();
  if (state.mode === 'online' && state.online?.isHost) broadcastState();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function canRoll() {
  const p = currentPlayer();
  return !state.over && !state.busy && state.dice === null && p && !p.isBot && !p.isRemote;
}

function rollDice(manual) {
  if (state.over || state.busy || state.dice !== null) return;
  const p = currentPlayer();
  // Online: only host or the local owner of this turn may roll
  if (state.mode === 'online') {
    if (!state.online) return;
    const isMyTurn = (state.online.isHost && p === state.players[state.online.mySeat]) ||
      (!state.online.isHost && state.online.myColor === p.color);
    if (!isMyTurn) return;
    if (!state.online.isHost) {
      // client asks host to roll for us
      state.online.conn.send({ type: 'roll' });
      return;
    }
    // host rolls authoritatively
    doRoll(true);
    return;
  }
  if (p.isRemote) return; // remote players roll via their own client
  doRoll(true);
}

function doRoll(broadcast) {
  const dice = 1 + Math.floor(Math.random() * 6);
  state.busy = true;
  sfx.roll();
  // rolling animation
  let ticks = 0;
  const iv = setInterval(() => {
    drawDie(1 + Math.floor(Math.random() * 6));
    ticks++;
    if (ticks >= 10) {
      clearInterval(iv);
      state.dice = dice;
      drawDie(dice);
      state.busy = false;
      onAfterRoll(broadcast);
    }
  }, 45);
}

function onAfterRoll(broadcast) {
  const color = currentColor();
  const moves = legalMoves(color, state.dice);
  if (state.mode === 'online' && state.online?.isHost && broadcast !== false) {
    broadcastState();
  }
  if (moves.length === 0) {
    toast(`No legal move for ${state.dice}`);
    setTimeout(() => {
      if (state.dice === 6) state.sixes += 1; else state.sixes = 0;
      if (state.sixes >= 3) { state.sixes = 0; passToNext(); }
      else if (state.dice === 6) { state.dice = null; updateHeader(); scheduleIfBot(); }
      else passToNext();
    }, 800);
    return;
  }
  state.awaitingMove = true;
  state.highlight = moves.map(i => `${color}:${i}`);
  $('dice-hint').textContent = currentPlayer().isBot ? '...' : 'Choose a glowing token';
  render(new Set(state.highlight));
  updateHeader();

  if (currentPlayer().isBot) {
    setTimeout(() => {
      const pick = aiPickMove(color, state.dice, moves);
      doMove(pick);
    }, 650);
  }
}

function aiPickMove(color, dice, moves) {
  let best = null, bestScore = -Infinity;
  for (const i of moves) {
    const tok = state.tokens[color][i];
    let score = Math.random() * 4;
    const newStep = tok.step < 0 ? 0 : tok.step + dice;
    if (newStep === FINISH_STEP) score += 1000;
    else if (tok.step < 0) score += 140;
    else score += newStep * 3;
    // capture?
    if (newStep < HOME_ENTRY_STEP) {
      const absCell = (START_INDEX[color] + newStep) % 52;
      if (!SAFE.has(absCell)) {
        for (const opp of ORDER) {
          if (opp === color) continue;
          for (const ot of state.tokens[opp]) {
            if (ot.step >= 0 && ot.step < HOME_ENTRY_STEP &&
                (START_INDEX[opp] + ot.step) % 52 === absCell) {
              score += 450;
            }
          }
        }
      } else {
        score += 25; // safe square
      }
    }
    // prefer keeping tokens off base
    if (tok.step < 0) score += 40;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

function doMove(idx) {
  if (!state.awaitingMove) return;
  const color = currentColor();
  const moves = legalMoves(color, state.dice);
  if (!moves.includes(idx)) { sfx.illegal(); return; }

  state.awaitingMove = false;
  state.highlight = [];
  $('dice-hint').textContent = '';
  const events = applyMove(color, idx, state.dice);
  haptic('medium');
  animateMove(color, idx, events);
}

function animateMove(color, idx, events) {
  const tok = state.tokens[color][idx];
  render(new Set());
  // online broadcast after state change settled
  if (state.mode === 'online' && state.online?.isHost) {
    setTimeout(broadcastState, 120);
  }
  setTimeout(() => {
    if (events.includes('capture')) { toast('Captured! 💥'); setBanner('💥 Captured a pawn!'); }
    if (events.includes('finish')) { toast('A pawn reached home! 🏠'); setBanner('🏠 Pawn reached home!'); }
    advanceAfterMove(events);
  }, 160);
}

function scheduleIfBot() {
  const p = currentPlayer();
  if (p && p.isBot && !state.over) {
    $('dice-hint').textContent = '...';
    setTimeout(() => rollDice(), 750);
  }
}

/* ────────────────────────── Input: tap a token ────────────────────────── */
function boardClick(ev) {
  if (!state.awaitingMove || currentPlayer().isBot || currentPlayer().isRemote) return;
  const c = canvas();
  const rect = c.getBoundingClientRect();
  const x = (ev.clientX - rect.left), y = (ev.clientY - rect.top);
  const color = currentColor();
  let best = null, bestDist = Infinity;
  for (const t of tokenPositions) {
    if (t.color !== color) continue;
    if (!state.highlight.includes(`${t.color}:${t.idx}`)) continue;
    const d = Math.hypot(t.x - x, t.y - y);
    if (d < t.r + cell * 0.25 && d < bestDist) { best = t; bestDist = d; }
  }
  if (best) { haptic('light'); doMove(best.idx); }
}

/* ────────────────────────── Game setup ────────────────────────── */
function startGameWithPlayers(mode, players) {
  state.mode = mode;
  state.players = players;
  state.tokens = freshTokens();
  state.turnIdx = 0;
  state.sixes = 0;
  state.dice = null;
  state.over = false;
  state.winner = null;
  state.awaitingMove = false;
  state.highlight = [];
  drawDie(5);
  $('win-overlay').classList.remove('active');
  fitCanvas();
  showScreen('screen-game');
  $('dice-btn').disabled = false;
  updateHeader();
  render(new Set());
  scheduleIfBot();
}

function startBotsGame() {
  const botCount = parseInt($('seg-bot-count').querySelector('.selected').dataset.v, 10);
  const myColor = $('pick-bot-color').querySelector('.selected').dataset.v;
  const tgN = tgName();
  const players = [];
  const others = ORDER.filter(c => c !== myColor);
  const botNames = { blue: 'Bulby', yellow: 'Bomby', green: 'Bruno', red: 'Petey' };
  players.push({ color: myColor, name: tgN, isBot: false, isLocal: true });
  for (let i = 0; i < botCount; i++) {
    players.push({ color: others[i], name: botNames[others[i]] || ('Bot ' + (i + 1)), isBot: true });
  }
  players.sort((a, b) => ORDER.indexOf(a.color) - ORDER.indexOf(b.color));
  startGameWithPlayers('bots', players);
}

function startLocalGame() {
  const count = parseInt($('seg-local-count').querySelector('.selected').dataset.v, 10);
  const players = ORDER.slice(0, count).map(color => ({ color, name: COLORS[color].name, isBot: false, isLocal: true }));
  startGameWithPlayers('local', players);
}

/* ────────────────────────── Online (PeerJS) rooms ────────────────────────── */
const PEER_PREFIX = 'sglu-';
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Free public TURN (Open Relay) — keeps rooms working behind strict NATs;
  // TCP/TLS variants because some networks block UDP entirely.
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];
const peerConfig = () => ({ debug: 1, config: { iceServers: ICE_SERVERS } });

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function discoverOnline() {
  return typeof Peer !== 'undefined';
}

async function createRoom() {
  if (!discoverOnline()) { setOnlineStatus('Online unavailable (network). Try bots instead.', 'error'); return; }
  const code = makeRoomCode();
  setOnlineStatus('Creating room…');
  const peer = new Peer(PEER_PREFIX + code, peerConfig());
  const myName = tgName();
  state.online = { isHost: true, code, peer, conns: [], mySeat: 0, myColor: 'red', started: false };
  $('room-code').textContent = code;
  renderRoomPlayers([{ name: myName, color: 'red', isHost: true, isYou: true }]);
  $('start-online').disabled = true;
  $('start-online').textContent = 'START (need 2+ players)';
  showScreen('screen-room');
  peer.on('open', () => setOnlineStatus('Room ready — share the code!', 'ok'));
  peer.on('error', err => setOnlineStatus('Peer error: ' + (err.type || err), 'error'));
  peer.on('connection', conn => {
    if (state.online.conns.length >= 3) { conn.close(); return; }
    conn.on('open', () => {
      state.online.conns.push(conn);
      conn.on('data', d => hostOnData(conn, d));
      conn.on('close', () => hostOnLeave(conn));
      hostBroadcastRoom();
    });
  });
}

function joinRoom(code) {
  if (!discoverOnline()) { setOnlineStatus('Online unavailable (network).', 'error'); return; }
  code = code.trim().toUpperCase();
  if (code.length !== 5) { setOnlineStatus('Room code must be 5 characters.', 'error'); return; }
  setOnlineStatus('Connecting…', '');
  const myName = tgName();
  const peer = new Peer(undefined, peerConfig());
  state.online = { isHost: false, code, peer, conn: null, myColor: null, mySeat: null, started: false };
  peer.on('open', () => {
    const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
    state.online.conn = conn;
    conn.on('open', () => {
      conn.send({ type: 'hello', name: myName });
      setOnlineStatus('Connected! Waiting for host…', 'ok');
    });
    conn.on('data', d => clientOnData(d));
    conn.on('close', () => { toast('Disconnected from room.'); showScreen('screen-online'); });
    conn.on('error', () => setOnlineStatus('Connection failed. Check the code.', 'error'));
    showScreen('screen-room');
    $('room-code').textContent = code;
    $('start-online').style.display = 'none';
    $('leave-room').textContent = '←';
    renderRoomPlayers([{ name: 'You', color: '…', isYou: true }]);
  });
  peer.on('error', err => setOnlineStatus('Peer error: ' + (err.type || err) + ' — is the code right?', 'error'));
}

function hostBroadcastRoom(playersOverride) {
  const myName = tgName();
  const players = [{ name: myName, color: 'red', isHost: true, seat: 0 }];
  state.online.conns.forEach((c, i) => players.push({ name: c._name || ('Player ' + (i + 2)), color: ORDER[i + 1], seat: i + 1 }));
  const payload = { type: 'room', players, code: state.online.code };
  state.online.conns.forEach(c => c.send(payload));
  renderRoomPlayers(players.map((p, i) => ({ ...p, isYou: i === 0 })));
  $('start-online').disabled = players.length < 2;
  if (players.length >= 2) {
    $('start-online').textContent = `START GAME (${players.length} players)`;
  }
}

function hostOnData(conn, data) {
  if (!data || typeof data !== 'object') return;
  if (data.type === 'hello') {
    conn._name = String(data.name || 'Player').slice(0, 24);
    hostBroadcastRoom();
    return;
  }
  if (data.type === 'roll') {
    // client whose turn it is asked to roll
    const p = currentPlayer();
    const seat = state.online.conns.indexOf(conn) + 1;
    if (p && state.players[state.turnIdx] === state.players[seat]) {
      doRoll(true);
    }
    return;
  }
  if (data.type === 'move' && state.awaitingMove) {
    const seat = state.online.conns.indexOf(conn) + 1;
    const p = state.players[state.turnIdx];
    if (p && state.players[state.turnIdx] === state.players[seat]) {
      doMove(data.token | 0);
    }
    return;
  }
}

function hostOnLeave(conn) {
  const i = state.online.conns.indexOf(conn);
  if (i >= 0) state.online.conns.splice(i, 1);
  if (!state.online.started) { hostBroadcastRoom(); return; }
  // Fill the leaver's seat with a bot so the game can continue
  toast('A player left — a Shadow Bot takes over.');
  const leavingColor = ORDER[i + 1];
  state.players.forEach(p => { if (p.color === leavingColor) { p.isBot = true; p.isRemote = false; p.name = 'Shadow Bot'; } });
  broadcastState();
  updateHeader();
  scheduleIfBot();
}

function clientOnData(data) {
  if (!data || typeof data !== 'object') return;
  if (data.type === 'room') {
    renderRoomPlayers(data.players.map(p => ({ ...p, isYou: p.name === tgName() && p.seat !== 0 })));
    $('room-code').textContent = data.code;
    return;
  }
  if (data.type === 'start') {
    state.online.mySeat = data.yourSeat;
    state.online.myColor = ORDER[data.yourSeat];
    state.online.started = true;
    startGameWithPlayers('online', data.players.map((p, i) => ({
      color: ORDER[i],
      name: p.name + (i === data.yourSeat ? ' (You)' : ''),
      isBot: false,
      isLocal: i === data.yourSeat,
      isRemote: i !== data.yourSeat && i !== 0,
    })));
    return;
  }
  if (data.type === 'state') {
    applyRemoteState(data);
    return;
  }
}

function hostStartOnline() {
  if (!state.online || !state.online.isHost) return;
  const myName = tgName();
  const names = [myName].concat(state.online.conns.map(c => c._name || 'Player'));
  const players = names.map((name, i) => ({ color: ORDER[i], name, isBot: false, isLocal: i === 0, isRemote: i !== 0 }));
  state.online.started = true;
  state.online.conns.forEach((conn, i) => conn.send({ type: 'start', yourSeat: i + 1, players: names.map(n => ({ name: n })) }));
  startGameWithPlayers('online', players);
}

function broadcastState() {
  if (!state.online || !state.online.isHost) return;
  const payload = {
    type: 'state',
    tokens: state.tokens,
    turnIdx: state.turnIdx,
    sixes: state.sixes,
    dice: state.dice,
    over: state.over,
    winner: state.winner,
    players: state.players.map(p => ({ color: p.color, name: p.name, isBot: p.isBot })),
  };
  state.online.conns.forEach(c => { try { c.send(payload); } catch (e) { } });
}

function applyRemoteState(data) {
  state.tokens = data.tokens;
  state.turnIdx = data.turnIdx;
  state.sixes = data.sixes;
  state.dice = data.dice;
  state.over = data.over;
  state.winner = data.winner;
  state.players = data.players.map(p => ({
    ...p,
    isLocal: state.online?.myColor === p.color,
    isRemote: state.online?.myColor !== p.color,
  }));
  state.awaitingMove = state.dice !== null && !currentPlayer()?.isBot &&
    state.online?.myColor === currentColor();
  state.highlight = state.awaitingMove
    ? legalMoves(currentColor(), state.dice).map(i => `${currentColor()}:${i}`)
    : [];
  drawDie(state.dice || 5);
  updateHeader();
  render(new Set(state.highlight));
  $('dice-btn').disabled = !state.awaitingMove || currentPlayer()?.isBot;
  // show the win screen on clients too
  if (state.over && state.winner && !$('win-overlay').classList.contains('active')) {
    state.over = true;
    $('win-title').textContent = COLORS[state.winner].name + ' wins!';
    $('win-sub').textContent = '';
    $('win-tokens').textContent = '🔴 🟢 🟡 🔵 → 🏆';
    $('win-overlay').classList.add('active');
    sfx.win();
  }
}

/* override doMove for clients: send to host instead of applying directly */
const _origDoMove = doMove;
doMove = function (idx) {
  if (state.mode === 'online' && state.online && !state.online.isHost) {
    if (!state.awaitingMove) return;
    const moves = legalMoves(currentColor(), state.dice);
    if (!moves.includes(idx)) { sfx.illegal(); return; }
    state.online.conn.send({ type: 'move', token: idx });
    state.awaitingMove = false;
    state.highlight = [];
    render(new Set());
    return;
  }
  _origDoMove(idx);
};

function renderRoomPlayers(players) {
  const box = $('room-players');
  box.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'room-player';
    div.innerHTML = `<img class="ps-av" style="width:36px;height:36px;border-radius:50%" src="assets/guest.webp" alt="" />
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

/* ────────────────────────── Wire up UI ────────────────────────── */
function bindUI() {
  tgReady();
  drawDie(5);

  $('btn-bots').addEventListener('click', () => { haptic(); showScreen('screen-setup-bots'); });
  $('btn-local').addEventListener('click', () => { haptic(); showScreen('screen-setup-local'); });
  $('btn-online').addEventListener('click', () => { haptic(); showScreen('screen-online'); setOnlineStatus(''); });
  document.querySelectorAll('[data-goto]').forEach(b =>
    b.addEventListener('click', () => { haptic(); showScreen(b.dataset.goto); }));

  const seg = (id, def) => {
    $(id).addEventListener('click', e => {
      const btn = e.target.closest('.seg-btn'); if (!btn) return;
      haptic();
      $(id).querySelectorAll('.seg-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  };
  seg('seg-bot-count'); seg('seg-local-count');
  $('pick-bot-color').addEventListener('click', e => {
    const btn = e.target.closest('.cdot'); if (!btn) return;
    haptic();
    $('pick-bot-color').querySelectorAll('.cdot').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });

  $('start-bots').addEventListener('click', () => { haptic('medium'); startBotsGame(); });
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
    if (state.online?.peer) state.online.peer.destroy();
    state.online = null;
    showScreen('screen-online');
  });

  $('quit-game').addEventListener('click', () => { haptic(); leaveGame(); });
  $('toggle-sound').addEventListener('click', () => {
    state.muted = !state.muted;
    $('toggle-sound').textContent = state.muted ? '🔇' : '🔊';
    toast(state.muted ? 'Sound off' : 'Sound on');
  });

  $('dice-btn').addEventListener('click', () => { haptic(); rollDice(true); });
  canvas().addEventListener('pointerdown', boardClick);

  $('win-again').addEventListener('click', () => {
    haptic('medium');
    $('win-overlay').classList.remove('active');
    if (state.mode === 'bots') startBotsGame();
    else if (state.mode === 'local') startLocalGame();
    else showScreen('screen-menu');
  });
  $('win-menu').addEventListener('click', () => {
    haptic();
    $('win-overlay').classList.remove('active');
    leaveGame();
  });

  window.addEventListener('resize', () => { if ($('screen-game').classList.contains('active')) { fitCanvas(); render(new Set(state.highlight || [])); } });
}

function leaveGame() {
  if (state.online?.peer) { try { state.online.peer.destroy(); } catch (e) { } }
  state.online = null;
  showScreen('screen-menu');
}

bindUI();
