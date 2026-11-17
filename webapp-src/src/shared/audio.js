export function createSfx() {
  let ctx = null;
  const mutedRef = { current: false };
  const tone = (freq, dur = 0.08, type = 'triangle', vol = 0.06) => {
    if (mutedRef.current) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + dur);
    } catch (e) { /* audio unavailable */ }
  };
  return {
    mutedRef,
    toggle: () => { mutedRef.current = !mutedRef.current; return mutedRef.current; },
    roll: () => { tone(300, .07); setTimeout(() => tone(420, .07), 70); setTimeout(() => tone(520, .09), 140); },
    move: () => tone(660, .06, 'triangle', .06),
    capture: () => { tone(180, .15, 'sawtooth', .07); setTimeout(() => tone(120, .2, 'sawtooth', .07), 110); },
    home: () => [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, .14, 'triangle', .07), i * 90)),
    win: () => [523, 587, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .22, 'triangle', .08), i * 130)),
    castle: () => { tone(392, .08, 'triangle', .06); setTimeout(() => tone(587, .1, 'triangle', .06), 80); },
    promote: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .14, 'triangle', .07), i * 80)),
    illegal: () => tone(150, .09, 'square', .045),
    draw: () => [392, 330, 294].forEach((f, i) => setTimeout(() => tone(f, .18, 'sine', .06), i * 140)),
    check: () => { tone(784, .12, 'sine', .07); setTimeout(() => tone(988, .14, 'sine', .07), 100); },
  };
}
