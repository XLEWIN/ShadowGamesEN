// UNO engine — port of core/maumau/{card,deck,game,player}.py
// State is plain JSON so it can be persisted in bot_state across isolates.

export const RED = 'r', BLUE = 'b', GREEN = 'g', YELLOW = 'y';
export const COLORS = [RED, BLUE, GREEN, YELLOW];
export const COLOR_ICONS = { r: '🔴', b: '🔵', g: '🟢', y: '🟡', x: '⬛' };
export const COLOR_NAMES = { r: 'Red', b: 'Blue', g: 'Green', y: 'Yellow', x: 'Wild' };
export const VALUE_LABELS = {
  0: '0', 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  draw: '+2', reverse: 'Reverse', skip: 'Skip',
  colorchooser: 'Colour', draw_four: '+4',
};
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'draw', 'reverse', 'skip'];
const WILD_VALUES = ['1', '2', '3', '4', '5', 'draw', 'reverse', 'skip'];
const SPECIALS = ['colorchooser', 'draw_four'];

export function cardKey(card) { return card.special ? card.special : `${card.color}_${card.value}`; }
export function cardDisplay(card) {
  const icon = card.special ? COLOR_ICONS.x : (COLOR_ICONS[card.color] || COLOR_ICONS.x);
  return `${icon} ${VALUE_LABELS[card.special || card.value] || cardKey(card)}`;
}
export function displayColor(color) { return `${COLOR_ICONS[color] || ''} ${COLOR_NAMES[color] || color}`; }

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export function buildDeck(mode = 'fast') {
  const cards = [];
  const values = mode === 'wild' ? WILD_VALUES : VALUES;
  for (const color of COLORS) {
    for (const value of values) {
      const copies = mode === 'wild' ? 4 : (value === '0' ? 1 : 2);
      for (let i = 0; i < copies; i++) cards.push({ color, value, special: null });
    }
  }
  const specialCopies = mode === 'wild' ? 6 : 4;
  for (const special of SPECIALS) {
    for (let i = 0; i < specialCopies; i++) cards.push({ color: null, value: null, special });
  }
  return shuffle(cards);
}

export function newGame(chat, mode = 'fast') {
  return {
    chat: { id: chat.id, title: chat.title || 'Group' },
    mode,
    started: false,
    open: true,
    owner: [],
    players: [],             // [{userId, name, username, cards:[], drew:false}]
    current: 0,              // index into players (ring)
    reversed: false,
    choosingColor: false,
    drawCounter: 0,
    deck: [],
    graveyard: [],
    lastCard: null,
    lastCardOwner: null,
    lastMessageId: null,
    starter: null,
  };
}

function drawCard(g) {
  if (!g.deck.length) {
    if (!g.graveyard.length) throw new Error('Deck empty');
    g.deck = shuffle(g.graveyard.splice(0));
  }
  return g.deck.pop();
}
function dismiss(g, card) {
  if (card.special) card.color = null;
  g.graveyard.push(card);
}

export function addPlayer(g, user) {
  if (g.players.some(p => p.userId === user.id)) return false;
  g.players.push({ userId: user.id, name: user.first_name || 'Player', username: user.username || null, cards: [], drew: false, antiCheat: 0 });
  return true;
}

export function startGame(g) {
  g.deck = buildDeck(g.mode);
  g.graveyard = [];
  for (const p of g.players) {
    p.cards = [];
    for (let i = 0; i < 7; i++) p.cards.push(drawCard(g));
    p.drew = false;
  }
  g.current = 0;
  g.reversed = false;
  g.choosingColor = false;
  g.drawCounter = 0;
  // First card must not be special
  do {
    g.lastCard = drawCard(g);
    if (g.lastCard.special) dismiss(g, g.lastCard);
  } while (g.lastCard.special);
  applyCard(g, g.lastCard);
  g.started = true;
  return g;
}

function nextIndex(g, from = g.current) {
  const n = g.players.length;
  if (!n) return 0;
  return g.reversed ? (from - 1 + n) % n : (from + 1) % n;
}
function turn(g) {
  g.current = nextIndex(g);
  g.players[g.current].drew = false;
  g.choosingColor = false;
}

function applyCard(g, card) {
  g.lastCard = card;
  if (card.special === 'colorchooser' || card.special === 'draw_four') {
    if (card.special === 'draw_four') g.drawCounter += 4;
    g.choosingColor = true;
    return;
  }
  let turns = 1;
  if (card.value === 'skip') turns = 2; // skip always advances twice
  else if (card.value === 'reverse') {
    if (g.players.length === 2) turns = 2; // 2-player reverse acts as skip
    else g.reversed = !g.reversed;
  } else if (card.value === 'draw') g.drawCounter += 2;
  for (let i = 0; i < turns; i++) turn(g);
}

export function advanceTurn(g) { turn(g); }

// Draw without the turn check — used by +4 bluff resolution.
export function forceDraw(g, userId, n = 1) {
  const p = g.players.find(p => p.userId === userId);
  if (!p) return null;
  for (let i = 0; i < n; i++) p.cards.push(drawCard(g));
  return p;
}

export function chooseColor(g, color) {
  if (!g.choosingColor || !COLORS.includes(color)) return false;
  g.lastCard.color = color;
  g.choosingColor = false;
  turn(g);
  return true;
}

export function playableCards(g, player) {
  const last = g.lastCard;
  const cards = player.drew ? player.cards.slice(-1) : player.cards;
  if (player.cards.length === 1 && player.cards[0].special) return [];
  return cards.filter(card => {
    if (card.special) {
      if (last.value === 'draw' && g.drawCounter && card.special !== 'draw_four') return false;
      if (last.special === 'draw_four' && g.drawCounter) return false;
      if (last.special && card.special) return false;
      if (card.special === 'draw_four' && COLORS.includes(last.color)) return false; // no bluff on +4
      return true;
    }
    if (card.color !== last.color && card.value !== last.value) return false;
    if (last.value === 'draw' && card.value !== 'draw' && g.drawCounter) return false;
    if (last.special === 'draw_four' && g.drawCounter) return false;
    if (!last.color) return false;
    return true;
  });
}

export function playCard(g, userId, key) {
  const p = g.players.find(p => p.userId === userId);
  if (!p || g.players[g.current].userId !== userId) return { ok: false, reason: 'Not your turn' };
  const idx = p.cards.findIndex(c => cardKey(c) === key);
  if (idx === -1) return { ok: false, reason: 'You do not have that card' };
  const card = p.cards[idx];
  if (!playableCards(g, p).some(c => cardKey(c) === key)) return { ok: false, reason: 'That card is not playable' };
  p.cards.splice(idx, 1);
  dismiss(g, g.lastCard);
  g.lastCardOwner = userId;
  applyCard(g, card);
  return { ok: true, card, finished: p.cards.length === 0, player: p };
}

export function draw(g, userId) {
  const p = g.players.find(p => p.userId === userId);
  if (!p || g.players[g.current].userId !== userId) return { ok: false, reason: 'Not your turn' };
  const amount = g.drawCounter || 1;
  for (let i = 0; i < amount; i++) p.cards.push(drawCard(g));
  g.drawCounter = 0;
  p.drew = true;
  return { ok: true, amount, player: p };
}

export function removePlayer(g, userId) {
  const idx = g.players.findIndex(p => p.userId === userId);
  if (idx === -1) return false;
  const [p] = g.players.splice(idx, 1);
  for (const card of p.cards) dismiss(g, card);
  if (!g.players.length) return true;
  if (g.current >= g.players.length) g.current = 0;
  return true;
}

export function countScore(cards) {
  let score = 0;
  for (const c of cards) {
    if (c.special) score += 50;
    else if (['skip', 'reverse', 'draw'].includes(c.value)) score += 20;
    else score += Number(c.value);
  }
  return score;
}
