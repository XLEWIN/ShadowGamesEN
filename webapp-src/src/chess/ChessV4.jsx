// Chess rooms visuals — ported 1:1 from shadow-games-rooms-react prototype.
// All game state stays in the real ChessApp; this file is presentation only.
import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Bot, Clock3, Flag, MoreHorizontal, RotateCcw, Shield, Users, Volume2, X, CircleHelp, Sparkles } from 'lucide-react';
import './ChessV4.css';

const times = ['1+0', '3+0', '3+2', '5+3', '10+0', '10+5'];
const levels = [['casual', 'Casual', 'Relaxed warm-up'], ['tactician', 'Tactician', 'Think ahead'], ['master', 'Master', 'A sharper challenge']];
// Original Shadow Games piece art — the sculpted WebP set, not Unicode glyphs.
const pieceAssets = {
  wp: 'assets/chessSetDefault_PawnWhite_160.webp', wn: 'assets/chessSetDefault_KnightWhite_160.webp',
  wb: 'assets/chessSetDefault_BishopWhite_160.webp', wr: 'assets/chessSetDefault_RookWhite_160.webp',
  wq: 'assets/chessSetDefault_QueenWhite_160.webp', wk: 'assets/chessSetDefault_KingWhite_160.webp',
  bp: 'assets/chessSetDefault_PawnBlack_160.webp', bn: 'assets/chessSetDefault_KnightBlack_160.webp',
  bb: 'assets/chessSetDefault_BishopBlack_160.webp', br: 'assets/chessSetDefault_RookBlack_160.webp',
  bq: 'assets/chessSetDefault_QueenBlack_160.webp', bk: 'assets/chessSetDefault_KingBlack_160.webp',
};
const capturedGlyph = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' };

export function BrandMark({ compact = false }) {
  return <div className={`brand-lockup ${compact ? 'brand-compact' : ''}`}>
    <img className="brand-logo" src="/code-council-logo.png" alt="Code Council logo" />
    <div className="brand-copy"><span className="brand-kicker">A CODE COUNCIL EXPERIENCE</span><strong>SHADOW <em>GAMES</em></strong>{!compact && <small>STRATEGY · CHANCE · FRIENDSHIP</small>}</div>
  </div>;
}

const transition = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 }, transition: { duration: .22 } };

export function ChessLanding({ onAI, on1v1, onCreate, onAllGames, onBot, onModal }) {
  return <motion.main className="screen landing" {...transition}>
    <div className="brand-band"><BrandMark /></div>
    <div className="chess-art"><div className="art-orbit one" /><div className="art-orbit two" /><div className="art-board" /><span className="art-piece knight">♞</span><span className="art-piece king">♚</span><span className="art-piece bishop">♝</span><div className="art-foot"><span>01 / STRATEGY</span><span>THE CHESS ROOM</span></div></div>
    <div className="eyebrow">— STRATEGY STARTS HERE</div><h1>CHESS<span>.</span></h1><p className="tagline">Outwit. Outplay. Outlast.</p>
    <div className="actions"><button className="btn gold" onClick={onAI}><Bot /> PLAY VS AI <ArrowRight /></button><button className="btn navy" onClick={on1v1}><Users /> PLAY 1V1 <ArrowRight /></button><button className="btn navy" onClick={onCreate}><span className="plus">＋</span> CREATE GAME <ArrowRight /></button></div>
    <div className="landing-links"><button onClick={onAllGames}>← ALL GAMES</button><span>·</span><button onClick={onBot}>@ShadowGameEnBot</button></div><div className="ornament"><span /> CODE COUNCIL · SHADOW GAMES <span /></div>
    {onModal && <button aria-label="More options" className="round hidden-v4-menu" onClick={onModal}><MoreHorizontal /></button>}
  </motion.main>;
}

export function AiSetupV4({ clock, setClock, level, setLevel, side, setSide, onStart, onBack, onHelp }) {
  const fmt = (t) => t;
  return <motion.main className="screen setup" {...transition}>
    <section className="setup-panel">
      <button className="back-pill" onClick={onBack}><ArrowLeft size={15} /> BACK</button>
      <div className="eyebrow">SHADOW GAMES <span>✦</span></div><h2>Play vs AI</h2><p className="intro">Set your terms. Make your move.</p>
      <div className="form-group"><label><Clock3 /> TIME CONTROL</label><div className="time-options">{times.map(t => <button key={t} className={clock === t ? 'chosen' : ''} onClick={() => setClock(t)}>{t}</button>)}</div></div>
      <div className="form-group"><label>✦ DIFFICULTY</label><div className="level-options">{levels.map(([id, name, desc]) => <button key={id} className={level === id ? 'chosen' : ''} onClick={() => setLevel(id)}><b>{name}</b><small>{desc}</small></button>)}</div></div>
      <div className="form-group"><label>♔ YOUR COLOUR</label><div className="side-options">{[['white', '♔', 'WHITE', 'Play first'], ['random', '♕', 'RANDOM', 'Surprise me'], ['black', '♚', 'BLACK', 'Play second']].map(([id, g, name, sub]) => <button key={id} className={side === id ? 'chosen' : ''} onClick={() => setSide(id)}><span>{g}</span><b>{name}</b><small>{sub}</small></button>)}</div></div>
      <div className="summary"><small>YOUR MATCH</small><b>{fmt(clock)} · {levels.find(x => x[0] === level)?.[1]} · {side === 'random' ? 'Random side' : side + ' pieces'}</b></div>
      <button className="btn gold start" onClick={onStart}>START GAME <ArrowRight /></button>
      <p className="setup-note"><Shield /> Playing against the local engine</p>
      {onHelp && <button className="help-orb" aria-label="Help and information" onClick={onHelp}><CircleHelp size={18} /></button>}
    </section>
  </motion.main>;
}

export function ChessBoardV4({ game, onMove, flipped = false, disabled = false }) {
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('Select a piece to view legal moves');
  const ranks = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const files = flipped ? ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'] : ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const squares = ranks.flatMap(r => files.map(f => `${f}${r}`));
  const targets = selected ? game.moves({ square: selected, verbose: true }).map(m => m.to) : [];
  const hist = game.history({ verbose: true });
  const last = hist.length ? [hist[hist.length - 1].from, hist[hist.length - 1].to] : [];
  const checkSq = game.inCheck() ? (game.board().flat().find(p => p && p.type === 'k' && p.color === game.turn()) || {}).square : null;
  function click(sq) {
    if (disabled) return;
    const p = game.get(sq);
    if (selected && targets.includes(sq)) {
      const move = game.moves({ square: selected, verbose: true }).find(m => m.to === sq);
      onMove(selected, sq, move?.promotion);
      setSelected(null);
      return;
    }
    if (p && p.color === game.turn()) { setSelected(sq); setNotice('Choose a highlighted destination'); }
    else setSelected(null);
  }
  return <div className="board-wrap"><div className="board-rim"><div className="board-grid" role="grid" aria-label="Interactive chessboard">
    {squares.map(sq => {
      const p = game.get(sq);
      const light = ((sq.charCodeAt(0) - 97) + Number(sq[1])) % 2 === 0;
      const edge = flipped ? sq[0] === 'h' : sq[0] === 'a';
      const bottom = flipped ? sq[1] === '8' : sq[1] === '1';
      return <button key={sq} type="button" className={`square ${light ? 'light' : 'dark'} ${selected === sq ? 'selected' : ''} ${last.includes(sq) ? 'recent' : ''} ${checkSq === sq ? 'in-check' : ''}`} aria-label={`${sq}${p ? ` ${p.color === 'w' ? 'white' : 'black'} ${p.type}` : ''}`} onClick={() => click(sq)}>
        {edge && <span className="coord rank">{sq[1]}</span>}{bottom && <span className="coord file">{sq[0]}</span>}
        {targets.includes(sq) && <span className={`dot ${p ? 'capture' : ''}`} />}
        {p && <span className={`piece ${p.color === 'w' ? 'white-piece' : 'black-piece'}`}><img src={pieceAssets[p.color + p.type]} alt="" draggable="false" /></span>}
      </button>;
    })}
  </div></div><div className="board-caption"><span><i /> LEGAL-MOVE BOARD</span><span>{notice}</span></div></div>;
}

export function ChessRoomV4({ game, players, clocks, turn, over, status, history, moves, captured, flipped, selfName, onBack, onResign, onSound, onReset, onMove, onInvite, onMenu, onConfirm, onRematch, onMainMenu, result, winner, modal, setModal, toast, level }) {
  const done = over || game.isGameOver();
  const turnText = turn === 'b' ? 'BLACK' : 'WHITE';
  const myColor = flipped ? 'b' : 'w';
  // An empty name means the second player has not joined yet.
  const opp = players.find(p => p.color !== myColor) || { name: '' };
  return <div className="app-shell">
    <header className="topbar"><button aria-label="Back" onClick={() => onBack?.()}><ArrowLeft /></button><div className="telegram-title">Shadow Games <span>EN 🇮🇳</span></div><button aria-label="More options" onClick={onMenu}><MoreHorizontal /></button><button aria-label="Close" onClick={() => onConfirm?.('leave')}><X /></button></header>
    <motion.main className="screen board-screen" {...transition}>
      <div className="board-toolbar"><button className="round" onClick={onBack} aria-label="Return to lobby"><ArrowLeft /></button><div className="turn-chip"><i className={turn === 'b' ? 'black' : ''} />{done ? 'GAME FINISHED' : `${turnText} TO MOVE`}</div><button className="round danger" aria-label="Resign" onClick={() => onResign?.()}><Flag /></button><button className="round" aria-label="Sound effects" onClick={onSound}><Volume2 /></button></div>
      <div className="clocks"><span>● <b>{clocks.w}</b></span><span>○ <b>{clocks.b}</b></span></div>
      <div className="player"><div className="avatar black-avatar">♟</div><div className="player-copy"><b>{opp.name}</b><small>{flipped ? 'WHITE' : 'BLACK'} · {level?.toUpperCase() || 'TACTICIAN'}</small></div><strong className="player-clock">{clocks[flipped ? 'w' : 'b']}</strong></div>
      <ChessBoardV4 game={game} onMove={onMove} flipped={flipped} disabled={done} />
      <div className="player"><div className="avatar white-avatar">♟</div><div className="player-copy"><b>{selfName || ''}</b><small>{myColor.toUpperCase()} · {players.length > 1 ? 'ONLINE' : 'LOCAL PREVIEW'}</small></div><strong className="player-clock">{clocks[myColor]}</strong></div>
      <div className="board-bottom"><div className="bottom-box"><small>CAPTURED</small><div>{(captured || []).map((m, i) => <span key={i}>{capturedGlyph[m] || m}</span>)}</div></div><div className="bottom-box move-box"><small>MOVES</small><div>{moves?.length ? moves.map((m, i) => <span key={i}>{i % 2 === 0 && <b>{Math.floor(i / 2) + 1}. </b>}{m.san || m} </span>) : '—'}</div></div><button className="reset" onClick={onReset}><RotateCcw /> RESET</button></div>
      <div className="status-line"><i /> {status}</div>
    </motion.main>
    <footer className="telegram-footer"><span>✦ CODE COUNCIL · SHADOW GAMES ✦</span><small>@ShadowGameEnBot</small></footer>
    <AnimatePresence>{modal && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={e => e.target === e.currentTarget && setModal('')}><motion.div className="modal" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }}><button className="modal-x" onClick={() => setModal('')}><X /></button><div className="eyebrow">SHADOW GAMES</div><h3>{modal === 'resign' ? 'Resign this game?' : modal === 'leave' ? 'Leave this match?' : modal === 'invite' ? 'Invite a friend' : 'Room options'}</h3><p>{modal === 'resign' ? 'Your opponent wins immediately.' : modal === 'leave' ? 'Leaving ends the match — your opponent wins.' : modal === 'invite' ? 'Share the room code with a friend to play together.' : 'Back returns you to the Chess lobby.'}</p><button className="btn gold" onClick={() => { const m = modal; setModal(''); onConfirm?.(m); }}>{modal === 'resign' || modal === 'leave' ? 'YES, END MATCH' : 'GOT IT'}</button><button className="btn navy" onClick={() => setModal('')}>CANCEL</button></motion.div></motion.div>}</AnimatePresence>
    <AnimatePresence>{done && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div className="modal" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}><div className="eyebrow">GAME FINISHED</div><h3>{result === 'resign' || result === 'abandoned' ? (winner === myColor ? 'You win' : 'You lose') : winner ? (winner === myColor ? 'Victory' : 'Defeat') : 'Draw'}</h3><p>{result === 'resign' ? 'The game ended by resignation.' : result === 'abandoned' ? 'The opponent left the match.' : status}</p><button className="btn gold" onClick={() => onRematch?.()}>PLAY AGAIN</button><button className="btn navy" onClick={() => onMainMenu?.()}>MAIN MENU</button></motion.div></motion.div>}</AnimatePresence>
    <AnimatePresence>{toast && <motion.div className="toast" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}><Sparkles size={14} />{toast}</motion.div>}</AnimatePresence>
  </div>;
}
