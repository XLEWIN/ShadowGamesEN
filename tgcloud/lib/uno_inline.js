// UNO inline gameplay — sticker cards in the inline bar + chosen-result actions.
// Port of maumau_inline.py / maumau_actions.py (nonce + switch_inline protocol).

import { api } from 'sdk';
import { getState, setState, deleteState } from './db.js';
import { E } from './emojis.js';
import { mention } from './texts.js';
import { unoChoiceKeyboard } from './keyboards.js';
import { STICKERS, STICKERS_GREY, STICKERS_OPTIONS } from './uno_stickers.js';
import {
  cardKey, cardDisplay, displayColor, playableCards, playCard, draw,
  chooseColor, advanceTurn, forceDraw, countScore, COLORS,
} from './uno.js';

const gameKey = (chatId) => `uno:${chatId}`;
const userKey = (uid) => `uno:user:${uid}`;

export async function loadForUser(uid) {
  const cid = await getState(userKey(uid));
  if (!cid) return null;
  const game = await getState(gameKey(cid));
  return game ? { chatId: cid, game } : null;
}

export async function saveGame(chatId, g) {
  await setState(gameKey(chatId), g);
  for (const p of g.players) await setState(userKey(p.userId), String(chatId));
}

export async function clearGame(chatId, g) {
  await deleteState(gameKey(chatId));
  for (const p of g.players) await deleteState(userKey(p.userId));
}

export const removeUserMapping = (uid) => deleteState(userKey(uid));

const article = (id, title, description, messageText) => ({
  type: 'article', id, title, description,
  input_message_content: { message_text: messageText, parse_mode: 'HTML' },
});
const sticker = (id, fileId, messageText) => ({
  type: 'sticker', id, sticker_file_id: fileId,
  ...(messageText ? { input_message_content: { message_text: messageText } } : {}),
});

const HUB_URL = 'https://xlewin.github.io/ShadowGamesEN/webapp/';
const LUDO_URL = 'https://xlewin.github.io/ShadowGamesEN/webapp/ludo/';
const CHESS_URL = 'https://xlewin.github.io/ShadowGamesEN/webapp/chess/';
function hubArticles() {
  const game = (id, title, desc, url, label) => ({
    ...article(id, title, desc, `${title} — @ShadowGameEnBot`),
    thumbnail_url: `${url}assets/icon.webp`,
    reply_markup: { inline_keyboard: [[{ text: label, url }]] },
  });
  return [
    game('hub', '🎮 Shadow Games', 'All games in one place', HUB_URL, '🎮 Open Games Hub'),
    game('open-ludo', '🎲 Shadow Games · Ludo', 'Play vs AI or online rooms', LUDO_URL, '🎲 Open Ludo'),
    game('open-chess', '♟️ Shadow Games · Chess', 'Real rules, online rooms', CHESS_URL, '♟️ Open Chess'),
  ];
}

// Async because game state lives in the DB.
export async function makeInlineResults(uid, queryText = '') {
  const text = (queryText || '').trim().toLowerCase();
  const found = uid ? await loadForUser(uid) : null;
  const results = [];
  let switchText = null;

  const g = found?.game;
  const player = g?.players.find(p => p.userId === uid);
  const nonce = player ? String(player.antiCheat) : null;
  const tag = (id) => `${id}:${nonce}`;

  if (!g || !player) {
    results.push(article('nogame', 'You are not playing',
      'Start with /newuno or join with /join',
      'Not playing right now. Use /newuno to start a game or /join to join one.'));
  } else if (!g.started) {
    if (g.owner.includes(uid)) {
      for (const [mode, title, desc] of [
        ['classic', '🎻 Classic mode', 'Conventional deck, no auto-skip'],
        ['fast', '🚀 Fast mode', 'Auto-skip players who take too long'],
        ['wild', '🐉 Wild mode', 'More special cards, no auto-skip'],
      ]) results.push(article(`mode_${mode}`, title, desc, `Gamemode changed to ${mode}.`));
    } else {
      results.push(article('notstarted', "The game wasn't started yet",
        'Start with /startuno', "The game hasn't started yet."));
    }
  } else {
    const isTurn = g.players[g.current]?.userId === uid;
    if (isTurn && g.choosingColor) {
      for (const color of COLORS) {
        results.push(article(tag(color), 'Choose Colour', displayColor(color), displayColor(color)));
      }
    }

    if (isTurn && !g.choosingColor) {
      const n = g.drawCounter || 1;
      const drawS = STICKERS_OPTIONS.option_draw;
      results.push(drawS
        ? sticker(tag('draw'), drawS, n === 1 ? 'Drawing 1 card' : `Drawing ${n} cards`)
        : article(tag('draw'), '🎴 Draw', n === 1 ? 'Drawing 1 card' : `Drawing ${n} cards`, `Drawing ${n} card(s)`));
      const passS = STICKERS_OPTIONS.option_pass;
      results.push(passS
        ? sticker(tag('pass'), passS, 'Pass.')
        : article(tag('pass'), 'Pass', 'Skip your turn without drawing', 'Pass.'));
      if (g.choosingColor || (g.lastCard?.special === 'draw_four' && g.drawCounter)) {
        const bluffS = STICKERS_OPTIONS.option_bluff;
        results.push(bluffS
          ? sticker(tag('call_bluff'), bluffS, "I'm calling your bluff!")
          : article(tag('call_bluff'), 'Call Bluff!', 'Challenge the +4', "I'm calling your bluff!"));
      }
    }

    if (!g.choosingColor) {
      const playable = new Set(playableCards(g, player).map(cardKey));
      const added = new Set();
      player.cards.slice().sort((a, b) => String(cardKey(a)).localeCompare(String(cardKey(b))))
        .forEach((card, i) => {
          const key = cardKey(card);
          const canPlay = isTurn && playable.has(key) && !added.has(key);
          added.add(key);
          const fileId = canPlay ? STICKERS[key] : STICKERS_GREY[key];
          if (fileId) {
            results.push(canPlay
              ? sticker(tag(key), fileId)
              : sticker(tag(`grey_${key}_${i}`), fileId, `${cardDisplay(card)} — not playable right now`));
          } else {
            results.push(article(tag(canPlay ? key : `grey_${key}_${i}`),
              cardDisplay(card), canPlay ? 'Play this card' : 'Not playable right now', cardDisplay(card)));
          }
        });
    }

    // Game-info tap target — never burns the nonce.
    results.push(article(tag('gameinfo'), 'Game Info',
      `Current player: ${g.players[g.current]?.name || '?'} · Cards: ${player.cards.length}`,
      `${E.USER} Current player: <b>${g.players[g.current]?.name || '?'}</b>\n${E.WATCH} Last card: ${cardDisplay(g.lastCard)}\n👥 Players: ${g.players.length}`));
    if (g.players.length > 1) switchText = `Current game: ${g.chat.title}`;
  }

  if (!text) results.push(...hubArticles());

  return { results, switchText };
}

export async function answerInlineQuery(query) {
  const { results, switchText } = await makeInlineResults(query.from?.id, query.query);
  await api.answerInlineQuery({
    inline_query_id: query.id,
    results,
    is_personal: true,
    cache_time: 0,
    ...(switchText ? { button: { text: switchText, start_parameter: 'select' } } : {}),
  });
}

async function announce(chatId, text, markup) {
  try {
    await api.sendMessage({
      chat_id: chatId, text, parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(markup ? { reply_markup: markup } : {}),
    });
  } catch (e) { /* group may have deleted the chat */ }
}

export async function processChosenResult(chosen) {
  const uid = chosen.from?.id;
  const raw = chosen.result_id || '';
  const found = uid ? await loadForUser(uid) : null;
  if (!found) return;
  const g = found.game;
  const chatId = found.chatId;
  const player = g.players.find(p => p.userId === uid);
  if (!player) return;

  const parts = raw.lastIndexOf(':') > -1
    ? [raw.slice(0, raw.lastIndexOf(':')), raw.slice(raw.lastIndexOf(':') + 1)]
    : [raw, null];
  let [action, nonce] = parts;
  if (nonce === null) return; // game-hub articles etc. — not UNO actions

  // View-only results must not burn the nonce.
  if (action === 'hand' || action === 'gameinfo' || action === 'nogame' ||
      action === 'notstarted' || action.startsWith('grey_')) return;

  if (action.startsWith('mode_')) {
    g.mode = action.slice(5);
    await saveGame(chatId, g);
    await announce(chatId, `${E.SETTINGS} Gamemode changed to <b>${g.mode}</b>.`);
    return;
  }

  if (nonce !== String(player.antiCheat)) {
    await announce(chatId, `${E.CROSS} Cheat attempt by <b>${player.name}</b>! (stale inline results)`);
    return;
  }
  player.antiCheat++;

  try {
    if (action === 'draw') {
      draw(g, uid);
    } else if (action === 'pass') {
      advanceTurn(g);
    } else if (COLORS.includes(action)) {
      chooseColor(g, action);
    } else if (action === 'call_bluff') {
      const prev = g.players.find(p => p.userId === g.lastCardOwner);
      const bluffing = !!(prev && !player.cards.some(c => c.color === g.lastCard?.color));
      if (bluffing) {
        forceDraw(g, prev.userId, 4);
        await announce(chatId, `${E.ALERT} Bluff called! Giving 4 cards to <b>${prev.name}</b>.`);
      } else {
        forceDraw(g, player.userId, 6);
        await announce(chatId, `${E.CROSS} <b>${prev?.name || 'Opponent'}</b> didn't bluff! Giving 6 cards to <b>${player.name}</b>.`);
      }
      advanceTurn(g);
      g.choosingColor = false;
      g.drawCounter = 0;
      g.lastCardOwner = null;
    } else {
      playCard(g, uid, action);
    }
  } catch (e) {
    await announce(chatId, `${E.ERROR} Could not complete that action. Please try again.`);
    return;
  }

  // playCard already removed the card; detect the winner explicitly:
  const winner = g.players.find(p => p.cards.length === 0);

  const stats = await getState(`unostats:${uid}`) || { games: 0, wins: 0, cards: 0 };
  if (action !== 'draw' && action !== 'pass' && !COLORS.includes(action) && action !== 'call_bluff') stats.cards++;
  await setState(`unostats:${uid}`, stats);

  if (winner) {
    stats.wins++;
    stats.games++;
    await setState(`unostats:${uid}`, stats);
    const score = g.players.filter(p => p.userId !== winner.userId).reduce((s, p) => s + countScore(p.cards), 0);
    await announce(chatId, `<blockquote>${E.SUCCESS} ${mention(winner.userId, winner.name)} won UNO! +${score} Xeons</blockquote>`);
    await clearGame(chatId, g);
    return;
  }

  await saveGame(chatId, g);
  const next = g.players[g.current];
  if (next) {
    await announce(chatId,
      `${E.ARROW} Next player: <b>${next.name}</b>`,
      unoChoiceKeyboard());
  }
}
