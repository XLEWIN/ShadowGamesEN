import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ORDER, COLORS, MAIN_PATH, SAFE, HOME_PATH, MAIN_PATH_INDEX, HOME_LOOKUP, ARM_FILL,
  freshTokens, legalMoves, applyMove, aiPickMove, tokenXY, makeRoomCode,
  PEER_PREFIX, ICE_SERVERS, cellKey,
} from './engine.js';
import { tg, tgReady, tgName, haptic, backButton } from '../shared/telegram.js';
import { createSfx } from '../shared/audio.js';
import { callServer, inviteFriends, spectateCode } from '../shared/lobby.js';
import SpectateView from '../shared/SpectateView.jsx';

const AVATARS = { red: 'assets/petey.webp', yellow: 'assets/bomby.webp', green: 'assets/bruno.webp', blue: 'assets/bulby.webp' };
const avatarFor = (p) => (p && p.isBot) ? (AVATARS[p.color] || 'assets/guest.webp') : 'assets/guest.webp';
const PIP_LAYOUTS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const PIECES = { red: 'assets/pieces_red.svg', blue: 'assets/pieces_blue.svg', green: 'assets/pieces_green.svg', yellow: 'assets/pieces_yellow.svg' };

/* ── Board cells (module-scope, computed once) ─────────────── */
const CELLS = (() => {
  const cells = [];
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const inCross = (r >= 6 && r <= 8) || (c >= 6 && c <= 8);
      if (!inCross) continue;
      const key = r + ',' + c;
      const home = HOME_LOOKUP[key];
      const mp = MAIN_PATH_INDEX[key];
      let cls = 'ludo-cell', star = false;
      if (home) { cls += ' ludo-cell-' + home; }
      else if (mp !== undefined) {
        if (ARM_FILL[mp]) cls += ' ludo-cell-' + ARM_FILL[mp];
        else if (SAFE.has(mp)) cls += ' ludo-cell-safe';
        star = SAFE.has(mp);
      }
      cells.push({ key, r, c, cls, star, colorCls: home ? home : ARM_FILL[mp] });
    }
  }
  return cells;
})();
const STAR = '<svg viewBox="0 0 24 24" fill="currentColor" style="width:52%;height:52%" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

function DiceFace({ n, rolling }) {
  const cells = new Array(9).fill(false);
  (PIP_LAYOUTS[n] || []).forEach(i => (cells[i] = true));
  return (
    <div className={`dice-face ${rolling ? 'dice-rolling' : ''}`} aria-label={`Die face ${n}`}>
      {cells.map((on, i) => on ? <div key={i} className="pip" /> : <div key={i} className="pip-empty" />)}
    </div>
  );
}

export default function LudoApp() {
  const [screen, setScreen] = useState('menu');
  const [toast, setToast] = useState('');
  const [diceN, setDiceN] = useState(5);
  const [rolling, setRolling] = useState(false);
  const [, setTick] = useState(0);
  const sfx = useMemo(() => createSfx(), []);
  const sessionRef = useRef(0);
  const onlineRef = useRef(null); // PeerJS session { isHost, code, peer, conn, myColor, mySeat, started, conns }
  const G = useRef(null);       // { mode, players, tokens, turnIdx, sixes, dice, awaitingMove, busy, over, winner, highlight }
  const bump = () => setTick(t => t + 1);
  if (!G.current) G.current = freshGame();

  function freshGame() {
    return {
      mode: null, players: [], tokens: freshTokens(), turnIdx: 0, sixes: 0,
      dice: null, awaitingMove: false, busy: false, over: false, winner: null,
      highlight: [],
    };
  }
  const currentPlayer = () => G.current.players[G.current.turnIdx];
  const currentColor = () => currentPlayer()?.color;

  /* ── Telegram back button ──────────────────────── */
  useEffect(() => { tgReady(); backButton(() => setScreen('menu'), screen !== 'menu'); }, [screen]);

  // Auto-join via invite link (?room=CODE)
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const spectate = spectateCode();
  if (spectate) {
    return (
      <div className="fixed inset-0 sg-bg">
        <SpectateView code={spectate} game="ludo" onJoin={() => { window.location.href = `./?room=${encodeURIComponent(spectate)}`; }} />
      </div>
    );
  }

  /* ── Helpers ───────────────────────────────────── */
  const announce = (msg) => setToast(msg);
  const myName = () => tgName() || 'You';

  function startGame(players, mode) {
    sessionRef.current++;
    G.current = { ...freshGame(), players, mode };
    setScreen('game');
    setDiceN(5);
    setRolling(false);
    bump();
    scheduleBotIfNeeded();
  }

  const myTurn = () => {
    const p = currentPlayer();
    if (!p || p.isBot || p.isRemote) return false;
    if (G.current.mode === 'local') return true;
    return true; // local player always acts on own turn (this hook only fires for human players)
  };

  function passTurn() {
    G.current.dice = null;
    G.current.sixes = 0;
    G.current.awaitingMove = false;
    G.current.highlight = [];
    G.current.turnIdx = (G.current.turnIdx + 1) % G.current.players.length;
    setRolling(false);
    bump();
    scheduleBotIfNeeded();
  }
  const scheduleBotIfNeeded = () => {
    const p = currentPlayer();
    if (p && p.isBot && !G.current.over) {
      const t = sessionRef.current;
      setTimeout(() => { if (t === sessionRef.current) rollDice(); }, 750);
    }
  };

  function rollDice() {
    if (G.current.over || G.current.busy || G.current.dice !== null) return;
    const p = currentPlayer();
    if (!p || p.isRemote) return;
    const dice = 1 + Math.floor(Math.random() * 6);
    G.current.busy = true;
    setRolling(true);
    sfx.roll();
    let ticks = 0;
    const t = sessionRef.current;
    const iv = setInterval(() => {
      if (t !== sessionRef.current) { clearInterval(iv); return; }
      setDiceN(1 + Math.floor(Math.random() * 6));
      ticks++;
      if (ticks >= 10) {
        clearInterval(iv);
        G.current.dice = dice;
        setDiceN(dice);
        setRolling(false);
        G.current.busy = false;
        afterRoll();
      }
    }, 45);
  }

  function afterRoll() {
    const color = currentColor();
    const dice = G.current.dice;
    const moves = legalMoves(G.current.tokens, color, dice);
    if (moves.length === 0) {
      announce(`No legal move for ${dice}`);
      const t = sessionRef.current;
      setTimeout(() => {
        if (t !== sessionRef.current) return;
        if (dice === 6) G.current.sixes += 1; else G.current.sixes = 0;
        if (G.current.sixes >= 3) { G.current.sixes = 0; passTurn(); return; }
        if (dice === 6) { G.current.dice = null; setRolling(false); bump(); scheduleBotIfNeeded(); return; }
        passTurn();
      }, 800);
      return;
    }
    G.current.awaitingMove = true;
    G.current.highlight = moves.map(i => `${color}:${i}`);
    if (currentPlayer().isBot) {
      const t = sessionRef.current;
      setTimeout(() => {
        if (t !== sessionRef.current) return;
        const pick = aiPickMove(G.current.tokens, color, G.current.dice, moves);
        doMove(pick);
      }, 650);
    }
    bump();
    // Online: host informs guests about dice + available moves
    if (G.current.mode === 'online' && onlineRef.current?.isHost) broadcastState();
  }

  function doMove(idx) {
    const color = currentColor();
    const dice = G.current.dice;
    if (!G.current.awaitingMove) return;
    const moves = legalMoves(G.current.tokens, color, dice);
    if (!moves.includes(idx)) { sfx.illegal(); return; }
    G.current.awaitingMove = false;
    G.current.highlight = [];
    const events = applyMove(G.current.tokens, color, idx, dice);
    if (events.includes('capture')) sfx.capture(); else sfx.move();
    haptic('medium');
    advanceAfterMove(events);
    bump();
    if (G.current.mode === 'online' && onlineRef.current?.isHost) setTimeout(broadcastState, 120);
  }

  function advanceAfterMove(events) {
    const color = currentColor();
    const finishedAll = G.current.tokens[color].every(t => t.step === 56);
    if (finishedAll) {
      G.current.over = true;
      G.current.winner = color;
      G.current.dice = null;
      sfx.win();
      bump();
      return;
    }
    const captured = events.includes('capture');
    if (G.current.dice === 6) G.current.sixes += 1; else G.current.sixes = 0;
    if (G.current.sixes >= 3) {
      announce('Three 6s in a row — turn forfeited!');
      G.current.sixes = 0;
      passTurn();
      return;
    }
    if (captured || G.current.dice === 6) {
      G.current.dice = null;
      G.current.awaitingMove = false;
      bump();
      scheduleBotIfNeeded();
      return;
    }
    passTurn();
  }

  /* ────────── Online rooms (PeerJS) ────────── */
  function broadcastState() {
    const o = onlineRef.current;
    if (!o || !o.isHost) return;
    const payload = {
      type: 'state',
      tokens: G.current.tokens,
      turnIdx: G.current.turnIdx,
      sixes: G.current.sixes,
      dice: G.current.dice,
      over: G.current.over,
      winner: G.current.winner,
      players: G.current.players.map(p => ({ color: p.color, name: p.name })),
    };
    const conns = o.conns || (o.conn ? [o.conn] : []);
    for (const c of conns) { try { c.send(payload); } catch (e) { /* closed */ } }
  }

  function clientState(data) {
    G.current = {
      ...G.current,
      tokens: data.tokens,
      turnIdx: data.turnIdx,
      sixes: data.sixes,
      dice: data.dice,
      over: data.over,
      winner: data.winner,
      players: data.players.map(p => ({ ...p, isBot: false, isLocal: p.color === onlineRef.current?.myColor, isRemote: p.color !== onlineRef.current?.myColor })),
      awaitingMove: data.dice !== null && G.current.players.find(p => p.color === onlineRef.current?.myColor) && currentColor() === onlineRef.current?.myColor,
      highlight: [],
    };
    setDiceN(data.dice || 1);
    bump();
    if (data.over) setTimeout(() => bump(), 50);
  }

  function hostOnData(conn, data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'hello') { conn._name = String(data.name || 'Player').slice(0, 24); refreshRoomLobby(); return; }
    if (data.type === 'roll') {
      const p = currentPlayer();
      const seat = (onlineRef.current.conns.indexOf(conn) + 1);
      if (p && G.current.players[G.current.turnIdx] === G.current.players[seat]) rollDice();
      return;
    }
    if (data.type === 'move' && G.current.awaitingMove) {
      const seat = (onlineRef.current.conns.indexOf(conn) + 1);
      const p = G.current.players[G.current.turnIdx];
      if (p && G.current.players[G.current.turnIdx] === G.current.players[seat]) doMove(data.token | 0);
      return;
    }
  }

  function refreshRoomLobby() {
    const o = onlineRef.current;
    if (!o || !o.isHost) return;
    const names = [myName(), ...(o.conns || []).map(c => c._name || 'Player')];
    const players = names.map((name, i) => ({ color: ORDER[i], name }));
    o.players = players;
    bump();
    for (const c of (o.conns || [])) {
      try { c.send({ type: 'room', code: o.code, players }); } catch (e) { }
    }
  }

  function createRoom() {
    if (typeof Peer === 'undefined') { announce('Online unavailable. Try bots!'); return; }
    const code = makeRoomCode();
    const peer = new Peer(PEER_PREFIX + code, { debug: 1, config: { iceServers: ICE_SERVERS } });
    onlineRef.current = { isHost: true, code, peer, conns: [], spectators: [], myColor: 'red', mySeat: 0, players: [{ name: myName(), color: 'red' }], started: false };
    peer.on('open', () => {
      callServer('lobbyCreate', { code, game: 'ludo', maxPlayers: 4 });
      bump();
    });
    peer.on('connection', conn => {
      if ((onlineRef.current.conns || []).length >= 3) { conn.close(); return; }
      conn.on('open', () => {
        onlineRef.current.conns = [...(onlineRef.current.conns || []), conn];
        conn.on('data', d => hostOnData(conn, d));
        conn.on('close', () => hostOnLeave(conn));
        refreshRoomLobby();
      });
    });
    peer.on('error', () => announce('Room error — try again.'));
    setScreen('room');
    bump();
  }

  function hostOnLeave(conn) {
    const o = onlineRef.current;
    if (!o) return;
    o.conns = (o.conns || []).filter(c => c !== conn);
    if (!o.started) { refreshRoomLobby(); return; }
    announce('A player left — a bot takes over.');
    const idx = (o.players || []).findIndex(p => p.name === conn._name);
    if (idx >= 0) G.current.players[idx] = { ...G.current.players[idx], isBot: true, isRemote: false, name: 'Shadow Bot' };
    bump();
    scheduleBotIfNeeded();
  }

  function joinRoom(code) {
    if (typeof Peer === 'undefined') { announce('Online unavailable.'); return; }
    code = (code || '').trim().toUpperCase();
    if (code.length !== 5) { announce('Room code must be 5 characters.'); return; }
    const peer = new Peer(undefined, { debug: 1, config: { iceServers: ICE_SERVERS } });
    onlineRef.current = { isHost: false, code, peer, conn: null, myColor: null, started: false };
    // If nobody is hosting yet, the first player to open an invite becomes host.
    const promoteTimer = setTimeout(() => {
      const o = onlineRef.current;
      if (o && !o.isHost && !o.conn?.open) {
        try { o.peer.destroy(); } catch (e) { /* ignore */ }
        createRoom(code);
      }
    }, 1800);
    peer.on('open', () => {
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
      onlineRef.current.conn = conn;
      conn.on('open', () => {
        clearTimeout(promoteTimer);
        conn.send({ type: 'hello', name: myName() });
        callServer('lobbyJoin', { code });
      });
      conn.on('data', d => {
        if (d.type === 'room') { onlineRef.current.players = d.players; setScreen('room'); bump(); }
        else if (d.type === 'start') {
          onlineRef.current.myColor = ORDER[d.yourSeat];
          onlineRef.current.mySeat = d.yourSeat;
          const players = d.players.map((p, i) => ({ color: ORDER[i], name: p.name + (i === d.yourSeat ? ' (You)' : ''), isLocal: i === d.yourSeat, isRemote: i !== d.yourSeat }));
          onlineRef.current.players = players;
          startGame(players, 'online');
        }
        else if (d.type === 'state') clientState(d);
      });
      conn.on('close', () => { announce('Disconnected from room.'); setScreen('menu'); });
      setScreen('room');
      bump();
    });
    peer.on('error', () => announce('Connection failed — is the code right?'));
  }

  function hostStartOnline() {
    const o = onlineRef.current;
    if (!o || !o.isHost || !o.conns?.length) return;
    const names = [myName(), ...o.conns.map(c => c._name || 'Player')];
    o.started = true;
    const players = names.map((name, i) => ({ color: ORDER[i], name, isLocal: i === 0, isRemote: i !== 0 }));
    o.conns.forEach((c, i) => c.send({ type: 'start', yourSeat: i + 1, players: names.map(n => ({ name: n })) }));
    startGame(players, 'online');
  }

  /* ── Render helpers ───────────────────────────── */
  const g2 = G.current;
  const buckets = new Map();
  for (const color of ORDER) {
    g2.tokens[color].forEach((tok, i) => {
      const [x, y] = tokenXY(color, tok, i);
      const key = tok.step < 0 ? `${color}-base-${i}` : tok.step >= 56 ? `done-${color}-${i}` : `${Math.round(x)},${Math.round(y)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ color, idx: i, x, y, step: tok.step });
    });
  }
  const tokenList = [];
  for (const list of buckets.values()) {
    const n = list.length;
    list.forEach((t, i) => {
      let x = t.x, y = t.y;
      if (n > 1 && t.step >= 0) {
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
        x += Math.cos(ang) * 2.1; y += Math.sin(ang) * 2.1;
      }
      tokenList.push({ ...t, x, y });
    });
  }

  const cur = currentPlayer();
  const canRoll = !G.current.over && !G.current.busy && G.current.dice === null && cur && !cur.isBot && !cur.isRemote;

  /* ═══ RENDER ═══ */
  if (screen === 'menu') {
    return (
      <div className="sg-bg min-h-full flex flex-col items-center justify-center px-5 py-8">
        <div className="flex flex-col items-center gap-3 w-full max-w-[440px] text-center">
          <img src="assets/icon.webp" alt="Ludo" draggable="false" className="w-[130px] h-[130px] object-contain drop-shadow-[0_14px_40px_rgba(242,140,40,.35)] animate-[floaty_3.4s_ease-in-out_infinite]" />
          <h1 className="game-title-word text-[clamp(72px,21vw,112px)] font-black leading-none">LUDO</h1>
          <div className="text-[#a99e86] text-[12px]">Race your pawns home — the Shadow Games way.</div>
          <div className="flex flex-col gap-3 w-full mt-2">
            <button className="btn btn-gold py-[17px] text-[17px] w-full" onClick={() => { haptic(); setScreen('setup-bots'); }}>🤖 PLAY VS BOTS</button>
            <button className="btn btn-dark py-[17px] text-[17px] w-full" onClick={() => { haptic(); setScreen('online'); }}>➕ CREATE ROOM</button>
            <button className="btn btn-dark py-[17px] text-[17px] w-full" onClick={() => { haptic(); setScreen('setup-local'); }}>👥 PLAY IN PERSON</button>
          </div>
          <div className="text-[#a99e86] text-[11px] mt-3 flex gap-2 items-center">
            <a className="text-[#e3b75b] font-bold no-underline" href="../index.html">← All Games</a><span className="opacity-50">•</span>
            <a className="text-[#e3b75b] font-bold no-underline" href="https://t.me/ShadowGameEnBot">@ShadowGameEnBot</a>
          </div>
        </div>
      </div>
    );
  }
  if (screen === 'setup-bots') {
    return (
      <SetupShell title="Play vs Bots" onBack={() => setScreen('menu')}>
        <label className="text-[#a99e86] text-[10px] tracking-[3px] font-bold">BOT COUNT</label>
        <div className="flex gap-2" id="bot-count">
          {[1, 2, 3].map(n => (
            <SegBtn key={n} selected={(G.current.botCount || 3) === n} onClick={() => { G.current.botCount = n; bump(); }}>{n}</SegBtn>
          ))}
        </div>
        <label className="text-[#a99e86] text-[10px] tracking-[3px] font-bold mt-1">YOUR COLOUR</label>
        <div className="flex gap-3.5 justify-center">
          {['red', 'yellow', 'green', 'blue'].map(c => (
            <button key={c} aria-label={c} onClick={() => { G.current.myColor = c; bump(); }}
                    className={`w-14 h-14 rounded-full transition-transform duration-150 ${(G.current.myColor || 'red') === c ? 'scale-115 ring-4 ring-[#ffd97a]' : ''}`}
                    style={{ background: `radial-gradient(circle at 35% 32%, ${COLORS[c].light}, ${COLORS[c].hex} 55%, ${COLORS[c].dark})` }} />
          ))}
        </div>
        <button className="btn btn-gold w-full py-[17px] text-[17px] mt-2" onClick={startBotsGame}>START GAME</button>
      </SetupShell>
    );
  }
  if (screen === 'setup-local') {
    return (
      <SetupShell title="Play in Person" onBack={() => setScreen('menu')}>
        <label className="text-[#a99e86] text-[10px] tracking-[3px] font-bold">PLAYERS</label>
        <div className="flex gap-2">
          {[2, 3, 4].map(n => (
            <SegBtn key={n} selected={(G.current.localCount || 4) === n} onClick={() => { G.current.localCount = n; bump(); }}>{n}</SegBtn>
          ))}
        </div>
        <button className="btn btn-gold w-full py-[17px] text-[17px] mt-2" onClick={() => {
          const n = G.current.localCount || 4;
          const players = ORDER.slice(0, n).map(color => ({ color, name: COLORS[color].name, isBot: false, isLocal: true }));
          startGame(players, 'local');
        }}>START GAME</button>
      </SetupShell>
    );
  }
  if (screen === 'online') {
    return (
      <SetupShell title="Online Room" onBack={() => setScreen('menu')}>
        <button className="btn btn-dark w-full py-[17px] text-[17px]" onClick={createRoom}>➕ CREATE ROOM</button>
        <div className="flex items-center gap-3 text-[#a99e86] text-[12px]"><span className="flex-1 h-px bg-white/10" /><span>or</span><span className="flex-1 h-px bg-white/10" /></div>
        <label className="text-[#a99e86] text-[10px] tracking-[3px] font-bold">JOIN BY CODE</label>
        <div className="flex gap-2">
          <input id="join-code" maxLength={5} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="ABCDE"
                 className="flex-1 min-w-0 bg-[#0a0f1e] border-2 border-white/10 rounded-2xl px-3 py-3 text-[#ffd97a] text-[25px] font-mono font-extrabold tracking-[10px] text-center uppercase outline-none focus:border-[#e3b75b]" />
          <button className="btn btn-dark px-6 font-extrabold" onClick={() => joinRoom(document.getElementById('join-code').value)}>JOIN</button>
        </div>
        <div className="text-[#a99e86] text-[12px] min-h-[18px] text-center">Rooms are peer-to-peer — works in real networks.</div>
      </SetupShell>
    );
  }
  if (screen === 'room') {
    const o = onlineRef.current;
    const players = o?.players || [{ name: myName(), color: 'red' }];
    const myColor = o?.myColor || 'red';
    const full = players.length >= 2;
    return (
      <SetupShell title="Your Room" onBack={() => { if (onlineRef.current?.peer) try { onlineRef.current.peer.destroy(); } catch (e) { } onlineRef.current = null; setScreen('online'); }}>
        <div className="rounded-2xl border border-dashed border-[rgba(227,183,91,.35)] bg-[#131a33] px-4 py-5 flex flex-col items-center gap-2">
          <div className="text-[9px] tracking-[5px] text-[#a99e86] font-extrabold">INVITE CODE</div>
          <div className="text-[46px] leading-none font-black tracking-[18px] text-[#ffd97a] indent-[18px]" style={{ textShadow: '0 0 28px rgba(255,217,122,.35)' }}>{o?.code || '·····'}</div>
          <div className="flex gap-2 flex-wrap justify-center">
            <button className="btn btn-dark text-[12px] px-4 py-2" onClick={() => { try { navigator.clipboard.writeText(o?.code || ''); announce('Code copied'); } catch (e) { } }}>📋 Copy</button>
            <button className="btn btn-gold text-[11px] px-4 py-2" onClick={() => {
              const code = o?.code || '';
              if (inviteFriends('ludo', code)) return;
              const link = new URL(`./?room=${encodeURIComponent(code)}`, window.location.href).href;
              try { navigator.clipboard.writeText(link); announce('Invite link copied'); } catch (e) { announce(link); }
            }}>🔗 Invite friends</button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {players.map((p, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl bg-[#131a33] border border-white/10 px-4 py-3">
              <img src={AVATARS[p.color]} alt="" className="w-9 h-9 rounded-full border border-[#8a6b2f]" />
              <span className="font-bold">{p.name}{i === 0 && o?.isHost ? ' (You)' : ''}</span>
              <span className="ml-auto text-[10px] tracking-[2px] text-[#a99e86] font-bold">{i === 0 ? 'HOST' : 'JOINED'}</span>
            </div>
          ))}
        </div>
        {o?.isHost
          ? <button className="btn btn-gold w-full py-[17px] text-[17px]" disabled={!full} onClick={hostStartOnline}>{full ? `START GAME (${players.length})` : 'WAITING FOR OPPONENT…'}</button>
          : <div className="text-[#a99e86] text-[13px] text-center">Waiting for host…</div>}
        <div className="text-[#a99e86] text-[11.5px] text-center">Friends open the same link — it auto-joins the room.</div>
      </SetupShell>
    );
  }

  /* ═══ GAME SCREEN ═══ */
  const g = G.current;
  const myPlayer = cur || {};
  const finished = myPlayer.color ? g.tokens[myPlayer.color].filter(t => t.step === 56).length : 0;

  return (
    <div className="fixed inset-0 flex flex-col sg-bg" style={{ background: 'radial-gradient(900px 550px at 50% -15%, #141d3a 0%, transparent 55%), #060c1a' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between w-full max-w-[740px] px-2.5 pt-2.5 gap-2 z-10">
        <button className="iconbtn w-12 h-12 rounded-2xl border border-[rgba(227,183,91,.22)] bg-[#131a33] text-[#e3b75b] text-[19px]" onClick={() => setScreen('menu')} aria-label="Back to menu">←</button>
        <div className="flex items-center gap-2.5 rounded-full border border-[rgba(227,183,91,.22)] bg-[#131a33] px-5 py-2.5 text-[12px] font-extrabold tracking-[2px]">
          <span className="w-3 h-3 rounded-full" style={{ background: myPlayer.color ? COLORS[myPlayer.color].hex : '#e3b75b', boxShadow: `0 0 12px ${myPlayer.color ? COLORS[myPlayer.color].hex : '#e3b75b'}` }} />
          {g.over ? 'GAME OVER' : (myPlayer.isBot ? `${myPlayer.name} to move` : 'Your turn')}
        </div>
        <button className="iconbtn w-12 h-12 rounded-2xl border border-[rgba(227,183,91,.22)] bg-[#131a33] text-[19px]" onClick={() => sfx.toggle()} aria-label="Sound">{sfx.mutedRef.current ? '🔇' : '🔊'}</button>
      </div>

      {/* Board */}
      <div className="flex-1 flex items-center justify-center min-h-0 px-2 z-[1]">
        <div className="relative rounded-2xl" style={{
          width: 'min(94vw, 55vh, 520px)', aspectRatio: '1 / 1',
          border: '3px solid transparent',
          background: 'linear-gradient(160deg,#fdf3d8 0%,#d9b95c 30%,#f7e8b0 48%,#8a6b2f 72%,#f2dc9a 100%) border-box, #1a1408',
          boxShadow: '0 24px 70px rgba(0,0,0,.75), 0 0 60px rgba(227,183,91,.14)',
        }}>
          <div className="absolute inset-[4px] grid rounded-[10px] overflow-hidden"
               style={{ gridTemplateColumns: 'repeat(15,1fr)', gridTemplateRows: 'repeat(15,1fr)', background: '#241f12' }}>
            {/* Yards */}
            {ORDER.map(color => (
              <div key={color} className="yard" style={{
                gridArea: { blue: '1 / 1 / 7 / 7', yellow: '1 / 10 / 7 / 16', red: '10 / 1 / 16 / 7', green: '10 / 10 / 16 / 16' }[color],
                background: {
                  blue: 'radial-gradient(130% 130% at 30% 25%, #2b4c8f 0%, #081a33 62%, #030d1f 100%)',
                  yellow: 'radial-gradient(130% 130% at 30% 25%, #5a4a10 0%, #342806 62%, #171000 100%)',
                  red: 'radial-gradient(130% 130% at 30% 25%, #57161a 0%, #3a0d10 62%, #1f0407 100%)',
                  green: 'radial-gradient(130% 130% at 30% 25%, #104e2c 0%, #082818 62%, #03150b 100%)',
                }[color],
              }}>
                <span className="well" style={{ left: '8.5%', top: '8.5%' }} />
                <span className="well" style={{ right: '8.5%', top: '8.5%' }} />
                <span className="well" style={{ left: '8.5%', bottom: '8.5%' }} />
                <span className="well" style={{ right: '8.5%', bottom: '8.5%' }} />
              </div>
            ))}
            {/* Cross cells */}
            {CELLS.map(cell => (
              <div key={cell.key} className={cell.cls}
                   style={{ gridRow: cell.r + 1, gridColumn: cell.c + 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {cell.star && <span dangerouslySetInnerHTML={{ __html: STAR }} style={{ display: 'flex', width: '52%', height: '52%', color: cell.colorCls ? '#ffe08a' : '#b99a2e' }} />}
              </div>
            ))}
            {/* Center pinwheel */}
            <div className="absolute" style={{ left: '40%', top: '40%', width: '20%', height: '20%', zIndex: 2 }}>
              <svg viewBox="0 0 100 100" className="absolute inset-0">
                <polygon points="0,0 0,100 50,50" fill="#2f66c4" />
                <polygon points="0,0 100,0 50,50" fill="#e0bd3a" />
                <polygon points="100,0 100,100 50,50" fill="#27ae5f" />
                <polygon points="0,100 100,100 50,50" fill="#d64533" />
                <circle cx="50" cy="50" r="17" fill="#0c0a14" stroke="#e3b75b" strokeWidth="3" />
                <text x="50" y="56" textAnchor="middle" fontFamily="'Exo 2',sans-serif" fontWeight="900" fontSize="14" fill="#e3b75b">SG</text>
              </svg>
            </div>
          </div>
          {/* Tokens */}
          <div className="absolute inset-[4px] z-[4] pointer-events-none">
            {tokenList.map(t => {
              const movable = g.highlight.includes(`${t.color}:${t.idx}`);
              return (
                <button key={`${t.color}-${t.idx}`}
                        className={`token-wrap ${movable ? 'token-movable' : ''}`}
                        style={{ left: `${t.x}%`, top: `${t.y}%`, transform: 'translate(-50%,-58%)', background: 'none', border: 'none', padding: 0, width: '6.2%', aspectRatio: '1 / 1' }}
                        onClick={() => { if (myTurn()) doMove(t.idx); }}
                        aria-label={`${t.color} pawn ${t.idx + 1}`}>
                  <img src={PIECES[t.color]} alt="" draggable="false" className="token-img block w-full h-full" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom HUD */}
      <div className="flex items-end justify-between w-full max-w-[740px] gap-3 px-3 pb-3 z-10">
        <div className="flex flex-col items-center gap-1.5">
          <div className="rounded-xl bg-[#e3b75b] text-[#241a04] text-[10px] font-black tracking-[2px] px-4 py-1.5 whitespace-nowrap" style={{ boxShadow: '0 3px 0 #8a6b2f' }}>
            {canRoll ? 'ROLL THE DICE!' : (g.over ? 'GAME OVER' : 'PICK A PAWN')}
          </div>
          <button id="dice-btn" disabled={!canRoll} onClick={() => { haptic(); rollDice(); }} aria-label="Roll dice" className="disabled:opacity-85">
            <DiceFace n={diceN} rolling={rolling} />
          </button>
        </div>
        <div className="flex flex-col gap-1.5 flex-1 max-w-[290px]">
          {g.players.map((p, i) => {
            const fin = g.tokens[p.color].filter(t => t.step === 56).length;
            const active = i === g.turnIdx && !g.over;
            return (
              <div key={i} className={`flex items-center gap-2.5 rounded-2xl border px-2 py-1.5 ${active ? 'border-[#e3b75b] bg-[#e3b75b]/10 shadow-[0_0_18px_rgba(227,183,91,.25)]' : 'border-white/10 bg-[#131a33]/80'}`}>
                <img src={avatarFor(p)} alt="" className="w-8 h-8 rounded-full border border-[#8a6b2f]" draggable="false" />
                <span className="min-w-0 flex-1">
                  <span className="block font-extrabold text-[12px] truncate" style={{ color: COLORS[p.color]?.light }}>{p.name}</span>
                  <span className="block text-[8px] tracking-[2px] text-[#a99e86]">{p.isBot ? 'AI' : 'YOU'} · {COLORS[p.color]?.name?.toUpperCase()}</span>
                </span>
                <span className="font-mono text-[12px] text-[#ffd97a] font-extrabold">🏠 {fin}/4</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Win overlay */}
      {g.over && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="relative sg-grad-panel rounded-3xl border border-[#e3b75b] px-8 py-7 text-center w-[min(390px,calc(100vw-48px))] flex flex-col items-center gap-3 shadow-[0_0_80px_rgba(227,183,91,.3)]">
            <img className="w-20 h-20 object-contain" src="assets/crown.webp" alt="Crown" />
            <div className="text-[10px] tracking-[6px] text-[#e3b75b] font-extrabold">VICTORY</div>
            <div className="game-title-word text-[32px] font-black">{COLORS[g.winner]?.name} wins!</div>
            <div className="text-[#a99e86] text-[13px]">The Shadow Games crown is yours.</div>
            <button className="btn btn-gold w-full py-4 text-[16px]" onClick={() => { if (g.mode === 'bots') { const p = { players: g.players, botCount: g.botCount, myColor: g.myColor }; startGame(g.players, 'bots'); } else setScreen('menu'); }}>PLAY AGAIN</button>
            <button className="btn btn-dark w-full py-3 text-[14px]" onClick={() => setScreen('menu')}>MAIN MENU</button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-30 rounded-xl border border-[rgba(227,183,91,.3)] bg-[#1a2243] px-5 py-3 text-[13px] text-[#f2ead9] shadow-lg">{toast}</div>}
    </div>
  );

  function startBotsGame() {
    const botCount = G.current.botCount || 3;
    const myColor = G.current.myColor || 'red';
    const others = ORDER.filter(c => c !== myColor);
    const botNames = { blue: 'Bulby', yellow: 'Bomby', green: 'Bruno', red: 'Petey' };
    const players = [
      { color: myColor, name: tgName() || 'You', isBot: false, isLocal: true },
      ...others.slice(0, botCount).map((c, i) => ({ color: c, name: botNames[c] || ('Bot ' + (i + 1)), isBot: true, isLocal: false })),
    ].sort((a, b) => ORDER.indexOf(a.color) - ORDER.indexOf(b.color));
    startGame(players, 'bots');
  }
}

function SetupShell({ title, onBack, children }) {
  const [k] = useState(0);
  return (
    <div className="sg-bg min-h-full flex flex-col items-center justify-center px-4 py-6">
      <div className="sg-grad-panel rounded-3xl px-6 py-6 w-[min(440px,calc(100vw-32px))] flex flex-col gap-4 max-h-[92vh] overflow-y-auto">
        <button className="self-start w-11 h-11 rounded-2xl border border-white/10 bg-[#1a2243] text-[#e3b75b] text-[19px]" onClick={onBack} aria-label="Back">←</button>
        <h2 className="text-[25px] font-black tracking-[2px] flex flex-col leading-tight"><span className="text-[9px] tracking-[5px] text-[#e3b75b]">SHADOW GAMES</span>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function SegBtn({ selected, onClick, children }) {
  return (
    <button onClick={onClick} className={`flex-1 py-[15px] text-[22px] font-extrabold rounded-2xl border-2 transition-all duration-150 ${selected ? 'border-[#e3b75b] text-[#ffd97a] bg-[#e3b75b]/10 shadow-[0_0_22px_rgba(227,183,91,.18)]' : 'border-white/10 text-[#a99e86] bg-[#1a2243]'}`}>{children}</button>
  );
}
