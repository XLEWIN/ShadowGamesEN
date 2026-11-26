// Input validation / sanitization helpers. All external input is untrusted.

export function safeText(value, max = 256) {
  if (value === null || value === undefined) return '';
  return String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, max);
}

export function safeId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

export function safeInt(value, { min = -Infinity, max = Infinity, fallback = null } = {}) {
  const n = Number.parseInt(safeText(value, 32), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const ROOM_CODE_RE = /^[A-Z0-9]{5}$/;
export const WORD_RE = /^[a-z]{4,6}$/;
export const USERNAME_RE = /^[A-Za-z0-9_]{3,32}$/;

export function safeCode(value) {
  const code = safeText(value, 8).trim().toUpperCase();
  return ROOM_CODE_RE.test(code) ? code : null;
}

export function safeWord(value, length = null) {
  const word = safeText(value, 12).trim().toLowerCase();
  if (!WORD_RE.test(word)) return null;
  return length === null || word.length === length ? word : null;
}

export function safeCallbackData(value) {
  const data = safeText(value, 64);
  if (!data || !/^[a-z0-9_:\-]+$/i.test(data)) return null;
  return data;
}

export function safeQuery(value) {
  return safeText(value, 256).trim();
}

export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
