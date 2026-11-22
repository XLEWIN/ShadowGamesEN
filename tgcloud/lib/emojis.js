// Premium custom emoji system — exact port of Python emojis.py
// E.* are HTML markup for message bodies; EID.* are raw ids for button icons.

const EMOJI_MAP = {
  crown: [['👑', '5805553606635559688']],
  admin: [['⚡', '5042334757040423886'], ['👑', '5805553606635559688'], ['💼', '5420405566872788904']],
  success: [['✅', '6325687241536440125'], ['✔️', '5039844895779455925'], ['👍', '6055188418822937956']],
  check: [['✅', '6325687241536440125'], ['✔️', '5039844895779455925']],
  error: [['❌', '5040042498634810056']],
  cross: [['❌', '5040042498634810056']],
  disapprove: [['👎', '5121063440311386962']],
  warning: [['❗', '5040034664614462519'], ['‼️', '5084772285215147326']],
  alert: [['❗', '5040034664614462519'], ['‼️', '5084772285215147326'], ['📣', '6097973409851906183']],
  mute: [['🔈', '6098245027878672529']],
  ban: [['❌', '5040042498634810056'], ['‼️', '5084772285215147326']],
  unban: [['✅', '6325687241536440125'], ['✔️', '5039844895779455925']],
  kick: [['⚡', '5042334757040423886']],
  warn: [['‼️', '5084772285215147326'], ['❗', '5040034664614462519']],
  watch: [['👀', '5039623284056917259']],
  eyes: [['👀', '5039623284056917259']],
  info: [['💭', '5904248647972820334'], ['🌐', '5042186567783809934']],
  settings: [['📁', '5805506958995758422'], ['💼', '5420405566872788904']],
  folder: [['📁', '5805506958995758422']],
  time: [['⏰', '4904882772637648609']],
  clock: [['⏰', '4904882772637648609']],
  new: [['🆕', '4918438965029110683']],
  fresh: [['🆕', '4918438965029110683'], ['✨', '5890925363067886150']],
  level: [['🔥', '5039644681583985437'], ['⭐', '5310224206732996002'], ['⭐', '5258039825805624495']],
  star: [['⭐', '5310224206732996002'], ['⭐', '5258039825805624495']],
  fire: [['🔥', '5039644681583985437']],
  medal_1: [['⭐', '5310224206732996002']],
  medal_2: [['⭐', '5258039825805624495']],
  medal_3: [['✨', '5890925363067886150']],
  game: [['🔥', '5039644681583985437'], ['⚡', '5042334757040423886']],
  play: [['⚡', '5042334757040423886'], ['✨', '5890925363067886150']],
  trophy: [['⭐', '5310224206732996002'], ['👑', '5805553606635559688']],
  user: [['👤', '5904630315946611415']],
  person: [['👤', '5904630315946611415']],
  welcome: [['👋', '5422529445380532104'], ['✨', '5890925363067886150']],
  wave: [['👋', '5422529445380532104']],
  goodbye: [['✈️', '5217890643321300022'], ['👋', '5422529445380532104']],
  travel: [['✈️', '5217890643321300022']],
  forward: [['✈️', '5217890643321300022']],
  web: [['🌐', '5042186567783809934']],
  globe: [['🌐', '5042186567783809934']],
  bookmark: [['🔖', '5039826874096681939']],
  save: [['🔖', '5039826874096681939']],
  location: [['📍', '5104989658350093220']],
  pin: [['📍', '5104989658350093220']],
  guitar: [['🎸', '5001534655082529641']],
  music: [['🎸', '5001534655082529641']],
  add: [['➕', '5039891861246838069']],
  plus: [['➕', '5039891861246838069']],
  circle: [['⭕', '5084572732444640127']],
  priority: [['⭕', '5084572732444640127']],
  heart: [['🩵', '4902715076873553054']],
  number_1: [['1⃣', '5794164805065514131']],
  sparkle: [['✨', '5890925363067886150']],
  announce: [['📣', '6097973409851906183']],
  speaker: [['🔈', '6098245027878672529']],
};

export function customEmoji(fallback, id) {
  return id ? `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>` : fallback;
}

function pick(category) {
  const list = EMOJI_MAP[category] || [['✨', '5890925363067886150']];
  return list[Math.floor(Math.random() * list.length)];
}
export function getEmoji(category) {
  const [fallback, id] = pick(category);
  return customEmoji(fallback, id);
}
export function getEmojiText(category) { return pick(category)[0]; }

// Strip every scrap of markup (used where parse_mode is unavailable).
export function plain(value) {
  return String(value ?? '')
    .replace(/<tg-emoji[^>]*>(.*?)<\/tg-emoji>/gi, '$1')
    .replace(/<a[^>]*>(.*?)<\/a>/gi, '$1')
    .replace(/<\/?(?:b|i|u|s|code|pre|strong|em|mark|span|tg-spoiler|blockquote)>/gi, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// E.* — HTML markup constants (exact same IDs as Python).
export const E = {
  CROWN: getEmoji('crown'), FIRE: getEmoji('fire'), STAR: getEmoji('star'),
  SPARKLE: getEmoji('sparkle'), HEART: getEmoji('heart'), CHECK: getEmoji('check'),
  CROSS: getEmoji('cross'), DISAPPROVE: getEmoji('disapprove'),
  LOCK: customEmoji('🔒', '5296369303661067030'),
  ADMIN: getEmoji('admin'), USER: getEmoji('user'),
  SUCCESS: getEmoji('success'), WARNING: getEmoji('warning'), ALERT: getEmoji('alert'),
  INFO: getEmoji('info'), ERROR: getEmoji('error'),
  MUTE: getEmoji('mute'), BAN: getEmoji('ban'), UNBAN: getEmoji('unban'), KICK: getEmoji('kick'), WARN: getEmoji('warn'),
  WATCH: getEmoji('watch'), EYES: getEmoji('watch'),
  TIME: getEmoji('time'), CLOCK: getEmoji('clock'), NEW: getEmoji('new'), FRESH: getEmoji('new'),
  LEVEL: getEmoji('level'), CHART: '📊',
  MEDAL_1: getEmoji('medal_1'), MEDAL_2: getEmoji('medal_2'), MEDAL_3: getEmoji('medal_3'),
  GAME: getEmoji('game'), TROPHY: getEmoji('trophy'), PLAY: getEmoji('play'),
  WELCOME: getEmoji('welcome'), WAVE: getEmoji('wave'), GOODBYE: getEmoji('goodbye'),
  TRAVEL: getEmoji('travel'), FORWARD: getEmoji('travel'),
  WEB: getEmoji('web'), GLOBE: getEmoji('web'),
  BOOKMARK: getEmoji('bookmark'), SAVE: getEmoji('bookmark'),
  LOCATION: getEmoji('location'), PIN: getEmoji('location'),
  SETTINGS: getEmoji('settings'), FOLDER: getEmoji('settings'),
  ADD: getEmoji('add'), PLUS: getEmoji('add'), CIRCLE: getEmoji('circle'),
  ANNOUNCE: getEmoji('announce'), SPEAKER: getEmoji('announce'),
  NUMBER_1: customEmoji('1⃣', '5794164805065514131'),
  GUITAR: customEmoji('🎸', '5001534655082529641'),
  BULLET: '━━━━━━━━━━━━━━', ARROW: customEmoji('✈️', '5217890643321300022'),
};

// EID.* — raw ids for icon_custom_emoji_id / Rich Message button icons.
export const EID = {
  CROWN: '5805553606635559688', FIRE: '5039644681583985437', STAR: '5310224206732996002',
  SPARKLE: '5890925363067886150', HEART: '4902715076873553054', CHECK: '6325687241536440125',
  CROSS: '5040042498634810056', DISAPPROVE: '5121063440311386962', LOCK: '5296369303661067030',
  ADMIN: '5042334757040423886', USER: '5904630315946611415',
  SUCCESS: '6325687241536440125', WARNING: '5040034664614462519', ALERT: '6097973409851906183',
  INFO: '5904248647972820334', ERROR: '5040042498634810056',
  MUTE: '6098245027878672529', BAN: '5040042498634810056', UNBAN: '6325687241536440125',
  KICK: '5042334757040423886', WARN: '5084772285215147326',
  WATCH: '5039623284056917259', EYES: '5039623284056917259',
  TIME: '4904882772637648609', CLOCK: '4904882772637648609',
  NEW: '4918438965029110683', FRESH: '4918438965029110683',
  LEVEL: '5039644681583985437', MEDAL_1: '5310224206732996002',
  MEDAL_2: '5258039825805624495', MEDAL_3: '5890925363067886150',
  GAME: '5039644681583985437', TROPHY: '5310224206732996002', PLAY: '5042334757040423886',
  WELCOME: '5422529445380532104', WAVE: '5422529445380532104', GOODBYE: '5217890643321300022',
  TRAVEL: '5217890643321300022', FORWARD: '5217890643321300022',
  WEB: '5042186567783809934', GLOBE: '5042186567783809934',
  BOOKMARK: '5039826874096681939', SAVE: '5039826874096681939',
  LOCATION: '5104989658350093220', PIN: '5104989658350093220',
  SETTINGS: '5805506958995758422', FOLDER: '5805506958995758422',
  ADD: '5039891861246838069', PLUS: '5039891861246838069', CIRCLE: '5084572732444640127',
  ANNOUNCE: '6097973409851906183', SPEAKER: '6097973409851906183',
  NUMBER_1: '5794164805065514131', GUITAR: '5001534655082529641',
};

export { EMOJI_MAP };
