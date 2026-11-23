import React, { useEffect, useMemo, useRef, useState } from 'react';
import hqLogo from '../assets/spiky-code-council-emblem.png';
import { callServer } from '../shared/lobby.js';
import { normalizeRoomCode, roomPageUrl } from '../shared/room.js';
import './HubHome.css';

const BOT_LINK = 'https://t.me/ShadowGameEnBot';
const SPARKS = Array.from({ length: 24 }, (_, i) => ({
  x: Math.random() * 100,
  t: 12 + Math.random() * 18,
  dx: Math.random() * 120 - 60,
  delay: -Math.random() * 25,
}));

const CHESS_ICON = (
  <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M15 39h19M18 35h13l-2-5 5-7-5-3 2-8-7 3-6-5-1 9-6 4 7 5z"/><path d="M18 35h13M21 30h10"/></svg>
);
const LUDO_ICON = (
  <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="7" y="7" width="34" height="34" rx="5"/><path d="M7 19h12V7M29 7v12h12M7 29h12v12M29 41V29h12"/><circle cx="13" cy="13" r="2.5"/><circle cx="35" cy="13" r="2.5"/><circle cx="13" cy="35" r="2.5"/><circle cx="35" cy="35" r="2.5"/><path d="m24 18 6 6-6 6-6-6z"/></svg>
);
const UNO_ICON = (
  <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="6" width="28" height="36" rx="7" transform="rotate(-14 24 24)"/><path d="M20 15h9M20 24h10M20 33h7"/></svg>
);
const WORD_ICON = (
  <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 13h32M8 24h22M8 35h28"/><path d="m34 19 5 5-5 5"/></svg>
);

function GameCard({ num, title, desc, cta, href, icon }) {
  return (
    <article className="sg-game-card">
      <span className="num">{num}</span>
      <span className="sg-game-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{desc}</p>
      <button type="button" onClick={() => { window.location.href = href; }}>{cta} &nbsp;↗</button>
    </article>
  );
}

function Mini({ icon, name, desc, command }) {
  return (
    <a className="sg-mini" href={`${BOT_LINK}?start=${command.replace('/', '')}`}>
      <b><span className="sg-mini-mark">{icon}</span>{name}</b>
      <p>{desc}</p>
    </a>
  );
}

export default function HubApp() {
  const [splashDone, setSplashDone] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const profile = useMemo(() => {
    const u = window.Telegram?.WebApp?.initDataUnsafe?.user;
    return u ? (u.username ? `@${u.username}` : (u.first_name || 'PLAYER')).toUpperCase() : 'PLAYER / GUEST';
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), 1150);
    return () => clearTimeout(t);
  }, []);

  // Deep link from inline Join/Spectate buttons: open the right table directly.
  useEffect(() => {
    try {
      const payload = (window.Telegram?.WebApp?.startParam || '').trim();
      if (!payload) return;
      const parts = payload.split('-');
      const watching = parts[0] === 'watch';
      const game = watching ? parts[1] : parts[0];
      const code = normalizeRoomCode(watching ? parts[2] : parts[1]);
      if (!['ludo', 'chess'].includes(game) || !/^[A-Z0-9]{5}$/.test(code)) return;
      if (watching) {
        callServer('lobbySpectate', { code });
        window.location.href = roomPageUrl(game, code, true);
      } else {
        callServer('lobbyCreate', { code, game, maxPlayers: game === 'chess' ? 2 : 4 });
        callServer('lobbyJoin', { code });
        window.location.href = roomPageUrl(game, code);
      }
    } catch (e) { /* stay on hub */ }
  }, []);

  function notify(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  }
  function scrollToGames() {
    document.getElementById('sg-games')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="sg-home">
      <div className={`sg-splash${splashDone ? ' done' : ''}`}>
        <div className="sg-splash-inner">
          <div className="sg-splash-mark">✦</div>
          <div className="sg-splash-title">SHADOW GAMES</div>
          <div className="sg-splash-sub">THE TABLE IS BEING SET</div>
          <div className="sg-load-track"><i /></div>
        </div>
      </div>

      <div className="sg-sparks" aria-hidden="true">
        {SPARKS.map((s, i) => (
          <i key={i} className="sg-spark" style={{ '--x': `${s.x}%`, '--t': `${s.t}s`, '--dx': `${s.dx}px`, animationDelay: `${s.delay}s` }} />
        ))}
      </div>

      <header className="sg-top sg-shell">
        <a className="sg-brand" href={BOT_LINK}>
          <span className="sg-sigil"><span>✦</span></span> SHADOW GAMES
        </a>
        <nav className="sg-nav">
          <a href="#sg-top" className="active" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Discover</a>
          <a href="#sg-games" onClick={(e) => { e.preventDefault(); scrollToGames(); }}>Games</a>
          <a href="#sg-community" onClick={(e) => { e.preventDefault(); notify('Join the community in the bot — @ShadowGameEnBot.'); }}>Community</a>
        </nav>
        <div className="sg-profile" id="sg-community">{profile}</div>
      </header>

      <main className="sg-shell">
        <section className="sg-hero" id="sg-top">
          <div>
            <div className="sg-eyebrow">A LITTLE COMPETITION NEVER HURT</div>
            <h1>Make your<br />next move.</h1>
            <p>A home for quick rivalries, clever plays and the people you play with. Pick a table, invite a friend, or test your instincts against the house.</p>
            <div className="sg-actions">
              <button type="button" className="sg-btn gold" onClick={scrollToGames}>Explore games <span>↗</span></button>
              <button type="button" className="sg-btn" onClick={() => notify('Open Shadow Games in Telegram to play with friends online.')}>How it works</button>
            </div>
          </div>
          <div className="sg-hero-art">
            <img className="sg-hq-logo" src={hqLogo} alt="Code Council" />
            <div className="sg-art-label">STRATEGY · CHANCE · FRIENDSHIP</div>
          </div>
        </section>

        <div className="sg-section-head" id="sg-games">
          <h2>Choose your table</h2>
          <span>01 — THE GAME ROOM</span>
        </div>
        <div className="sg-games">
          <GameCard
            num="01 / STRATEGY"
            title="CHESS"
            desc="Foony board, real rules. Take on the AI, challenge someone beside you, or open an online room."
            cta="ENTER THE BOARD"
            href="./chess/"
            icon={CHESS_ICON}
          />
          <GameCard
            num="02 / RACE"
            title="LUDO"
            desc="Race your pawns home. Play against bots, pass the phone around, or bring friends into a room."
            cta="ROLL THE DICE"
            href="./ludo/"
            icon={LUDO_ICON}
          />
        </div>

        <div className="sg-section-head">
          <h2>In the group chat</h2>
          <span>03 — TELEGRAM GAMES</span>
        </div>
        <div className="sg-mini-grid">
          <Mini icon="▰" name="UNO" command="newuno"
            desc="Classic, Fast and Wild modes. Bluff, stack and counter-attack with friends." />
          <Mini icon="▦" name="WORDSEEK" command="new"
            desc="Guess the hidden word together, with four to six letter rounds." />
          <Mini icon="✳" name="DAILY WORDSEEK" command="daily"
            desc="A shared daily puzzle, six tries, streaks and a leaderboard." />
        </div>
        <div className="sg-mini-grid" style={{ marginTop: '-34px' }}>
          <Mini icon="◈" name="SHADOW WORD" command="game"
            desc="One player describes the secret word, the rest race to guess it." />
          <Mini icon="♟" name="CHESS IN CHAT" command="chess"
            desc="Open the chess room right from the bot, then invite your rival." />
          <Mini icon="🎲" name="LUDO IN CHAT" command="ludo"
            desc="Open the ludo table from the bot and roll for the win." />
        </div>
      </main>

      <footer className="sg-footer sg-shell">
        <span>© SHADOW GAMES</span>
        <span>PLAY WELL. PLAY TOGETHER.</span>
        <span>SHADOW HQ · EN INDIA</span>
      </footer>
      <div className="sg-toast" style={{ display: toast ? 'block' : 'none' }}>{toast}</div>
    </div>
  );
}
