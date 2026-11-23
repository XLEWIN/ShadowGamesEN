import React, { useEffect, useState } from 'react';
import { callServer } from './lobby.js';

// Read-only live view of a lobby — works during setup and while a game is running.
export default function SpectateView({ code, game, onJoin }) {
  const [state, setState] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    callServer('lobbySpectate', { code });
    callServer('lobbyState', { code }).then((r) => { if (alive && r?.ok) setState(r); });
    return () => { alive = false; };
  }, [code, tick]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2500);
    return () => clearInterval(id);
  }, []);

  const players = state?.players || [];
  const spectators = state?.spectators || [];
  const gameName = (state?.game || game || 'game').toUpperCase();

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-5 py-8 gap-4">
      <div className="text-[10px] tracking-[5px] font-extrabold text-[#e3b75b]">SPECTATOR VIEW</div>
      <h1 className="game-title-word text-[46px] font-black tracking-[6px] leading-none">{gameName}</h1>
      <div className="rounded-2xl border border-[#e3b75b]/30 bg-[#131a33] px-5 py-4 w-full max-w-[420px]">
        <div className="flex justify-between items-center text-[12px] font-bold">
          <span className="text-[#a99e86]">TABLE</span>
          <span className="font-mono text-[#ffd97a] tracking-[4px]">{code}</span>
        </div>
        <div className="flex justify-between items-center mt-2 text-[12px]">
          <span className="text-[#a99e86]">STATUS</span>
          <span className="font-extrabold">{(state?.status || 'connecting').toUpperCase()}</span>
        </div>
        <div className="flex justify-between items-center mt-2 text-[12px]">
          <span className="text-[#a99e86]">PLAYERS</span>
          <span className="font-extrabold">{players.length}/{state?.maxPlayers || 2}</span>
        </div>
        <div className="flex justify-between items-center mt-2 text-[12px]">
          <span className="text-[#a99e86]">WATCHING</span>
          <span className="font-extrabold">{spectators.length}</span>
        </div>
      </div>
      <div className="w-full max-w-[420px] flex flex-col gap-2">
        {players.map((p, i) => (
          <div key={i} className="flex items-center rounded-xl border border-white/10 bg-[#0d1224] px-4 py-2 text-[12px] font-bold">
            <span className="text-[#e3b75b] mr-3">{i + 1}.</span>{p.name}
          </div>
        ))}
        {!players.length && <div className="text-center text-[12px] text-[#a99e86]">Waiting for players…</div>}
      </div>
      {onJoin && (
        <button className="btn btn-gold w-full max-w-[420px] py-4 text-[15px]" onClick={onJoin}>JOIN THIS TABLE ↗</button>
      )}
      <div className="text-[11px] text-[#a99e86] text-center">Live table status updates automatically.</div>
    </div>
  );
}
