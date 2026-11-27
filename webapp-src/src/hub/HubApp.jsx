import React, { useEffect, useMemo, useRef, useState } from 'react';
import hqLogo from '../assets/spiky-code-council-emblem.png';
import chessPreview from '../assets/chess-board-preview.png';
import ludoPreview from '../assets/ludo-board-preview.png';
import { createSfx } from '../shared/audio.js';
import { callServer } from '../shared/lobby.js';
import { normalizeRoomCode, roomPageUrl } from '../shared/room.js';
import './HubHome.css';

const BOT_LINK = 'https://t.me/ShadowGameEnBot';

// One source of truth for the four cards in the game selection area.
const GAMES = {
  chess: {
    id: 'chess', num: '01 / STRATEGY', title: 'CHESS', category: 'board',
    desc: 'Think a few moves ahead. Original Shadow Games board skin, sculpted pieces, clocks and premoves.',
    detail: 'REAL PIECE ART · CLOCKS · PREMOVES', cta: 'Enter board', href: './chess/',
  },
  ludo: {
    id: 'ludo', num: '02 / RACE', title: 'LUDO', category: 'board',
    desc: 'Bring the tokens home. Classic 15×15 race geometry, safe stars, home lanes and a tactile dice table.',
    detail: 'TOKEN ART · DICE ANIMATION', cta: 'Roll in', href: './ludo/',
  },
  wordseek: {
    id: 'wordseek', num: '03 / WORDS', title: 'WORDSEEK', category: 'word',
    desc: 'Hunt the hidden word with colour hints. Six tries, one clue, and a fresh puzzle every day.',
    detail: 'DAILY PUZZLE · /new4 · /new5 · /new6', cta: 'Open in bot', href: `${BOT_LINK}?start=new`,
  },
  wordguess: {
    id: 'wordguess', num: '04 / WORDS', title: 'WORDGUESS', category: 'word',
    desc: 'One player describes the secret word, the group guesses it. Fast, loud, and made for friends.',
    detail: 'GROUP GAME · /game', cta: 'Open in bot', href: `${BOT_LINK}?start=game`,
  },
};

function WordTiles({ word = 'WORD', revealed = false }) {
  return (
    <div className="sg-word-tiles" aria-hidden="true">
      {word.split('').map((ch, i) => (
        <span key={`${ch}-${i}`} className={`sg-tile${revealed ? ' is-open' : ''}`} style={{ animationDelay: `${i * 60}ms` }}>
          {revealed ? ch : '·'}
        </span>
      ))}
    </div>
  );
}

function GameCard({ game, preview, onOpen }) {
  return (
    <article className="sg-game-card">
      <div className="sg-card-top">
        <div>
          <div className="sg-card-number">{game.num}</div>
          <h3>{game.title}</h3>
          <p>{game.desc}</p>
        </div>
        <span className="sg-pill">{game.category === 'board' ? 'Board preview' : 'Word game'}</span>
      </div>
      <div className="sg-board-preview">{preview}</div>
      <div className="sg-card-bottom">
        <span className="sg-detail">{game.detail}</span>
        <button type="button" className="sg-btn gold small" onClick={() => onOpen(game.id)}>
          Preview &amp; play <span aria-hidden="true">↗</span>
        </button>
      </div>
    </article>
  );
}

function ChessMini() {
  const [sq, setSq] = useState('e4');
  const files = 'abcdefgh';
  const ranks = [8, 7, 6, 5, 4, 3, 2, 1];
  return (
    <div className="sg-mini-board" role="group" aria-label="Chessboard preview"
      style={{ backgroundImage: "url('./chess/assets/chessBoardDefault_1280.webp')" }}>
      {ranks.map((r, ri) => files.split('').map((f, ci) => {
        const name = f + r;
        return (
          <button key={name} type="button" aria-label={`Highlight square ${name}`}
            className={`sg-mini-sq${sq === name ? ' is-lit' : ''}`}
            style={{ gridRow: ri + 1, gridColumn: ci + 1 }}
            onClick={() => setSq(name)} />
        );
      }))}
    </div>
  );
}

function Dice({ face }) {
  const pips = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[face] || [4];
  return (
    <div className="sg-dice" aria-label={`Dice showing ${face}`}>
      {Array.from({ length: 9 }, (_, i) => <i key={i} className={pips.includes(i) ? 'pip on' : 'pip'} />)}
    </div>
  );
}

function LudoMini() {
  const [face, setFace] = useState(1);
  return (
    <div className="sg-ludo-mini">
      <img src={ludoPreview} alt="Ludo board with four player yards" />
      <div className="sg-ludo-dice">
        <Dice face={face} />
        <button type="button" className="sg-btn gold small" onClick={() => setFace(1 + Math.floor(Math.random() * 6))}>Roll dice</button>
      </div>
    </div>
  );
}

function Mini({ tone, name, desc, command }) {
  return (
    <a className="sg-mini" href={`${BOT_LINK}?start=${command}`}>
      <span className={`sg-mini-icon tone-${tone}`} aria-hidden="true" />
      <div>
        <b>{name}</b>
        <p>{desc}</p>
      </div>
      <span className="sg-mini-cta">OPEN IN BOT <span aria-hidden="true">↗</span></span>
    </a>
  );
}

export default function HubApp() {
  const [splashDone, setSplashDone] = useState(false);
  const [filter, setFilter] = useState('board');
  const [activeGame, setActiveGame] = useState(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const modalRef = useRef(null);
  const sfx = useRef(null);
  if (!sfx.current) sfx.current = createSfx();
  const profile = useMemo(() => {
    const u = window.Telegram?.WebApp?.initDataUnsafe?.user;
    return u ? (u.username ? `@${u.username}` : (u.first_name || 'PLAYER')) : 'PLAYER / GUEST';
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), 900);
    return () => clearTimeout(t);
  }, []);

  // Sound stays on by default but is only created/unlocked after a real tap.
  useEffect(() => {
    const unlock = () => { sfx.current?.move(); };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // Deep link from inline Join/Spectate buttons: open the right table directly.
  useEffect(() => {
    (async () => {
      try {
        const tg = window.Telegram?.WebApp;
        tg?.ready?.();
        const initData = new URLSearchParams(tg?.initData || '');
        const qs = new URLSearchParams(window.location.search);
        const payload = (tg?.startParam || initData.get('start_param') || qs.get('startapp') || qs.get('start_param') || '').trim();
        if (!payload) return;
        const parts = payload.split('-');
        const watching = parts[0] === 'watch';
        const game = watching ? parts[1] : parts[0];
        const code = normalizeRoomCode(watching ? parts[2] : parts[1]);
        if (!['ludo', 'chess'].includes(game) || !/^[A-Z0-9]{5}$/.test(code)) return;
        const go = (spectate) => {
          const target = game === 'chess' && !spectate
            ? `./chess/?join=${encodeURIComponent(code)}`
            : roomPageUrl(game, code, spectate);
          window.location.href = target;
        };
        if (watching) { callServer('lobbySpectate', { code }); go(true); return; }
        const joined = await Promise.race([
          callServer('lobbyJoin', { code, game }),
          new Promise((resolve) => setTimeout(() => resolve(null), 500)),
        ]);
        if (joined?.expired) { setToast(joined.error || 'Session expired — ask for a new invite.'); return; }
        if (joined && joined.ok === false && !joined.already && !joined.full) { setToast(joined.error || 'Invite is no longer valid.'); return; }
        go(!!(joined && joined.full && !joined.already));
      } catch (e) { /* stay on hub */ }
    })();
  }, []);

  // Modal accessibility: focus, Esc, Tab trap, no background scroll.
  useEffect(() => {
    if (!activeGame) return;
    const previous = document.activeElement;
    const focusables = () => [...(modalRef.current?.querySelectorAll('button, a[href]') || [])];
    focusables()[0]?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { setActiveGame(null); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [activeGame]);

  function notify(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  }
  const scrollTo = (id) => {
    sfx.current?.move();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const changeFilter = (next) => { sfx.current?.move(); setFilter(next); };

  const game = activeGame ? GAMES[activeGame] : null;
  const shown = filter === 'board' ? ['chess', 'ludo'] : ['wordseek', 'wordguess'];

  return (
    <div className="sg-home">
      {!splashDone && (
        <div className="sg-splash" role="status" aria-label="Loading Shadow Games">
          <div className="sg-splash-inner">
            <img className="sg-splash-mark" src={hqLogo} alt="" />
            <div className="sg-splash-title">SHADOW GAMES</div>
            <div className="sg-splash-sub">THE TABLE IS BEING SET</div>
            <div className="sg-load-track"><i /></div>
            <button type="button" className="sg-splash-skip" onClick={() => { sfx.current?.move(); setSplashDone(true); }}>
              Skip intro
            </button>
          </div>
        </div>
      )}

      <header className="sg-top sg-shell">
        <a className="sg-brand" href={BOT_LINK}>
          <img className="sg-brand-mark" src={hqLogo} alt="" />
          <span className="sg-brand-text"><b>SHADOW GAMES</b><small>STRATEGY · CHANCE · FRIENDSHIP</small></span>
        </a>
        <nav className="sg-nav" aria-label="Sections">
          <a href="#sg-board-games" className="active" onClick={(e) => { e.preventDefault(); scrollTo('sg-board-games'); }}>Games</a>
          <a href="#sg-chat-games" onClick={(e) => { e.preventDefault(); scrollTo('sg-chat-games'); }}>In Telegram</a>
          <a href={BOT_LINK}>Community</a>
        </nav>
        <div className="sg-top-actions">
          <span className="sg-profile" title="Telegram profile">{profile}</span>
          <a className="sg-btn gold small" href={BOT_LINK}>Open Bot <span aria-hidden="true">↗</span></a>
        </div>
      </header>

      <main className="sg-shell" id="sg-main">
        <section className="sg-hero" id="sg-top">
          <div className="sg-hero-copy">
            <div className="sg-eyebrow">A LITTLE COMPETITION NEVER HURT</div>
            <h1>Make your<br /><em>next move.</em></h1>
            <p>A home for quick rivalries, clever plays, and the people you play with. Pick a table, open a room, or take your next challenge into Telegram.</p>
            <div className="sg-actions">
              <button type="button" className="sg-btn gold" onClick={() => scrollTo('sg-board-games')}>Play now <span aria-hidden="true">↗</span></button>
              <button type="button" className="sg-btn" onClick={() => { sfx.current?.move(); notify('Open @ShadowGameEnBot in Telegram to play with friends.'); }}>How it works</button>
            </div>
            <div className="sg-pills">
              <span className="sg-pill"><i aria-hidden="true" /> Two interactive boards</span>
              <span className="sg-pill">3 games in Telegram DM</span>
            </div>
          </div>
          <div className="sg-hero-art">
            <span className="sg-art-corner">SHADOW HQ / 001</span>
            <span className="sg-art-index">CC × SG</span>
            <img src={hqLogo} alt="Code Council emblem presented by Shadow Games" />
            <span className="sg-art-caption">CODE COUNCIL · PRESENTS</span>
          </div>
        </section>

        <section id="sg-board-games" className="sg-section">
          <div className="sg-section-head">
            <div>
              <div className="sg-eyebrow">THE GAME ROOM</div>
              <h2>Choose your table</h2>
              <p>Four ways to play — real boards here, word games and UNO inside Telegram.</p>
            </div>
            <span className="sg-count">01 — 04 / ALL GAMES</span>
          </div>
          <div className="sg-filter" role="tablist" aria-label="Game categories">
            <button type="button" role="tab" id="tab-board" aria-controls="sg-game-panel" aria-selected={filter === 'board'}
              className={filter === 'board' ? 'is-active' : ''} onClick={() => changeFilter('board')}>Board Games</button>
            <button type="button" role="tab" id="tab-word" aria-controls="sg-game-panel" aria-selected={filter === 'word'}
              className={filter === 'word' ? 'is-active' : ''} onClick={() => changeFilter('word')}>Word Games</button>
          </div>
          <div className="sg-board-games" id="sg-game-panel" role="tabpanel" aria-labelledby={filter === 'board' ? 'tab-board' : 'tab-word'}>
            {shown.map((id) => (
              <GameCard key={id} game={GAMES[id]} onOpen={(key) => { sfx.current?.move(); setActiveGame(key); }}
                preview={id === 'chess'
                  ? <img className="sg-preview-img" src={chessPreview} alt="3D chessboard with pieces set up" />
                  : id === 'ludo'
                    ? <img className="sg-preview-img" src={ludoPreview} alt="Ludo board with four player yards" />
                    : <WordTiles word={id === 'wordseek' ? 'SEEK' : 'GUESS'} />}
              />
            ))}
          </div>
        </section>

        <section id="sg-chat-games" className="sg-section">
          <div className="sg-section-head">
            <div>
              <div className="sg-eyebrow">IN THE GROUP CHAT</div>
              <h2>More in Telegram</h2>
              <p>These games open Shadow Games in Telegram DM using the start links from the current app.</p>
            </div>
            <span className="sg-count">05 / TELEGRAM</span>
          </div>
          <div className="sg-mini-grid">
            <Mini tone="uno" name="UNO" desc="Deal the cards, pick your mode, and outplay your friends with perfectly timed moves." command="newuno" />
            <Mini tone="seek" name="DAILY WORD" desc="Solve the daily word puzzle and keep your streak alive." command="daily" />
            <Mini tone="word" name="LEADERBOARD" desc="See where you rank across all Shadow Games." command="leaderboard" />
          </div>
          <div className="sg-note">
            <span className="sg-note-mark" aria-hidden="true">✦</span>
            <span><b>Want the full experience?</b><br />Open @ShadowGameEnBot in Telegram for the bot-driven group games, commands, and room invitations.</span>
            <a href={BOT_LINK}>Visit Bot <span aria-hidden="true">↗</span></a>
          </div>
        </section>
      </main>

      <footer className="sg-footer sg-shell">
        <span>CODE COUNCIL × SHADOW GAMES</span>
        <span>PLAY WELL. PLAY TOGETHER.</span>
        <span>STRATEGY · CHANCE · FRIENDSHIP</span>
      </footer>

      {toast && <div className="sg-toast" role="status">{toast}</div>}

      {game && (
        <div className="sg-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setActiveGame(null); }}>
          <div className="sg-modal" role="dialog" aria-modal="true" aria-labelledby="sg-modal-title" ref={modalRef}>
            <button type="button" className="sg-modal-close" aria-label="Close preview" onClick={() => { sfx.current?.move(); setActiveGame(null); }}>×</button>
            <div className="sg-card-number">{game.num}</div>
            <h2 id="sg-modal-title">{game.title}</h2>
            <p className="sg-modal-desc">{game.desc}</p>
            <div className="sg-modal-preview">
              {game.id === 'chess' && <ChessMini />}
              {game.id === 'ludo' && <LudoMini />}
              {game.id === 'wordseek' && <WordTiles word="SEEK" revealed />}
              {game.id === 'wordguess' && <WordTiles word="GUESS" revealed />}
            </div>
            <div className="sg-modal-actions">
              <a className="sg-btn gold" href={game.href} onClick={() => sfx.current?.move()}>{game.cta} <span aria-hidden="true">↗</span></a>
              <button type="button" className="sg-btn" onClick={() => { sfx.current?.move(); setActiveGame(null); }}>Back to games</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
