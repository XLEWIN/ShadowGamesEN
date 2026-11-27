import { describe, expect, it } from 'vitest';
import { Chess } from './vendor/chess.js';

describe('chess engine (unchanged game logic)', () => {
  it('applies a legal move and flips the turn', () => {
    const g = new Chess();
    const m = g.move({ from: 'e2', to: 'e4' });
    expect(m.san).toBe('e4');
    expect(g.turn()).toBe('b');
  });

  it('rejects an illegal move without changing the position', () => {
    const g = new Chess();
    const before = g.fen();
    expect(() => g.move({ from: 'e2', to: 'e5' })).toThrow();
    expect(g.fen()).toBe(before);
  });

  it('detects checkmate', () => {
    // Fool's mate position after 1.f3 e5 2.g4 Qh4#
    const g = new Chess();
    ['f2f3', 'e7e5', 'g2g4', 'd8h4'].forEach((u) => g.move({ from: u.slice(0, 2), to: u.slice(2) }));
    expect(g.isCheckmate()).toBe(true);
    expect(g.turn()).toBe('w');
  });
});
