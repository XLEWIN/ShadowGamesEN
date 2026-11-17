import React from 'react';

const MINI_GAMES = [
  { name: 'LUDO', href: './ludo/', icon: 'ludo/assets/icon.webp', desc: 'Race your pawns home — vs AI, 1v1 or online rooms' },
  { name: 'CHESS', href: './chess/', icon: 'chess/assets/icon.webp', desc: 'Foony board, real rules — vs AI, 1v1 or online rooms' },
];

const CHAT_GAMES = [
  { emoji: '🎴', name: 'UNO', desc: 'Classic / Fast / Wild — bluff, stack and counter-attack with your friends.', cmd: '/newuno' },
  { emoji: '🟩', name: 'WORDSEEK', desc: 'Guess the hidden word together — 4 to 6 letters.', cmd: '/new' },
  { emoji: '🔤', name: 'SHADOW WORD', desc: 'One describes, the rest guess — Xeons on the line.', cmd: '/game' },
  { emoji: '☀️', name: 'DAILY WORDSEEK', desc: 'One shared puzzle per day, 6 tries, streaks and a leaderboard.', cmd: '/daily' },
  { emoji: '🧮', name: 'EVERYTHING ELSE', desc: 'Scores, rewards, UNO stats, group leaderboards, admin tools & more.', cmd: '/help' },
];

export default function HubApp() {
  return (
    <div className="sg-bg relative min-h-full flex flex-col items-center px-4 pt-7 pb-8 text-[#f2ead9]">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-[0_10px_26px_rgba(227,183,91,.35),inset_0_2px_2px_rgba(255,255,255,.6),inset_0_-3px_6px_rgba(60,40,0,.5)]"
             style={{ background: 'linear-gradient(160deg,#ffd97a,#e3b75b 45%,#8a6b2f)' }}>
          <svg viewBox="0 0 48 48" className="w-11 h-11" aria-hidden="true">
            <path fill="#0c0a14" d="M24 2 43 13.5v21L24 46 5 34.5v-21L24 2z"/>
            <path fill="none" stroke="#2a2214" strokeWidth="2.2" d="M24 6.5 39.3 15.4v17.2L24 41.5 8.7 32.6V15.4L24 6.5z"/>
            <text x="24" y="30.5" textAnchor="middle" fontFamily="'Exo 2',sans-serif" fontWeight="900" fontSize="15" fill="#0c0a14">SG</text>
          </svg>
        </div>
        <div className="flex flex-col">
          <span className="font-extrabold tracking-[6px] text-[13px]">SHADOW GAMES</span>
          <span className="text-[9px] tracking-[4px] text-[#e3b75b] font-bold">◈ ᴇɴ ɪɴᴅɪᴀ ◈</span>
        </div>
      </div>

      <h1 className="game-title-word text-[clamp(40px,13vw,64px)] font-black tracking-[10px] indent-[10px] leading-none mt-2">GAMES</h1>
      <div className="text-[#a99e86] text-[12px] tracking-wide mt-1 mb-4">Pick a game — beat your friends.</div>

      <div className="w-full max-w-[680px]">
        <div className="flex items-center gap-2.5 text-[9px] tracking-[4px] text-[#e3b75b] font-extrabold mt-3 mb-2">
          MINI APPS
          <span className="flex-1 h-px bg-[linear-gradient(90deg,rgba(227,183,91,.35),transparent)]" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {MINI_GAMES.map(g => (
            <a key={g.name} href={g.href} className="sg-grad-panel group rounded-[20px] px-3 py-4 flex flex-col items-center gap-2.5 transition-transform duration-150
                                                     hover:-translate-y-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd97a] no-underline">
              <img src={g.icon} alt={g.name} className="w-24 h-24 object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,.6)]" draggable="false" />
              <div className="font-black tracking-[2px] text-[17px]">{g.name}</div>
              <div className="text-[10px] text-[#a99e86] text-center leading-snug min-h-[28px]">{g.desc}</div>
              <span className="btn btn-gold text-[9px] tracking-[2px] px-5 py-1.5 rounded-[9px] mt-auto">PLAY</span>
            </a>
          ))}
          <div className="sg-grad-panel rounded-[20px] px-3 py-4 flex flex-col items-center gap-2.5 opacity-50" aria-disabled="true">
            <img src="ludo/assets/icon.webp" alt="More coming" className="w-24 h-24 object-contain grayscale" draggable="false" />
            <div className="font-black tracking-[2px] text-[13px]">COMING SOON</div>
            <div className="text-[10px] text-[#a99e86] text-center leading-snug min-h-[28px]">More Shadow Games mini apps are on the way</div>
            <span className="text-[9px] tracking-[2px] font-extrabold text-[#a99e86] px-5 py-1.5 rounded-[9px] bg-[#1a2243]">SOON</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 text-[9px] tracking-[4px] text-[#e3b75b] font-extrabold mt-4 mb-2">
          PLAY IN THE BOT CHAT
          <span className="flex-1 h-px bg-[linear-gradient(90deg,rgba(227,183,91,.35),transparent)]" />
        </div>
        <div className="flex flex-col gap-2">
          {CHAT_GAMES.map(g => (
            <a key={g.name} href="https://t.me/ShadowGameEnBot?start=games"
               className="group flex items-center gap-3 rounded-2xl border border-white/10 sg-grad-panel px-4 py-3 no-underline text-[#f2ead9] transition-transform duration-150 hover:translate-x-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ffd97a]">
              <div className="text-[28px] w-11 text-center shrink-0">{g.emoji}</div>
              <div className="min-w-0">
                <div className="font-extrabold text-[13px] tracking-wide">{g.name}</div>
                <div className="text-[10.5px] text-[#a99e86] leading-snug">{g.desc}</div>
              </div>
              <span className="ml-auto shrink-0 font-mono text-[11px] text-[#ffd97a] bg-[#1a2243] border border-[rgba(227,183,91,.22)] px-2.5 py-1.5 rounded-lg">{g.cmd}</span>
            </a>
          ))}
        </div>
      </div>

      <footer className="mt-auto pt-6 text-[11px] text-[#a99e86] flex items-center gap-2">
        <a className="text-[#e3b75b] font-bold no-underline" href="https://t.me/ShadowGameEnBot">@ShadowGameEnBot</a>
        <span className="opacity-50">•</span>
        <span>Shadow Games — the Indian gaming hub</span>
      </footer>
    </div>
  );
}
