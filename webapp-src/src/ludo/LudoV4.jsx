// Ludo rooms visuals — ported 1:1 from shadow-games-ludo-only (v2 reference).
// Game state stays authoritative in LudoApp; this file is presentation only.
import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Bot, MoreHorizontal, Volume2, X, Users, Dices, Shield, Plus, CircleHelp, Sparkles } from 'lucide-react';
import { ORDER, MAIN_PATH, START_INDEX, HOME_PATH, FINISH_STEP, HOME_ENTRY_STEP } from './engine.js';
import './LudoV5.css';

const colors = [['red', 'Coral red', '#ef4444'], ['yellow', 'Solar gold', '#f6c945'], ['green', 'Emerald', '#20b875'], ['blue', 'Royal blue', '#3888ed']];
const transition = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 }, transition: { duration: .2 } };

function BrandMark({ compact = false }) {
  return <div className={`brand-lockup ${compact ? 'brand-compact' : ''}`}>
    <img className="brand-logo" src="/code-council-logo.png" alt="Code Council logo" />
    <div className="brand-copy"><span className="brand-kicker">A CODE COUNCIL EXPERIENCE</span><strong>SHADOW <em>GAMES</em></strong>{!compact && <small>STRATEGY · CHANCE · FRIENDSHIP</small>}</div>
  </div>;
}

export function LudoLanding({ onBots, onCreate, onPerson, onAllGames, onBot, onModal }) {
  return <motion.main className="screen landing" {...transition}>
    <div className="brand-band"><BrandMark /></div>
    <div className="hero-emblem"><div className="ludo-app-icon"><div className="mini-quads"><i /><i /><i /><i /></div><span>⚄</span></div></div>
    <div className="eyebrow">CODE COUNCIL PRESENTS</div><h1>LUDO<span>.</span></h1><p className="tagline">Race your pawns home — the Shadow Games way.</p>
    <div className="actions"><button className="btn gold" onClick={onBots}><Bot /> PLAY VS BOTS <ArrowRight /></button><button className="btn navy" onClick={onCreate}><Plus /> CREATE ROOM <ArrowRight /></button><button className="btn navy" onClick={onPerson}><Users /> PLAY IN PERSON <ArrowRight /></button></div>
    <div className="landing-links"><button onClick={onAllGames}>← ALL GAMES</button><span>·</span><button onClick={onBot}>@ShadowGameEnBot</button></div>
    <div className="feature-strip"><span>✦ TACTILE BOARD ART</span><span>✦ INSTANT FEEDBACK</span></div>
    {onModal && <button aria-label="More options" className="round hidden-v4-menu" onClick={onModal}><MoreHorizontal /></button>}
  </motion.main>;
}

export function LudoSetupV4({ botCount, setBotCount, myColor, setMyColor, onStart, onBack, onHelp }) {
  return <motion.main className="screen setup ludo-setup" {...transition}>
    <section className="setup-panel">
      <button className="back-pill" onClick={onBack}><ArrowLeft size={15} /></button>
      <div className="eyebrow">SHADOW GAMES <span>✦</span></div><h2>Play vs Bots</h2><p className="intro">Four colours. One finish line.</p>
      <div className="form-group"><label>BOT COUNT</label><div className="bot-options">{[1, 2, 3].map(n => <button key={n} className={botCount === n ? 'chosen' : ''} onClick={() => setBotCount(n)}>{n}</button>)}</div></div>
      <div className="form-group"><label>YOUR COLOUR</label><div className="ludo-color-options">{colors.map(([id, name, c]) => <button key={id} className={myColor === id ? 'chosen' : ''} aria-label={name} title={name} style={{ '--token-color': c }} onClick={() => setMyColor(id)}><span /></button>)}</div><div className="color-caption"><i style={{ background: colors.find(c => c[0] === myColor)?.[2] }} /> {colors.find(c => c[0] === myColor)?.[1].toUpperCase()} SELECTED</div></div>
      <div className="summary"><small>YOUR TABLE</small><b>{botCount} {botCount === 1 ? 'BOT' : 'BOTS'} · {myColor.toUpperCase()} PAWNS · CLASSIC RULES</b></div>
      <button className="btn gold start" onClick={onStart}>START GAME <ArrowRight /></button>
      <p className="setup-note"><Shield /> Playing with the local game engine</p>
      {onHelp && <button className="help-orb" aria-label="Help and information" onClick={onHelp}><CircleHelp size={18} /></button>}
    </section>
  </motion.main>;
}

/* ── Board geometry from the v2 reference, driven by the real game engine ── */
const palette = { red: '#ef4444', yellow: '#f6c945', green: '#20b875', blue: '#3888ed' };
const homes = {
  blue: [[1, 1], [1, 4], [4, 1], [4, 4]],
  yellow: [[1, 10], [1, 13], [4, 10], [4, 13]],
  red: [[10, 1], [10, 4], [13, 1], [13, 4]],
  green: [[10, 10], [10, 13], [13, 10], [13, 13]],
};
const offsets = { blue: 0, yellow: 13, green: 26, red: 39 };
const homeLanes = HOME_PATH;
const safeSquares = new Set(['6,1', '1,8', '8,13', '13,6', '2,6', '6,12', '8,2', '12,8']);

function cellType(r, c) {
  if ((r < 6 && c < 6) || (r < 6 && c > 8) || (r > 8 && c < 6) || (r > 8 && c > 8)) return 'home';
  if (r === 7 && c >= 1 && c <= 5) return 'lane-blue';
  if (c === 7 && r >= 1 && r <= 5) return 'lane-yellow';
  if (r === 7 && c >= 9 && c <= 13) return 'lane-green';
  if (c === 7 && r >= 9 && r <= 13) return 'lane-red';
  if (((r === 6 || r === 8) && c >= 1 && c <= 5) || ((r === 6 || r === 8) && c >= 9 && c <= 13) || ((c === 6 || c === 8) && r >= 1 && r <= 5) || ((c === 6 || c === 8) && r >= 9 && r <= 13)) return 'path';
  if ((r === 7 && (c === 6 || c === 8)) || (c === 7 && (r === 6 || r === 8))) return 'center-arm';
  return 'blank';
}
function isYardInterior(r, c) {
  return (r >= 1 && r <= 4 && c >= 1 && c <= 4) || (r >= 1 && r <= 4 && c >= 10 && c <= 13) ||
    (r >= 10 && r <= 13 && c >= 1 && c <= 4) || (r >= 10 && r <= 13 && c >= 10 && c <= 13);
}
function yardForCell(r, c) {
  if (r < 6 && c < 6) return 'blue';
  if (r < 6 && c > 8) return 'yellow';
  if (r > 8 && c < 6) return 'red';
  if (r > 8 && c > 8) return 'green';
  return null;
}
function PawnGlyph({ color }) {
  const light = color === 'yellow' ? '#fff1a5' : '#ffffff';
  const mid = palette[color];
  const dark = color === 'yellow' ? '#8b5a09' : '#172033';
  return <svg className="pawn-glyph" viewBox="0 0 48 58" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`pawn-${color}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={light} stopOpacity=".96" /><stop offset=".22" stopColor={mid} />
        <stop offset=".72" stopColor={mid} /><stop offset="1" stopColor={dark} />
      </linearGradient>
      <linearGradient id={`pawn-base-${color}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={light} stopOpacity=".75" /><stop offset=".28" stopColor={mid} /><stop offset="1" stopColor={dark} />
      </linearGradient>
    </defs>
    <ellipse cx="24" cy="52" rx="18" ry="4.5" fill="#050811" opacity=".42" />
    <path d="M9 42 C10 36 15 34 19 32 L20 27 C15 24 13 20 13 15 C13 8.5 17.8 4 24 4 C30.2 4 35 8.5 35 15 C35 20 33 24 28 27 L29 32 C33 34 38 36 39 42 L42 47 C43 50 40 52 36 52 H12 C8 52 5 50 6 47 Z" fill={`url(#pawn-${color})`} stroke={dark} strokeWidth="2.4" strokeLinejoin="round" />
    <path d="M11 42 C14 38 19 38 24 38 C29 38 34 38 37 42 L39 47 C35 49 13 49 9 47 Z" fill={`url(#pawn-base-${color})`} stroke={dark} strokeWidth="1.3" />
    <path d="M18 11 C20 8 23 7 26 8" fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="2.2" strokeLinecap="round" />
    <ellipse cx="17" cy="18" rx="2.3" ry="5.5" fill="#fff" opacity=".22" transform="rotate(18 17 18)" />
  </svg>;
}
function PawnToken({ color, index, selected, finished, legal, onClick }) {
  return <button type="button" className={`ludo-token ${color} ${selected ? 'own-token' : ''} ${finished ? 'finished-token' : ''} ${legal ? 'legal-token' : ''}`}
    aria-label={`${color} pawn ${index + 1}`} title={`${color} pawn ${index + 1}`} onClick={onClick} style={{ '--token-color': palette[color] }}>
    <PawnGlyph color={color} />
  </button>;
}

export function LudoBoardV4({ tokens, selectedColor, legal = [], onPawn }) {
  const cells = Array.from({ length: 225 }, (_, i) => ({ r: Math.floor(i / 15), c: i % 15 }));
  const tokensByCell = {};
  for (const color of ORDER) {
    homes[color].forEach(([r, c], idx) => {
      const step = tokens?.[color]?.[idx]?.step ?? -1;
      let key, finished = false;
      if (step < 0) key = `${r},${c}`;
      else if (step < HOME_ENTRY_STEP) { const [pr, pc] = MAIN_PATH[(step + offsets[color]) % 52]; key = `${pr},${pc}`; }
      else if (step < FINISH_STEP) { const [pr, pc] = homeLanes[color][step - HOME_ENTRY_STEP]; key = `${pr},${pc}`; }
      else { key = '7,7'; finished = true; }
      (tokensByCell[key] ??= []).push({ color, idx, finished, home: step < 0 });
    });
  }
  const yards = [
    { color: 'blue', row: '2 / 6', col: '2 / 6' },
    { color: 'yellow', row: '2 / 6', col: '11 / 15' },
    { color: 'red', row: '11 / 15', col: '2 / 6' },
    { color: 'green', row: '11 / 15', col: '11 / 15' },
  ];
  return <div className="ludo-rim"><div className="ludo-grid" role="grid" aria-label="Ludo board">
    {yards.map(yard => <div key={yard.color} className={`yard-inlay yard-${yard.color}`} style={{ gridRow: yard.row, gridColumn: yard.col }} />)}
    {cells.map(({ r, c }) => {
      const baseColor = yardForCell(r, c);
      const type = cellType(r, c);
      const isLane = type.startsWith('lane-');
      const laneColor = type.replace('lane-', '');
      const key = `${r},${c}`;
      const here = tokensByCell[key] || [];
      const isPocket = homes[baseColor]?.some(([hr, hc]) => hr === r && hc === c);
      const isCenter = r === 7 && c === 7;
      const isSafe = safeSquares.has(key) && !isLane;
      return <div key={key}
        className={`ludo-cell ${type} ${baseColor ? `base-${baseColor}` : ''} ${isYardInterior(r, c) ? 'yard-interior' : ''} ${isLane ? `lane-${laneColor}` : ''} ${isPocket ? 'pawn-pocket' : ''} ${isCenter ? 'center-cell' : ''} ${isSafe ? 'safe-square' : ''}`}
        style={{ gridRow: r + 1, gridColumn: c + 1, ...(isLane ? { '--lane-color': palette[laneColor] } : {}) }}
        role="gridcell" aria-label={`Row ${r + 1}, column ${c + 1}`}>
        {isPocket && <span className={`pocket-ring pocket-${baseColor}`} />}
        {isSafe && <span className="safe-star" aria-hidden="true">✦</span>}
        {isCenter && <div className="ludo-center" aria-label="Home finish"><span className="tri tri-blue" /><span className="tri tri-yellow" /><span className="tri tri-green" /><span className="tri tri-red" /><b>CC</b></div>}
        {here.map(t => <PawnToken key={`${t.color}-${t.idx}`} color={t.color} index={t.idx}
          selected={selectedColor === t.color} finished={t.finished}
          legal={t.color === selectedColor && legal.includes(t.idx)} onClick={() => onPawn(t.color, t.idx)} />)}
      </div>;
    })}
  </div><div className="board-glint" /></div>;
}

export function LudoRoomV4({ tokens, players, currentColor, myColor: chosenColor, dice, diceN, hasRolled, legal, onPawn, onRoll, onBack, onSound, onLeave, onModal, onRematch, onMainMenu, toast, over, winner }) {
  const current = currentColor || 'red';
  const myColor = chosenColor || current;
  return <div className="app-shell">
    <header className="topbar"><button aria-label="Back" onClick={onBack}><ArrowLeft /></button><div className="telegram-title">Shadow Games <span>EN 🇮🇳</span></div><button aria-label="More options" onClick={onModal}><MoreHorizontal /></button><button aria-label="Close" onClick={onLeave}><X /></button></header>
    <motion.main className="screen ludo-game-screen" {...transition}>
      <div className="ludo-toolbar"><button className="round" onClick={onBack}><ArrowLeft /></button><div className="turn-chip"><i style={{ background: colors.find(c => c[0] === current)?.[2] }} />{over ? 'GAME OVER' : `${current.toUpperCase()} TO MOVE`}</div><button className="round" onClick={onSound} aria-label="Sound effects"><Volume2 /></button></div>
      <div className="ludo-board-holder"><LudoBoardV4 tokens={tokens} selectedColor={chosenColor || current} legal={legal} onPawn={onPawn} /></div>
      <div className="ludo-control-row"><button className="btn gold compact" onClick={onRoll}><Dices /> ROLL DICE <span className="dice-face">{diceN}</span></button><button className="btn navy compact" onClick={onModal}><span className="plus">✦</span> PICK A PAWN</button></div>
      <div className="ludo-players">{players.map(p => <div className={`ludo-player ${p.color} ${p.color === myColor ? 'is-you' : ''}`} key={p.color}><span className="player-orb" style={{ '--token-color': colors.find(x => x[0] === p.color)?.[2] }} /><div><b>{p.isLocal || p.color === myColor ? 'You' : p.name || p.color}</b><small>{p.isBot ? `BOT · ${p.color.toUpperCase()}` : p.isLocal || p.color === myColor ? 'YOU' : p.color.toUpperCase()}</small></div><strong>HOME {(tokens?.[p.color] || []).filter(t => t.step === FINISH_STEP).length}/4</strong></div>)}</div>
      <div className="status-line"><i /> {over ? (winner ? `${winner.toUpperCase()} WINS` : 'GAME OVER') : hasRolled || dice !== null ? `Dice shows ${diceN} · tap a pawn to move` : 'Roll the dice to take your turn'}</div>
    </motion.main>
    <footer className="telegram-footer"><small>@ShadowGameEnBot</small></footer>
    <AnimatePresence>{over && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div className="modal" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}><div className="eyebrow">GAME FINISHED</div><h3>{winner ? (winner === myColor ? 'You win' : `${winner.toUpperCase()} wins`) : 'Game over'}</h3><p>The match ended. Play again or return to the lobby.</p><button className="btn gold" onClick={() => onRematch?.()}>PLAY AGAIN</button><button className="btn navy" onClick={() => onMainMenu?.()}>MAIN MENU</button></motion.div></motion.div>}</AnimatePresence>
    <AnimatePresence>{toast && <motion.div className="toast" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }}><Sparkles size={14} />{toast}</motion.div>}</AnimatePresence>
  </div>;
}
