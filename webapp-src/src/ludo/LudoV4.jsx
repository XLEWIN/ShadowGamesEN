// Ludo rooms visuals — ported 1:1 from shadow-games-ludo-only prototype.
// Game state remains authoritative in LudoApp; this file is presentation only.
import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Bot, MoreHorizontal, Volume2, X, Users, Dices, Shield, Plus, Flag, CircleHelp, Sparkles } from 'lucide-react';
import { ORDER, COLORS, MAIN_PATH, START_INDEX, HOME_PATH, FINISH_STEP, HOME_ENTRY_STEP } from './engine.js';
import './LudoV4.css';

function BrandMark({ compact = false }) {
  return <div className={`brand-lockup ${compact ? 'brand-compact' : ''}`}>
    <img className="brand-logo" src="/code-council-logo.png" alt="Code Council logo" />
    <div className="brand-copy"><span className="brand-kicker">A CODE COUNCIL EXPERIENCE</span><strong>SHADOW <em>GAMES</em></strong>{!compact && <small>STRATEGY · CHANCE · FRIENDSHIP</small>}</div>
  </div>;
}

const colors = [['red', 'Coral red', '#f05252'], ['yellow', 'Solar gold', '#f4cf42'], ['green', 'Emerald', '#21bf72'], ['blue', 'Royal blue', '#367fe5']];
const transition = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 }, transition: { duration: .2 } };

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

function cellType(r, c) {
  if (r < 6 && c < 6) return 'home';
  if (r < 6 && c > 8) return 'home';
  if (r > 8 && c < 6) return 'home';
  if (r > 8 && c > 8) return 'home';
  if (r === 7 && c >= 1 && c <= 5) return 'lane-blue';
  if (c === 7 && r >= 1 && r <= 5) return 'lane-yellow';
  if (r === 7 && c >= 9 && c <= 13) return 'lane-green';
  if (c === 7 && r >= 9 && r <= 13) return 'lane-red';
  if ((r === 6 || r === 8) && c >= 1 && c <= 5 || (r === 6 || r === 8) && c >= 9 && c <= 13 || (c === 6 || c === 8) && r >= 1 && r <= 5 || (c === 6 || c === 8) && r >= 9 && r <= 13) return 'path';
  if ((r === 7 && c === 6) || (r === 7 && c === 8) || (r === 6 && c === 7) || (r === 8 && c === 7)) return 'center-arm';
  return 'blank';
}

export function LudoBoardV4({ tokens, selectedColor, onPawn, legal }) {
  const palette = { red: '#f05252', yellow: '#f2ca45', green: '#20bd72', blue: '#397fe7' };
  const homes = { red: [[10, 1], [13, 1], [10, 4], [13, 4]], yellow: [[1, 10], [4, 10], [1, 13], [4, 13]], green: [[10, 10], [13, 10], [10, 13], [13, 13]], blue: [[1, 1], [4, 1], [1, 4], [4, 4]] };
  const byCell = {};
  const place = (r, c, color, idx, extra = {}) => { const key = `${r},${c}`; (byCell[key] ??= []).push({ color, idx, ...extra }); };
  for (const color of ORDER) {
    (tokens?.[color] || []).forEach((t, idx) => {
      if (t.step < 0) { const [r, c] = homes[color][idx]; place(r, c, color, idx, { home: true }); }
      else if (t.step >= FINISH_STEP) place(7, 7, color, idx, { finished: true });
      else if (t.step >= HOME_ENTRY_STEP) { const [r, c] = HOME_PATH[color][t.step - HOME_ENTRY_STEP]; place(r, c, color, idx, { lane: true }); }
      else { const [r, c] = MAIN_PATH[(START_INDEX[color] + t.step) % 52]; place(r, c, color, idx); }
    });
  }
  const cells = Array.from({ length: 225 }, (_, i) => ({ r: Math.floor(i / 15), c: i % 15 }));
  return <div className="ludo-rim"><div className="ludo-grid" role="grid" aria-label="Ludo board">
    {cells.map(({ r, c }) => {
      const baseColor = (r < 6 && c < 6) ? 'blue' : (r < 6 && c > 8) ? 'yellow' : (r > 8 && c < 6) ? 'red' : (r > 8 && c > 8) ? 'green' : null;
      const laneColor = (r === 7 && c >= 1 && c <= 5) ? 'blue' : (c === 7 && r >= 1 && r <= 5) ? 'yellow' : (r === 7 && c >= 9 && c <= 13) ? 'green' : (c === 7 && r >= 9 && r <= 13) ? 'red' : null;
      const tokensHere = byCell[`${r},${c}`] || [];
      const movable = legal?.some(i => tokensHere.some(t => t.color === selectedColor && t.idx === i));
      return <div key={`${r}-${c}`} className={`ludo-cell ${cellType(r, c)} ${baseColor ? `base-${baseColor}` : ''} ${laneColor ? `lane-${laneColor}` : ''} ${r === 7 && c === 7 ? 'center-cell' : ''} ${movable ? 'legal-cell' : ''}`} style={laneColor ? { '--lane-color': palette[laneColor] } : undefined}>
        {r === 7 && c === 7 && <div className="ludo-center"><span className="tri tri-blue" /><span className="tri tri-yellow" /><span className="tri tri-green" /><span className="tri tri-red" /><b>CC</b></div>}
        {tokensHere.map(t => <button key={t.color + t.idx} className={`ludo-token ${t.color} ${selectedColor === t.color ? 'own-token' : ''} ${t.finished ? 'finished-token' : ''}`} aria-label={`${t.color} pawn ${t.idx + 1}`} onClick={() => onPawn(t.color, t.idx)} style={{ '--token-color': palette[t.color] }}><span /></button>)}
      </div>;
    })}
  </div><div className="board-glint" /></div>;
}

export function LudoRoomV4({ tokens, players, currentColor, myColor: chosenColor, dice, diceN, hasRolled, legal, onPawn, onRoll, onBack, onSound, onLeave, onModal, toast, over, winner }) {
  const current = currentColor || 'red';
  const myColor = chosenColor || current;
  return <div className="app-shell">
    <header className="topbar"><button aria-label="Back" onClick={onBack}><ArrowLeft /></button><div className="telegram-title">Shadow Games <span>EN 🇮🇳</span></div><button aria-label="More options" onClick={onModal}><MoreHorizontal /></button><button aria-label="Close" onClick={onLeave}><X /></button></header>
    <motion.main className="screen ludo-game-screen" {...transition}>
      <div className="ludo-toolbar"><button className="round" onClick={onBack}><ArrowLeft /></button><div className="turn-chip"><i style={{ background: colors.find(c => c[0] === current)?.[2] }} />{over ? 'GAME OVER' : `${current.toUpperCase()} TO MOVE`}</div><button className="round" onClick={onSound} aria-label="Sound effects"><Volume2 /></button></div>
      <div className="ludo-board-holder"><LudoBoardV4 tokens={tokens} selectedColor={chosenColor || current} legal={legal} onPawn={onPawn} /></div>
      <div className="ludo-control-row"><button className="btn gold compact" onClick={onRoll}><Dices /> ROLL DICE <span className="dice-face">{diceN}</span></button><button className="btn navy compact" onClick={onModal}><span className="plus">✦</span> PICK A PAWN</button></div>
      <div className="ludo-players">{players.map(p => <div className={`ludo-player ${p.color} ${p.color === myColor ? 'is-you' : ''}`} key={p.color}><span className="player-orb" style={{ '--token-color': colors.find(x => x[0] === p.color)?.[2] }} /><div><b>{p.isLocal || p.color === myColor ? 'You' : p.name || p.color}</b><small>{p.isBot ? `BOT · ${p.color.toUpperCase()}` : p.isLocal || p.color === myColor ? 'YOU' : `${p.color.toUpperCase()}`}</small></div><strong>HOME {(tokens?.[p.color] || []).filter(t => t.step === FINISH_STEP).length}/4</strong></div>)}</div>
      <div className="status-line"><i /> {over ? (winner ? `${winner.toUpperCase()} WINS` : 'GAME OVER') : hasRolled || dice !== null ? `Dice shows ${diceN} · tap a pawn to move` : 'Roll the dice to take your turn'}</div>
    </motion.main>
    <footer className="telegram-footer"><small>@ShadowGameEnBot</small></footer>
    <AnimatePresence>{toast && <motion.div className="toast" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 5 }}>✦ {toast}</motion.div>}</AnimatePresence>
  </div>;
}
