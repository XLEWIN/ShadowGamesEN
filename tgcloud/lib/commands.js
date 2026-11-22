// Command parser — shared between dispatch and guards.
// Port of lib/commands.js (Python): prefixes, @bot suffix, args.

export const HANDLED_COMMANDS = new Set([
  'start', 'help', 'rules', 'game', 'stop', 'score', 'stats', 'mystats',
  'ranking', 'globalranking', 'chatranking', 'new', 'new4', 'new5', 'new6',
  'newword', 'newuno', 'startuno', 'join', 'leave', 'kill', 'kick', 'open',
  'close', 'skip', 'notifyme', 'notify_me', 'modes', 'unostats', 'end',
  'daily', 'pausedaily', 'leaderboard', 'myscore', 'id', 'ludo', 'chess',
  'games', 'setgametopic', 'unsetgametopic', 'allowonlylen', 'recreatetopic',
  'seekauth', 'resetdata', 'gban', 'ungban', 'ban', 'unban', 'transfer',
  'track', 'untrack', 'tracklist', 'broadcast', 'broadcast_status',
  'broadcast_cancel', 'captcha',
]);

export function parseCommand(text, botUsername) {
  if (!text) return null;
  const trimmed = String(text).trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.split(/\s+/);
  let command = parts[0].slice(1);
  const args = parts.slice(1).join(' ');
  const at = command.indexOf('@');
  if (at !== -1) {
    const suffix = command.slice(at + 1);
    command = command.slice(0, at);
    if (suffix.toLowerCase() !== String(botUsername || '').toLowerCase()) return null;
  }
  command = command.toLowerCase();
  if (!HANDLED_COMMANDS.has(command)) return null;
  return { command, args, raw: trimmed };
}
