import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Telegram Mini App stub — the hub reads initDataUnsafe and startParam.
window.Telegram = {
  WebApp: {
    initData: 'user=' + encodeURIComponent(JSON.stringify({ id: 1, first_name: 'Tester' })),
    initDataUnsafe: { user: { id: 1, first_name: 'Tester' } },
    startParam: '',
    ready: vi.fn(), expand: vi.fn(),
    setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(),
    disableVerticalSwipes: vi.fn(),
    BackButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn() },
    Serverless: { call: (_name, _input, cb) => cb && cb(null, null) },
  },
};

Element.prototype.scrollIntoView = vi.fn();
window.matchMedia = window.matchMedia || ((q) => ({
  matches: false, media: q, onchange: null,
  addListener: vi.fn(), removeListener: vi.fn(),
  addEventListener: vi.fn(), removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

class FakeAudioContext {
  createOscillator() {
    return { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  }
  createGain() {
    return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
  }
  get destination() { return {}; }
  get currentTime() { return 0; }
}
window.AudioContext = FakeAudioContext;
