import React, { useEffect, useRef, useState } from 'react';
import { Chess } from './vendor/chess.js';
import { chooseAiMove, AI_INFO } from './ai.js';
import { tg, tgReady, tgName, haptic, backButton } from '../shared/telegram.js';
import { createSfx } from '../shared/audio.js';

const PIECES = {
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
const AVATARS = { you: 'assets/guest.webp', bulby: 'assets/bulby.webp', bomby: 'assets/bomby.webp', bruno: 'assets/bruno.webp', petey: 'assets/petey.webp' };
const FILES = 'abcdefgh';
const RANKS_W = [8,7,6,5,4,3,2,1];
const RANKS_B = [1,2,3,4,5,6,7,8];
const PEER_PREFIX = 'sgch-';
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];
const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

function freshState() {
  return {
    mode: null, players: [], game: new Chess(), orientation: 'w',
    over: false, result: null, winner: null,
    selected: null, legalTargets: [], remoteHistory: null,
    clock: { w: 300, b: 300, inc: 3, active: false, last: 0 },
  };
}

const fmtClock = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, Math.ceil(s)) % 60).padStart(2, '0')}`;
const pieceCount = (game, color) => {
  const counts = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
  for (const row of game.board()) for (const p of row) if (p && p.color === color) counts[p.type]++;
  return counts;
};
const BASE_COUNTS = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

export default function ChessApp() {
  const [screen, setScreen] = useState('menu');
  const [toast, setToast] = useState('');
  const [, setTick] = useState(0);
  const sfx = useRef(createSfx());
  const onlineRef = useRef(null);
  const lastTapRef = useRef({ t: 0, square: '' });
  const G = useRef(freshState());
  const bump = () => setTick(t => t + 1);
  const cur = () => G.current.players[G.current.game.turn() === 'w' ? 0 : 1] || G.current.players[0];
  const me = () => G.current.players.find(p => p.isLocal);
  const localTurn = () => G.current.mode === 'local' || me()?.color === G.current.game.turn();

  useEffect(() => { tgReady(); backButton(() => setScreen('menu'), screen !== 'menu'); }, [screen]);

  // Auto-join from invite link (?room=CODE)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const room = (params.get('room') || '').trim().toUpperCase();
      if (/^[A-Z0-9]{5}$/.test(room)) {
        setScreen('online');
        const t = setTimeout(() => joinRoom(room), 300);
        return () => clearTimeout(t);
      }
    } catch (e) { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t); }, [toast]);

  // Clock loop
  useEffect(() => {
    if (screen !== 'game' || G.current.over) return;
    const id = setInterval(() => {
      const c = G.current.clock;
      if (!c.active) return;
      const now = performance.now();
      const dt = (now - c.last) / 1000;
      c.last = now;
      if (dt > 2) return;
      const active = G.current.game.turn();
      c[active] = Math.max(0, c[active] - dt);
      if (c[active] <= 0) { c.active = false; timeoutLoser(active); }
      bump();
    }, 100);
    return () => clearInterval(id);
  });

  // AI moves after human moves
  useEffect(() => {
    if (screen !== 'game' || G.current.over || G.current.mode !== 'ai') return;
    const p = G.current.players.find(p => p.color === G.current.game.turn());
    if (p && p.isBot) {
      const t = setTimeout(() => { aiMove(); }, 400);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, G.current.game.fen(), G.current.over]);

  function resetClock(seconds, inc) {
    G.current.clock = { w: seconds, b: seconds, inc, active: true, last: performance.now() };
  }
  function stopClock() { G.current.clock.active = false; }
  function updateLowTime() { bump(); }
  function addIncrement() {
    const c = G.current.clock;
    const mover = G.current.game.turn() === 'w' ? 'b' : 'w';
    c[mover] += c.inc;
    c.last = performance.now();
  }
  function timeoutLoser(loser) {
    const winner = loser === 'w' ? 'b' : 'w';
    G.current.over = true; G.current.result = 'timeout'; G.current.winner = winner;
    stopClock();
    sfx.current.draw();
  }

  /* ── Move pipeline ─────────────────────────── */
  function afterMoveApplied(m) {
    addIncrement();
    checkGameOver();
    if (G.current.over) { stopClock(); bump(); return; }
    bump();
    if (G.current.mode === 'online' && onlineRef.current?.isHost) broadcastState();
  }

  function checkGameOver() {
    const g = G.current.game;
    if (g.isCheckmate()) { G.current.over = true; G.current.winner = g.turn() === 'w' ? 'b' : 'w'; G.current.result = 'checkmate'; return; }
    if (g.isStalemate()) { G.current.over = true; G.current.result = 'stalemate'; return; }
    if (g.isInsufficientMaterial()) { G.current.over = true; G.current.result = 'insufficient'; return; }
    if (g.isThreefoldRepetition()) { G.current.over = true; G.current.result = 'threefold'; return; }
    if (g.isDrawByFiftyMoves()) { G.current.over = true; G.current.result = 'fifty'; return; }
  }

  function tapSquare(square) {
    if (G.current.over) return;
    const p = G.current.players.find(p => p.isLocal);
    if (G.current.mode !== 'local' && !p) return;
    if (G.current.mode !== 'local' && p && p.color !== G.current.game.turn()) return;
    const piece = G.current.game.get(square);
    // attempt move?
    if (G.current.selected && G.current.legalTargets.some(t => t.to === square)) {
      attemptMove(G.current.selected, square);
      return;
    }
    if (piece && piece.color === G.current.game.turn()) {
      G.current.selected = square;
      G.current.legalTargets = G.current.game.moves({ square, verbose: true }).map(m => ({ to: m.to, capture: !!m.captured, promotion: !!m.promotion }));
      haptic('light');
      bump();
      return;
    }
    G.current.selected = null;
    G.current.legalTargets = [];
    bump();
  }

  function needsPromotionChoice(from, to) {
    const p = G.current.game.get(from);
    if (!p || p.type !== 'p') return false;
    const lastRank = p.color === 'w' ? '8' : '1';
    return to[1] === lastRank && G.current.game.moves({ square: from, verbose: true }).some(m => m.to === to && m.promotion);
  }
  const [promo, setPromo] = useState(null); // { from, to }

  function attemptMove(from, to, promotion) {
    if (!promotion && needsPromotionChoice(from, to)) { setPromo({ from, to }); return; }
    const meP = G.current.players.find(p => p.isLocal);
    if (G.current.mode === 'online' && onlineRef.current && !onlineRef.current.isHost) {
      onlineRef.current.conn.send({ type: 'move', from, to, promotion: promotion || 'q' });
      G.current.selected = null; G.current.legalTargets = [];
      bump();
      return;
    }
    let m;
    try { m = G.current.game.move({ from, to, promotion: promotion || undefined }); }
    catch (e) { sfx.current.illegal(); setToast('Illegal move'); return; }
    G.current.selected = null; G.current.legalTargets = [];
    haptic('medium');
    if (m.captured) sfx.current.capture(); else sfx.current.move();
    if (m.flags.includes('k') || m.flags.includes('q')) sfx.current.castle();
    if (m.promotion) sfx.current.promote();
    if (G.current.game.inCheck()) sfx.current.check();
    afterMoveApplied(m);
  }

  function aiMove() {
    if (G.current.over) return;
    const p = G.current.players.find(p => p.color === G.current.game.turn());
    if (!p || !p.isBot) return;
    const m = chooseAiMove(G.current.game, G.current.mode === 'ai' ? (p.difficulty || 'tactician') : 'tactician');
    if (!m) return;
    let applied;
    try { applied = G.current.game.move(m); } catch (e) { return; }
    addIncrement();
    haptic('light');
    if (applied.captured) sfx.current.capture(); else sfx.current.move();
    if (applied.flags.includes('k') || applied.flags.includes('q')) sfx.current.castle();
    if (applied.promotion) sfx.current.promote();
    if (G.current.game.inCheck()) sfx.current.check();
    checkGameOver();
    if (G.current.over) stopClock();
    if (G.current.mode === 'online' && onlineRef.current?.isHost) broadcastState();
    bump();
  }

  /* ── Online (PeerJS) ────────────────────────── */
  function broadcastState() {
    const o = onlineRef.current;
    if (!o || !o.isHost || !o.conn) return;
    const payload = {
      type: 'state',
      fen: G.current.game.fen(),
      history: G.current.game.history(),
      over: G.current.over,
      result: G.current.result,
      winner: G.current.winner,
      clock: { w: G.current.clock.w, b: G.current.clock.b, inc: G.current.clock.inc },
    };
    try { o.conn.send(payload); } catch (e) { }
  }

  function applyRemoteState(data) {
    G.current.game = new Chess(data.fen);
    G.current.over = data.over; G.current.result = data.result; G.current.winner = data.winner;
    G.current.selected = null; G.current.legalTargets = [];
    G.current.remoteHistory = data.history || [];
    if (data.clock) {
      G.current.clock = { w: data.clock.w, b: data.clock.b, inc: data.clock.inc, active: !data.over, last: performance.now() };
    }
    bump();
  }

  function createRoom() {
    if (typeof Peer === 'undefined') { setToast('Online unavailable. Try vs AI!'); return; }
    const code = (() => { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)]; return s; })();
    const peer = new Peer(PEER_PREFIX + code, { debug: 1, config: { iceServers: ICE_SERVERS } });
    onlineRef.current = { isHost: true, code, peer, conn: null, started: false };
    peer.on('open', () => bump());
    peer.on('connection', conn => {
      if (onlineRef.current.conn) { conn.close(); return; }
      onlineRef.current.conn = conn;
      conn._name = null;
      conn.on('open', () => { conn.on('data', d => hostOnData(d)); conn.on('close', () => { announceLeft(); }); refreshLobby(); });
    });
    peer.on('error', () => setToast('Room error — try again.'));
    setScreen('room');
  }
  function refreshLobby() {
    const o = onlineRef.current;
    if (!o || !o.isHost) return;
    const names = [tgName() || 'You', o.conn?._name || 'Opponent'];
    bump();
    try { o.conn?.send({ type: 'room', players: names.map(n => ({ name: n })) }); } catch (e) { }
  }
  function hostOnData(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'hello') { onlineRef.current.conn._name = String(data.name || 'Opponent').slice(0, 24); refreshLobby(); return; }
    if (data.type === 'move' && !G.current.over) {
      const move = { from: data.from, to: data.to, promotion: data.promotion };
      let m;
      try { m = G.current.game.move(move); } catch (e) { try { onlineRef.current.conn.send({ type: 'illegal' }); } catch (e2) { } return; }
      addIncrement();
      haptic('light');
      if (m.captured) sfx.current.capture(); else sfx.current.move();
      if (G.current.game.inCheck()) sfx.current.check();
      checkGameOver();
      if (G.current.over) stopClock();
      broadcastState();
      bump();
      return;
    }
    if (data.type === 'rematch') resetOnlineMatch();
  }
  function hostOnLeave() {
    try { onlineRef.current?.conn?.close(); } catch (e) { }
    onlineRef.current = null;
    G.current.over = true; G.current.result = 'abandoned'; G.current.winner = 'w';
    bump();
  }
  function announceLeft() { setToast('Opponent disconnected.'); setScreen('menu'); }
  function joinRoom(code) {
    if (typeof Peer === 'undefined') { setToast('Online unavailable.'); return; }
    code = (code || '').trim().toUpperCase();
    if (code.length !== 5) { setToast('Room code must be 5 characters.'); return; }
    const peer = new Peer(undefined, { debug: 1, config: { iceServers: ICE_SERVERS } });
    onlineRef.current = { isHost: false, code, peer, conn: null, started: false };
    peer.on('open', () => {
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
      onlineRef.current.conn = conn;
      conn.on('open', () => { conn.send({ type: 'hello', name: tgName() || 'You' }); });
      conn.on('data', d => {
        if (d.type === 'room') { onlineRef.current.players = d.players; setScreen('room'); bump(); }
        else if (d.type === 'start') {
          onlineRef.current.started = true;
          onlineRef.current.myColor = 'b';
          const players = d.players.map((p, i) => ({ color: i === 0 ? 'w' : 'b', name: p.name, isLocal: i === 1, isRemote: i === 0, avatar: AVATARS.you }));
          startMatch(players, 'online', { seconds: d.clockSeconds || 300, inc: d.inc || 3 }, 'b');
        }
        else if (d.type === 'state') applyRemoteState(d);
        else if (d.type === 'illegal') setToast('Illegal move');
      });
      conn.on('close', () => { setToast('Host disconnected.'); setScreen('menu'); });
      setScreen('room');
    });
    peer.on('error', () => setToast('Connection failed — is the code right?'));
  }

  function resetOnlineMatch() {
    const clockSeconds = Math.round(G.current.clock.w) || 300;
    const inc = G.current.clock.inc || 3;
    const prevPlayers = G.current.players;
    G.current = freshState();
    G.current.mode = 'online';
    const players = prevPlayers.map(p => ({ ...p, isBot: false, name: p.name }));
    startMatch(players, 'online', { seconds: clockSeconds, inc }, 'w');
    try { onlineRef.current?.conn?.send({ type: 'start', players: players.map(p => ({ name: p.name })), clockSeconds, inc }); } catch (e) { }
  }

  function startMatch(players, mode, clockSpec, orientation = 'w') {
    const seconds = clockSpec?.seconds ?? 300, inc = clockSpec?.inc ?? 3;
    G.current = {
      mode, players, game: new Chess(), orientation,
      over: false, result: null, winner: null,
      selected: null, legalTargets: [], remoteHistory: null,
      clock: { w: seconds, b: seconds, inc, active: true, last: performance.now() },
    };
    setScreen('game');
    bump();
  }

  function startAiGame() {
    const diff = document.querySelector('#ai-setup .seg-btn.selected')?.dataset.v || 'tactician';
    const choice = document.querySelector('#ai-setup .piece-pick button.selected')?.dataset.v || 'w';
    const myColor = choice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : choice;
    const info = AI_INFO[diff];
    const aiName = info.name + ' (AI)';
    const players = [
      { name: tgName() || 'You', color: myColor, isBot: false, isLocal: true, avatar: AVATARS.you },
      { name: aiName, color: myColor === 'w' ? 'b' : 'w', isBot: true, isLocal: false, isRemote: false, difficulty: diff, avatar: AVATARS[info.name.toLowerCase()] || AVATARS.bulby },
    ].sort((a, b) => (a.color === 'w' ? -1 : 1) - (b.color === 'w' ? -1 : 1));
    const tSel = document.querySelector('#seg-time-ai .seg-btn.selected');
    startMatch(players, 'ai', { seconds: +(tSel?.dataset.t || 300), inc: +(tSel?.dataset.inc || 3) }, myColor);
    if (myColor === 'b') setTimeout(() => aiMove(), 600);
  }

  function startLocalGame() {
    const tSel = document.querySelector('#seg-time-local .seg-btn.selected');
    startMatch([
      { name: 'Player 1', color: 'w', isBot: false, isLocal: true, avatar: AVATARS.you },
      { name: 'Player 2', color: 'b', isBot: false, isLocal: true, avatar: AVATARS.petey },
    ], 'local', { seconds: +(tSel?.dataset.t || 300), inc: +(tSel?.dataset.inc || 3) }, 'w');
  }

  /* ── Render helpers ────────────────────────── */
  const capturedBy = (color) => {
    const opp = color === 'w' ? 'b' : 'w';
    const mine = pieceCount(G.current.game, opp);
    const out = [];
    for (const [t, n] of Object.entries(BASE_COUNTS)) for (let i = 0; i < n - (mine[t] || 0); i++) out.push(t);
    return out;
  };
  const myColor = me()?.color || 'w';
  const mineCap = capturedBy(myColor), oppCap = capturedBy(myColor === 'w' ? 'w' : 'b');
  const materialAdv = mineCap.reduce((s, t) => s + (VAL[t] || 0) / 100, 0) - oppCap.reduce((s, t) => s + (VAL[t] || 0) / 100, 0);

  const orient = G.current.orientation;
  const ranks = orient === 'w' ? RANKS_W : RANKS_B;
  const files = orient === 'w' ? FILES.split('') : FILES.split('').reverse();
  const boardCells = [];
  ranks.forEach((rank, ri) => files.forEach((file, fi) => {
    const sqIdx = 8 - rank;
    const color = (FILES.indexOf(file) + (8 - rank) + (orient === 'w' ? 0 : 0)) % 2 === 1 ? 'sq-light' : 'sq-dark';
    const isLight = (FILES.indexOf(file) + (8 - rank)) % 2 === 1;
    boardCells.push({ square: file + rank, ri, fi, light: isLight });
  }));

  const hist = G.current.game.history();
  const movesHtml = [];
  for (let i = 0; i < hist.length; i += 2) movesHtml.push([i / 2 + 1, hist[i], hist[i + 1]]);

  const curTurnColor = G.current.game.turn();
  const checkSq = (() => {
    if (!G.current.game.inCheck()) return null;
    const turn = G.current.game.turn();
    for (const row of G.current.game.board()) for (const p of row) if (p && p.type === 'k' && p.color === turn) return p.square;
    return null;
  })();
  const lastMove = (() => {
    const h = G.current.game.history({ verbose: true });
    return h.length ? h[h.length - 1] : null;
  })();

  const myLow = G.current.clock[myColor] <= 10 && G.current.clock[myColor] > 0;
  const oppLow = G.current.clock[myColor === 'w' ? 'b' : 'w'] <= 10 && G.current.clock[myColor === 'w' ? 'b' : 'w'] > 0;

  /* ═══ RENDER ═══ */
  if (screen === 'menu') {
    return (
      <div className="sg-bg min-h-full flex flex-col items-center justify-center px-5 py-8">
        <div className="flex flex-col items-center gap-2 w-full max-w-[440px] text-center">
          <img src="assets/og_image_960.webp" alt="Chess" draggable="false" className="w-40 h-[100px] object-contain" />
          <h1 className="game-title-word text-[clamp(56px,16vw,92px)] font-black tracking-[12px] leading-none">CHESS</h1>
          <div className="gold-rule"><span /><em className="text-[#e3b75b]">✦</em><span /></div>
          <div className="text-[#a99e86] text-[12px]">Outwit. Outplay. Outlast.</div>
          <div className="flex flex-col gap-3 w-full mt-2">
            <button className="btn btn-gold py-[17px] text-[17px] w-full" onClick={() => { haptic(); setScreen('setup-ai'); }}>🤖 PLAY VS AI</button>
            <button className="btn btn-dark py-[17px] text-[17px] w-full" onClick={() => { haptic(); setScreen('setup-local'); }}>👥 PLAY 1V1</button>
            <button className="btn btn-dark py-[17px] text-[17px] w-full" onClick={() => { haptic(); setScreen('online'); }}>➕ ONLINE ROOM</button>
          </div>
          <div className="text-[#a99e86] text-[11px] mt-2 flex gap-2 items-center">
            <a className="text-[#e3b75b] font-bold no-underline" href="../index.html">← All Games</a><span className="opacity-50">•</span>
            <a className="text-[#e3b75b] font-bold no-underline" href="https://t.me/ShadowGameEnBot">@ShadowGameEnBot</a>
          </div>
        </div>
      </div>
    );
  }
  if (screen === 'setup-ai') {
    return (
      <SetupShell id="ai-setup" title="Play vs AI" onBack={() => setScreen('menu')}>
        <label className="text-[#a99e86] text-[10px] tracking-[3px] font-bold">TIME CONTROL</label>
        <SegRow id="seg-time-ai">
          <SegBtn dataV="60" inc="0">1+0</SegBtn><SegBtn dataV="180" inc="2">3+2</SegBtn><SegBtn dataV="300" inc="3" selected>5+3</SegBtn><SegBtn dataV="600" inc="5">10+5</SegBtn>
        </SegRow>
        <label className="text-[#a99e86] text-[10px] tracking-[3px] font-bold">DIFFICULTY</label>
        <SegRow id="seg-difficulty"><SegBtn dataV="casual">Casual</SegBtn><SegBtn dataV="tactician" selected>Tactician</SegBtn><SegBtn dataV="master">Master</SegBtn></SegRow>
        <label className="text-[#a99e86] text-[10px] tracking-[3px] font-bold">YOUR COLOUR</label>
        <div className="piece-pick flex gap-3 justify-center">
          <button className="selected" data-v="w" onClick={pickColor}><img src="assets/chessSetDefault_KingWhite_160.webp" alt="White" className="w-13 h-13 w-[52px] h-[52px]" /><span className="text-[9px] tracking-[1.5px] font-extrabold text-[#a99e86]">WHITE</span></button>
          <button data-v="random" onClick={pickColor}><img src="assets/chessSetDefault_QueenBlack_160.webp" alt="Random" className="w-[52px] h-[52px]" /><span className="text-[9px] tracking-[1.5px] font-extrabold text-[#a99e86]">RANDOM</span></button>
          <button data-v="b" onClick={pickColor}><img src="assets/chessSetDefault_KingBlack_160.webp" alt="Black" className="w-[52px] h-[52px]" /><span className="text-[9px] tracking-[1.5px] font-extrabold text-[#a99e86]">BLACK</span></button>
        </div>
        <button className="btn btn-gold w-full py-[17px] text-[17px]" onClick={startAiGame}>START GAME</button>
      </SetupShell>
    );
  }
  if (screen === 'setup-local') {
    return (
      <SetupShell title="Play 1v1" onBack={() => setScreen('menu')}>
        <label className="text-[#a99e86] text-[10px] tracking-[3px] font-bold">TIME CONTROL</label>
        <SegRow id="seg-time-local"><SegBtn dataV="60" inc="0">1+0</SegBtn><SegBtn dataV="180" inc="2">3+2</SegBtn><SegBtn dataV="300" inc="3" selected>5+3</SegBtn><SegBtn dataV="600" inc="5">10+5</SegBtn></SegRow>
        <div className="text-[#a99e86] text-[12px] leading-relaxed">Two players share one device — White moves first. Tap a piece, then tap a highlighted square.</div>
        <button className="btn btn-gold w-full py-[17px] text-[17px]" onClick={startLocalGame}>START GAME</button>
      </SetupShell>
    );
  }
  if (screen === 'online') {
    return (
      <SetupShell title="Online Room" onBack={() => setScreen('menu')}>
        <button className="btn btn-gold w-full py-[17px] text-[17px]" onClick={createRoom}>➕ CREATE ROOM</button>
        <div className="flex items-center gap-3 text-[#a99e86] text-[12px]"><span className="flex-1 h-px bg-white/10" /><span>or</span><span className="flex-1 h-px bg-white/10" /></div>
        <label className="text-[#a99e86] text-[10px] tracking-[3px] font-bold">JOIN BY CODE</label>
        <div className="flex gap-2">
          <input id="join-code" maxLength={5} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="ABCDE"
                 className="flex-1 min-w-0 bg-[#0a0f1e] border-2 border-white/10 rounded-2xl px-3 py-3 text-[#ffd97a] text-[25px] font-mono font-extrabold tracking-[10px] text-center uppercase outline-none focus:border-[#e3b75b]" />
          <button className="btn btn-dark px-6 font-extrabold" onClick={() => joinRoom(document.getElementById('join-code').value)}>JOIN</button>
        </div>
      </SetupShell>
    );
  }
  if (screen === 'room') {
    const o = onlineRef.current;
    const players = o?.players || [{ name: tgName() || 'You' }];
    const full = players.length >= 2;
    return (
      <SetupShell title="Your Room" onBack={() => { if (onlineRef.current?.peer) try { onlineRef.current.peer.destroy(); } catch (e) { } onlineRef.current = null; setScreen('online'); }}>
        <div className="rounded-2xl border border-dashed border-[rgba(227,183,91,.35)] bg-[#131a33] px-4 py-5 flex flex-col items-center gap-2">
          <div className="text-[9px] tracking-[5px] text-[#a99e86] font-extrabold">INVITE CODE</div>
          <div className="text-[46px] leading-none font-black tracking-[18px] text-[#ffd97a] indent-[18px]" style={{ textShadow: '0 0 28px rgba(255,217,122,.35)' }}>{o?.code || '·····'}</div>
          <div className="flex gap-2 flex-wrap justify-center">
            <button className="btn btn-dark text-[12px] px-4 py-2" onClick={() => { try { navigator.clipboard.writeText(o?.code || ''); setToast('Code copied'); } catch (e) { } }}>📋 Copy</button>
            <button className="btn btn-gold text-[11px] px-4 py-2" onClick={() => {
              const code = o?.code || '';
              const tgw = window.Telegram && window.Telegram.WebApp;
              if (tgw) { try { tgw.openTelegramLink(`https://t.me/ShadowGameEnBot?inline=${encodeURIComponent('chess ' + code)}`); return; } catch (e) { } }
              const link = `https://xlewin.github.io/ShadowGamesEN/webapp/chess/?room=${code}`;
              try { navigator.clipboard.writeText(link); setToast('Invite link copied'); } catch (e) { setToast(link); }
            }}>🔗 Invite friends</button>
          </div>
        </div>
        <div className="flex flex-col gap-2">{players.map((p, i) => (<div key={i} className="flex items-center gap-3 rounded-2xl bg-[#131a33] border border-white/10 px-4 py-3"><img src={AVATARS.you} alt="" className="w-9 h-9 rounded-full border border-[#8a6b2f]" /><span className="font-bold">{p.name}{i === 0 && o?.isHost ? ' (You)' : ''}</span><span className="ml-auto text-[10px] tracking-[2px] text-[#a99e86] font-bold">{i === 0 ? 'HOST' : 'JOINED'}</span></div>))}</div>
        {o?.isHost
          ? <button className="btn btn-gold w-full py-[17px] text-[17px]" disabled={!full} onClick={() => {
              const o2 = onlineRef.current;
              const names = [tgName() || 'You', o2.conn?._name || 'Opponent'];
              const tSel = document.querySelector('#time-room .seg-btn.selected');
              const clockSeconds = +(tSel?.dataset.t || 300);
              const inc = +(tSel?.dataset.inc || 3);
              o2.started = true;
              try { o2.conn?.send({ type: 'start', players: names.map(n => ({ name: n })), clockSeconds, inc }); } catch (e) { }
              startMatch([{ name: names[0], color: 'w', isBot: false, isLocal: true, avatar: AVATARS.you }, { name: names[1], color: 'b', isBot: false, isLocal: false, isRemote: true, avatar: AVATARS.you }], 'online', { seconds: clockSeconds, inc }, 'w');
              o2.syncInterval = setInterval(() => { if (G.current.over) { clearInterval(o2.syncInterval); return; } broadcastState(); }, 2000);
            }}>{full ? `START GAME (${players.length})` : 'WAITING FOR OPPONENT…'}</button>
          : <div className="text-[#a99e86] text-[13px] text-center">Waiting for host…</div>}
        <div id="time-room" className={`${o?.isHost ? '' : 'hidden'}`}>
          <label className="text-[#a99e86] text-[10px] tracking-[3px] font-bold">TIME CONTROL</label>
          <SegRow id="seg-time-room"><SegBtn dataV="60" inc="0">1+0</SegBtn><SegBtn dataV="180" inc="2">3+2</SegBtn><SegBtn dataV="300" inc="3" selected>5+3</SegBtn><SegBtn dataV="600" inc="5">10+5</SegBtn></SegRow>
        </div>
      </SetupShell>
    );
  }

  /* ═══ GAME SCREEN ═══ */
  const g = G.current;
  const orientNow = g.orientation;
  const ranksNow = orientNow === 'w' ? RANKS_W : RANKS_B;
  const filesNow = orientNow === 'w' ? FILES.split('') : FILES.split('').reverse();
  const turnColor = g.game.turn();
  const meNow = me();

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: 'radial-gradient(900px 550px at 50% -15%, #141d3a 0%, transparent 55%), #060c1a' }}>
      <div className="flex items-center justify-between w-full max-w-[760px] px-2.5 pt-2.5 gap-2 z-10">
        <button className="iconbtn w-12 h-12 rounded-2xl border border-[rgba(227,183,91,.22)] bg-[#131a33] text-[#e3b75b] text-[19px]" onClick={() => setScreen('menu')} aria-label="Back to menu">←</button>
        <div className={`flex items-center gap-2.5 rounded-full border border-[rgba(227,183,91,.22)] bg-[#131a33] px-5 py-2.5 text-[12px] font-extrabold tracking-[2px] ${turnColor === 'b' ? 'text-[#8fd0ff]' : ''}`}>
          <span className="w-3 h-3 rounded-full bg-[#f2ead9]" />
          {g.over ? 'GAME OVER' : `${turnColor === 'w' ? 'WHITE' : 'BLACK'} TO MOVE`}
        </div>
        <button className="iconbtn w-12 h-12 rounded-2xl border border-[rgba(227,183,91,.22)] bg-[#131a33] text-[19px]" onClick={() => { sfx.current.toggle(); bump(); }} aria-label="Sound">{sfx.current.mutedRef.current ? '🔇' : '🔊'}</button>
      </div>

      <div className="flex-1 flex items-center justify-center min-h-0 px-2 z-[1]">
        <div className="relative rounded-[14px]" style={{
          width: 'min(94vw, 55vh, 520px)', aspectRatio: '1 / 1', overflow: 'hidden',
          background: "url('assets/chessBoardDefault_1280.webp') center/cover no-repeat",
          boxShadow: '0 24px 70px rgba(0,0,0,.75), 0 0 55px rgba(103,232,249,.28), inset 0 0 0 2px rgba(8,51,68,.9)',
        }}>
          <div className="absolute" style={{ inset: '4.6%', display: 'grid', gridTemplateColumns: 'repeat(8,1fr)', gridTemplateRows: 'repeat(8,1fr)', borderRadius: 4, overflow: 'hidden' }}>
            {boardCells.map(cell => (
              <div key={cell.square + cell.ri}
                   data-square={cell.square}
                   onClick={() => tapSquare(cell.square)}
                   className={`relative flex items-center justify-center ${cell.light ? 'sq-light' : 'sq-dark'} ${lastMove && (lastMove.from === cell.square || lastMove.to === cell.square) ? 'last-move-glow' : ''} ${checkSq === cell.square ? 'in-check-cell' : ''} ${g.selected === cell.square ? 'selected-cell' : ''}`}>
                {g.selected && g.legalTargets.some(t => t.to === cell.square) && (
                  g.legalTargets.find(t => t.to === cell.square).capture
                    ? <div className="absolute inset-[6%] rounded-[4px] border-[3px] border-[rgba(255,240,170,.6)] pointer-events-none" />
                    : <div className="w-[30%] h-[30%] rounded-full bg-[rgba(255,254,241,.38)] pointer-events-none" />
                )}
              </div>
            ))}
          </div>
          {/* Pieces */}
          <div className="absolute pointer-events-none" style={{ inset: '4.6%', zIndex: 3 }}>
            {g.game.board().flatMap((row, rIdx) => row.map((p, cIdx) => {
              if (!p) return null;
              const fi = orientNow === 'w' ? cIdx : 7 - cIdx;
              const ri = orientNow === 'w' ? rIdx : 7 - rIdx;
              const left = fi * 12.5, top = ri * 12.5;
              const key = p.color + p.type;
              const square = FILES[cIdx] + (8 - rIdx);
              return (
                <div key={square} className="chess-piece"
                     style={{ left: `${left}%`, top: `${top}%`, backgroundImage: `url('${PIECES[key]}')` }}
                     onClick={() => tapSquare(square)} />
              );
            }))}
          </div>
          {/* Coordinates */}
          {ranksNow.map((r, i) => <div key={'r' + r} className="absolute text-[rgba(165,243,252,.62)] text-[clamp(8px,1.6vmin,12px)] font-bold" style={{ left: '1.4%', top: `${4.6 + (i + 0.5) * 11.35}%` }}>{r}</div>)}
          {filesNow.map((f, i) => <div key={'f' + f} className="absolute text-[rgba(165,243,252,.62)] text-[clamp(8px,1.6vmin,12px)] font-bold" style={{ bottom: '1.2%', left: `${4.6 + (i + 0.5) * 11.35}%` }}>{f}</div>)}
        </div>
      </div>

      <div className="flex items-stretch justify-between w-full max-w-[740px] gap-2 px-3 pb-[calc(12px+env(safe-area-inset-bottom))] z-10">
        <div className="flex flex-col justify-center gap-1 rounded-2xl border border-white/10 bg-[#131a33]/80 px-3 py-1.5 min-w-[120px]">
          <div className="text-[8px] tracking-[2px] text-[#a99e86] font-bold">CAPTURED</div>
          <div className="flex flex-wrap gap-0.5">{mineCap.map((t, i) => <img key={i} src={PIECES[(myColor === 'w' ? 'b' : 'w') + t]} alt={t} className="w-[18px] h-[18px]" />)}</div>
          <div className="flex flex-wrap gap-0.5 opacity-50">{oppCap.map((t, i) => <img key={i} src={PIECES[myColor + t]} alt={t} className="w-[18px] h-[18px]" />)}</div>
          <div className="text-[11px] font-extrabold text-[#ffd97a]">{materialAdv > 0 ? `+${materialAdv}` : materialAdv < 0 ? `${materialAdv}` : ''}</div>
        </div>
        <div className="flex flex-col rounded-2xl border border-white/10 bg-[#131a33]/80 px-3 py-1.5 max-w-[300px] flex-1">
          <div className="text-[8px] tracking-[2px] text-[#a99e86] font-bold">MOVES</div>
          <div className="overflow-y-auto font-mono text-[12px] leading-relaxed max-h-16">
            {movesHtml.map(([n, w, b]) => <div key={n}><b className="text-[#e3b75b]">{n}.</b> {w}{b ? ' ' + b : ''}</div>)}
          </div>
        </div>
        <div className="flex gap-1.5">
          {g.players.map((p, i) => {
            const active = g.game.turn() === p.color && !g.over;
            const clockSec = g.clock[p.color];
            const low = clockSec <= 10 && clockSec > 0;
            return (
              <div key={i} className={`flex items-center gap-1.5 rounded-2xl border px-2 py-1.5 ${active ? 'border-[#e3b75b] shadow-[0_0_18px_rgba(227,183,91,.25)]' : 'border-white/10'} bg-[#131a33]/80`}>
                <img src={AVATARS[p.isBot ? p.name.split(' ')[0].toLowerCase() : 'you'] || AVATARS.you} alt="" className="w-8 h-8 rounded-full border border-[#8a6b2f]" />
                <span className="flex flex-col leading-tight">
                  <span className="text-[11px] font-extrabold max-w-[84px] truncate">{p.name}</span>
                  <span className="text-[8px] tracking-[2px] text-[#a99e86]">{p.color === 'w' ? 'WHITE' : 'BLACK'}</span>
                </span>
                <span className={`font-mono text-[12px] font-extrabold rounded-lg border px-1.5 py-1 min-w-[46px] text-center ${low ? 'border-[#ff5a4d] text-[#ff7a6b] animate-pulse' : 'border-white/10 text-[#f2ead9]'} ${active ? 'bg-[#e3b75b]/15' : ''}`}>{fmtClock(clockSec)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Promo modal */}
      {promo && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="sg-grad-panel rounded-3xl border border-[#e3b75b] px-6 py-6 text-center flex flex-col items-center gap-3">
            <div className="text-[13px] tracking-[4px] text-[#e3b75b] font-extrabold">PROMOTE PAWN</div>
            <div className="flex gap-3">
              {['q', 'r', 'b', 'n'].map(piece => (
                <button key={piece} className="w-[74px] h-[74px] rounded-2xl border border-white/10 bg-[#1a2243] hover:border-[#e3b75b]" onClick={() => { attemptMove(promo.from, promo.to, piece); setPromo(null); }}>
                  <img src={PIECES[(g.game.turn()) + piece]} alt={piece} className="w-full h-full object-contain" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Win overlay */}
      {g.over && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="relative sg-grad-panel rounded-3xl border border-[#e3b75b] px-7 py-7 text-center w-[min(390px,calc(100vw-48px))] flex flex-col items-center gap-3 overflow-hidden">
            <img className="w-20 h-20 object-contain" src="assets/crown.webp" alt="Crown" />
            <div className="text-[10px] tracking-[6px] text-[#e3b75b] font-extrabold">{g.result === 'checkmate' ? 'VICTORY' : 'DRAW'}</div>
            <div className="game-title-word text-[30px] font-black">{g.result === 'checkmate' ? 'Checkmate!' : g.result === 'timeout' ? "Flag fall!" : 'Draw'}</div>
            <div className="text-[#a99e86] text-[13px]">{g.result === 'checkmate' ? (g.winner === myColor ? 'Well played.' : 'Better luck next time.') : 'The game ended in a draw.'}</div>
            <button className="btn btn-gold w-full py-4 text-[16px]" onClick={() => {
              if (g.mode === 'ai') startAiGame(); else if (g.mode === 'local') startLocalGame();
              else if (onlineRef.current?.isHost) { resetOnlineMatch(); } else if (onlineRef.current?.conn) { try { onlineRef.current.conn.send({ type: 'rematch' }); } catch (e) { } }
            }}>PLAY AGAIN</button>
            <button className="btn btn-dark w-full py-3 text-[14px]" onClick={() => setScreen('menu')}>MAIN MENU</button>
          </div>
        </div>
      )}

      {toast && <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-30 rounded-xl border border-[rgba(227,183,91,.3)] bg-[#1a2243] px-5 py-3 text-[13px] shadow-lg">{toast}</div>}

      {/* lastMove / check CSS */}
      <style>{`
        .selected-cell { box-shadow: inset 0 0 0 3px rgba(255,240,170,.7); background: rgba(255,240,170,.32) !important; }
        .last-move-glow { background: rgba(255,254,241,.22) !important; }
        .in-check-cell { animation: check-pulse 1s ease-in-out infinite; }
        @keyframes check-pulse { 0%,100% { box-shadow: inset 0 0 0 3px rgba(239,68,68,.5); } 50% { box-shadow: inset 0 0 22px 4px rgba(239,68,68,.75); } }
      `}</style>
    </div>
  );

  function pickColor(e) {
    const btn = e.currentTarget.closest('button');
    const group = btn.parentElement;
    group.querySelectorAll('button[data-v]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  }
}

function SetupShell({ id, title, onBack, children }) {
  return (
    <div id={id} className="sg-bg min-h-full flex flex-col items-center justify-center px-4 py-6">
      <div className="sg-grad-panel rounded-3xl px-6 py-6 w-[min(440px,calc(100vw-32px))] flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
        <button className="self-start w-11 h-11 rounded-2xl border border-white/10 bg-[#1a2243] text-[#e3b75b] text-[19px]" onClick={onBack} aria-label="Back">←</button>
        <h2 className="text-[25px] font-black tracking-[2px] flex flex-col leading-tight"><span className="text-[9px] tracking-[5px] text-[#e3b75b]">SHADOW GAMES</span>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function SegRow({ id, children }) {
  return (
    <div id={id} className="flex gap-2" onClick={(e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      btn.parentElement.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      haptic('light');
    }}>{children}</div>
  );
}

function SegBtn({ dataV, inc, selected, children, onClick }) {
  return <button className={`flex-1 py-3 text-[15px] font-extrabold rounded-2xl border-2 transition-all ${selected ? 'border-[#e3b75b] text-[#ffd97a] bg-[#e3b75b]/10' : 'border-white/10 text-[#a99e86] bg-[#1a2243]'}`}
    data-t={dataV} data-inc={inc} data-v={dataV} onClick={onClick}>{children}</button>;
}
