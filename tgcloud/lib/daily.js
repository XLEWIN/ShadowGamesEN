// Daily WordSeek — deterministic word-of-the-day (bit-exact port)
import { dailyWords } from './data/dailyWords.js';

// HMAC-SHA256(secret, "wotd-permutation-seed") first 4 bytes, precomputed
const SEED = 3909408730;
const START_DATE_MS = Date.UTC(2025, 0, 1);

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t) >>> 0;
    // mulberry32: t ^= t + Math.imul(t ^ t >>> 7, t | 61)
    r = ((r + Math.imul(r ^ (r >>> 7), 61 | r)) >>> 0) ^ r;
    r = r >>> 0;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    return r;
  };
}
export function dayNumber(nowMs = Date.now()) {
  return Math.floor((nowMs - START_DATE_MS) / 86400000);
}
export function getGameDate(nowMs = Date.now()) {
  const n = dayNumber(nowMs);
  const d = new Date(START_DATE_MS + Math.max(0, n) * 86400000);
  return d.toISOString().slice(0, 10);
}
export function getWordOfTheDay(nowMs = Date.now()) {
  const rnd = mulberry32(SEED);
  const arr = [...dailyWords];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const n = dayNumber(nowMs);
  const idx = ((n % arr.length) + arr.length) % arr.length;
  return arr[idx];
}
