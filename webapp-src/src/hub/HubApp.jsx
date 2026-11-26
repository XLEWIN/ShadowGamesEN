import React, { useEffect, useMemo, useRef, useState } from 'react';
import hqLogo from '../assets/spiky-code-council-emblem.png';
import { callServer } from '../shared/lobby.js';
import { normalizeRoomCode, roomPageUrl } from '../shared/room.js';
import './HubHome.css';

const BOT_LINK = 'https://t.me/ShadowGameEnBot';

const CHESS_PIECES = {
  wp: './chess/assets/chessSetDefault_PawnWhite_160.webp',
  wn: './chess/assets/chessSetDefault_KnightWhite_160.webp',
  wb: './chess/assets/chessSetDefault_BishopWhite_160.webp',
  wr: './chess/assets/chessSetDefault_RookWhite_160.webp',
  wq: './chess/assets/chessSetDefault_QueenWhite_160.webp',
  wk: './chess/assets/chessSetDefault_KingWhite_160.webp',
  bp: './chess/assets/chessSetDefault_PawnBlack_160.webp',
  bn: './chess/assets/chessSetDefault_KnightBlack_160.webp',
  bb: './chess/assets/chessSetDefault_BishopBlack_160.webp',
  br: './chess/assets/chessSetDefault_RookBlack_160.webp',
  bq: './chess/assets/chessSetDefault_QueenBlack_160.webp',
  bk: './chess/assets/chessSetDefault_KingBlack_160.webp',
};
const BACK_RANK = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

function ChessPreview() {
  const cells = [];
  for (const [row, side] of [[0, 'b'], [1, 'b'], [6, 'w'], [7, 'w']]) {
    for (let col = 0; col < 8; col++) {
      const key = side + (row === 1 || row === 6 ? 'p' : BACK_RANK[col]);
      cells.push(
        <img key={`${row}-${col}`} src={CHESS_PIECES[key]} alt="" className="sg-preview-piece"
          style={{ left: `${col * 12.5}%`, top: `${row * 12.5}%` }} />,
      );
    }
  }
  return (
    <div className="sg-chess-preview" aria-label="Chess board preview"
      style={{ backgroundImage: "url('./chess/assets/chessBoardDefault_1280.webp')" }}>
      <div className="sg-chess-grid" />
      {cells}
      <div className="sg-preview-coords">'8 7 6 5 4 3 2 1 a b c d e f g h'</div>
    </div>
  );
}

function LudoPreview() {
  const yards = [
    ['blue', './ludo/assets/pieces_blue.svg', '1 / 1 / 4 / 4'],
    ['yellow', './ludo/assets/pieces_yellow.svg', '1 / 11 / 4 / 14'],
    ['red', './ludo/assets/pieces_red.svg', '11 / 1 / 14 / 4'],
    ['green', './ludo/assets/pieces_green.svg', '11 / 11 / 14 / 14'],
  ];
  return (
    <div className="sg-ludo-preview" aria-label="Ludo board preview">
      {yards.map(([color, img, area]) => (
        <div key={color} className={`sg-preview-yard yard-${color}`} style={{ gridArea: area }}>
          {[0, 1, 2, 3].map(i => <img key={i} src={img} alt="" />)}
          <span className="sg-preview-star">★</span>
        </div>
      ))}
      <div className="sg-preview-center">SG</div>
    </div>
  );
}

function GameCard({ num, title, desc, detail, cta, href, preview }) {
  return (
    <article className="sg-game-card">
      <div className="sg-card-top">
        <div>
          <div className="sg-card-number">{num}</div>
          <h3>{title}</h3>
          <p>{desc}</p>
        </div>
        <span className="sg-pill">Board preview</span>
      </div>
      <div className="sg-board-preview">{preview}</div>
      <div className="sg-card-bottom">
        <span className="sg-detail">{detail}</span>
        <a className="sg-btn gold small" href={href}>{cta} <span>↗</span></a>
      </div>
    </article>
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
      <span className="sg-mini-cta">OPEN IN BOT <span>↗</span></span>
    </a>
  );
}

export default function HubApp() {
  const [splashDone, setSplashDone] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const profile = useMemo(() => {
    const u = window.Telegram?.WebApp?.initDataUnsafe?.user;
    return u ? (u.username ? `@${u.username}` : (u.first_name || 'PLAYER')) : 'PLAYER / GUEST';
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), 900);
    return () => clearTimeout(t);
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
        const go = (spectate) => { window.location.href = roomPageUrl(game, code, spectate); };
        if (watching) { callServer('lobbySpectate', { code }); go(true); return; }
        const joined = await Promise.race([
          callServer('lobbyJoin', { code, game }),
          new Promise((resolve) => setTimeout(() => resolve(null), 500)),
        ]);
        if (joined?.expired) { setToast(joined.error || 'Session expired — ask for a new invite.'); return; }
        if (joined && joined.ok === false && !joined.full) { setToast(joined.error || 'Invite is no longer valid.'); return; }
        go(!!(joined && joined.full));
      } catch (e) { /* stay on hub */ }
    })();
  }, []);

  function notify(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  }
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="sg-home">
      <div className={`sg-splash${splashDone ? ' done' : ''}`}>
        <div className="sg-splash-inner">
          <img className="sg-splash-mark" src={hqLogo} alt="" />
          <div className="sg-splash-title">SHADOW GAMES</div>
          <div className="sg-splash-sub">THE TABLE IS BEING SET</div>
          <div className="sg-load-track"><i /></div>
        </div>
      </div>

      <header className="sg-top sg-shell">
        <a className="sg-brand" href={BOT_LINK}>
          <img className="sg-brand-mark" src={hqLogo} alt="" />
          <span className="sg-brand-text"><b>SHADOW GAMES</b><small>STRATEGY · CHANCE · FRIENDSHIP</small></span>
        </a>
        <nav className="sg-nav" aria-label="Sections">
          <a href="#sg-board-games" className="active" onClick={(e) => { e.preventDefault(); scrollTo('sg-board-games'); }}>Board games</a>
          <a href="#sg-chat-games" onClick={(e) => { e.preventDefault(); scrollTo('sg-chat-games'); }}>Chat games</a>
          <a href={BOT_LINK}>Community</a>
        </nav>
        <div className="sg-top-actions">
          <span className="sg-profile" title="Telegram profile">{profile}</span>
          <a className="sg-btn gold small" href={BOT_LINK}>Open Bot <span>↗</span></a>
        </div>
      </header>

      <main className="sg-shell">
        <section className="sg-hero" id="sg-top">
          <div className="sg-hero-copy">
            <div className="sg-eyebrow">A LITTLE COMPETITION NEVER HURT</div>
            <h1>Make your<br /><em>next move.</em></h1>
            <p>A home for quick rivalries, clever plays, and the people you play with. Pick a table, open a room, or take your next challenge into Telegram.</p>
            <div className="sg-actions">
              <button type="button" className="sg-btn gold" onClick={() => scrollTo('sg-board-games')}>Explore the games <span>↗</span></button>
              <button type="button" className="sg-btn" onClick={() => notify('Open @ShadowGameEnBot in Telegram to play with friends.')}>How it works</button>
            </div>
            <div className="sg-pills">
              <span className="sg-pill"><i /> Two interactive boards</span>
              <span className="sg-pill">3 games in Telegram DM</span>
            </div>
          </div>
          <div className="sg-hero-art">
            <span className="sg-art-corner">SHADOW HQ / 001</span>
            <span className="sg-art-index">CC × SG</span>
            <img src={hqLogo} alt="Code Council emblem" />
            <span className="sg-art-caption">CODE COUNCIL · PRESENTS</span>
          </div>
        </section>

        <section id="sg-board-games" className="sg-section">
          <div className="sg-section-head">
            <div>
              <div className="sg-eyebrow">THE GAME ROOM</div>
              <h2>Choose your table</h2>
              <p>Chess preserves the original Shadow Games board skin. Ludo uses the original 15×15 geometry with clearer framing and tactile tokens.</p>
            </div>
            <span className="sg-count">01 — 02 / BOARD GAMES</span>
          </div>
          <div className="sg-board-games">
            <GameCard
              num="01 / STRATEGY" title="CHESS"
              desc="Think a few moves ahead. Original Shadow Games board skin, original sculpted set, and a familiar move layout."
              detail="REAL PIECE ART · CLICK-TO-MOVE" cta="Enter board" href="./chess/" preview={<ChessPreview />} />
            <GameCard
              num="02 / RACE" title="LUDO"
              desc="Bring the tokens home. Classic 15×15 race geometry, safe-star spaces, home lanes, and an embossed dice table."
              detail="TOKEN ART · DICE ANIMATION" cta="Roll in" href="./ludo/" preview={<LudoPreview />} />
          </div>
        </section>

        <section id="sg-chat-games" className="sg-section">
          <div className="sg-section-head">
            <div>
              <div className="sg-eyebrow">IN THE GROUP CHAT</div>
              <h2>Play directly with the bot</h2>
              <p>These games open Shadow Games in Telegram DM using the start links from the current app.</p>
            </div>
            <span className="sg-count">03 — 05 / TELEGRAM</span>
          </div>
          <div className="sg-mini-grid">
            <Mini tone="uno" name="UNO" desc="Deal the cards, pick your mode, and outplay your friends with perfectly timed moves." command="newuno" />
            <Mini tone="seek" name="WORDSEEK" desc="Start a hidden-word round in Telegram. Find the word and keep your streak alive." command="new" />
            <Mini tone="word" name="WORDGUESS" desc="Kick off a word-guessing game with your group and see who gets it first." command="game" />
          </div>
          <div className="sg-note">
            <span className="sg-note-mark">✦</span>
            <span><b>Want the full experience?</b><br />Open @ShadowGameEnBot in Telegram for the bot-driven group games, commands, and room invitations.</span>
            <a href={BOT_LINK}>Visit Bot <span>↗</span></a>
          </div>
        </section>
      </main>

      <footer className="sg-footer sg-shell">
        <span>CODE COUNCIL × SHADOW GAMES</span>
        <span>PLAY WELL. PLAY TOGETHER.</span>
        <span>STRATEGY · CHANCE · FRIENDSHIP</span>
      </footer>
      {toast && <div className="sg-toast" role="status">{toast}</div>}
    </div>
  );
}
