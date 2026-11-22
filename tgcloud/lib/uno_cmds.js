// UNO commands + inline card renderers — port of maumau_commands.py / maumau_inline.py
import { api } from 'sdk';
import { getState, setState, deleteState } from './db.js';
import { replyText, escapeHtml } from './msg.js';
import { E, plain } from './emojis.js';
import { mention } from './texts.js';
import { btnPrimary, btnDanger, btnDefault, btnSuccess, buildKeyboard } from './keyboards.js';
import { cardKey, cardDisplay, displayColor, newGame, addPlayer, startGame, playableCards, playCard, draw, chooseColor, removePlayer, countScore, COLORS } from './uno.js';

const key = (chatId) => `uno:${chatId}`;
const load = (chatId) => getState(key(chatId));
const save = (chatId, g) => setState(key(chatId), g);

export async function handleUnoCommand(command, args, message, ctx) {
  const chat = message.chat;
  const user = message.from;
  if (!chat || !user) return;
  const isPrivate = chat.type === 'private';
  const cid = String(chat.id);
  const name = user.first_name || 'Player';
  const argParts = (args || '').trim().split(/\s+/).filter(Boolean);
  const reply = (text, markup) => ctx.reply(text, markup);

  switch (command) {
    case 'newuno': {
      if (isPrivate) return reply(`${E.INFO} Add me to a group, then use /newuno there.`);
      if (await load(cid)) return reply(`${E.WARNING} There is already an UNO game in this chat. Use /kill to end it.`);
      const mode = argParts[0] === 'wild' ? 'wild' : (argParts[0] === 'classic' ? 'classic' : 'fast');
      const g = newGame(chat, mode);
      addPlayer(g, user);
      g.owner = [user.id];
      await save(cid, g);
      return reply(
        `<blockquote>${E.GAME} <b>UNO game created!</b></blockquote>\n\n${mention(user.id, name)} started a <b>${mode}</b> game.\n\n${E.INFO} Players: /join — Deal: /startuno (min 2 players)`,
        { parseMode: 'HTML', replyMarkup: buildKeyboard([
          [btnPrimary('Join Game', 'mm:join', E.ADD), btnSuccess('Deal Cards', 'mm:start', E.PLAY)],
        ]) });
    }
    case 'join': {
      if (isPrivate) return reply(`${E.INFO} Use /join inside the group.`);
      const g = await load(cid);
      if (!g) return reply(`${E.INFO} There is no UNO game in this chat. Use /newuno to create one.`);
      if (g.started) return reply(`${E.WARNING} The game already started. Wait for the next round.`);
      if (!addPlayer(g, user)) return reply(`${E.WARNING} You are already in the game.`);
      await save(cid, g);
      return reply(`${E.SUCCESS} ${mention(user.id, name)} joined! Players: ${g.players.length}`, { parseMode: 'HTML' });
    }
    case 'startuno': {
      if (isPrivate) return reply(`${E.INFO} Use /startuno in the game group.`);
      const g = await load(cid);
      if (!g) return reply(`${E.INFO} No UNO game in this chat.`);
      if (g.started) return reply(`${E.WARNING} The game is already running.`);
      if (g.players.length < 2) return reply(`${E.WARNING} Need at least 2 players. Use /join first.`);
      startGame(g);
      g.lastMessageId = null;
      await save(cid, g);
      const p = g.players[g.current];
      const hand = renderHand(g, p);
      const sent = await ctx.replyMessage(
        `<blockquote>${E.GAME} <b>UNO started!</b></blockquote>\n\n` +
        `${E.INFO} Top card: <b>${cardDisplay(g.lastCard)}</b>\n\n` +
        `${mention(p.userId, p.name)} — your turn! Cards below.`,
        { parseMode: 'HTML', replyMarkup: buildKeyboard([[btnDefault('Show My Cards', `mm:hand:${p.userId}`, E.FOLDER)]]) });
      if (sent?.message_id) { g.lastMessageId = sent.message_id; await save(cid, g); }
      // Send hands privately
      for (const pl of g.players) {
        try { await api.sendMessage({ chat_id: pl.userId, text: renderHand(g, pl), parse_mode: 'HTML' }); } catch (e) { /* DM closed */ }
      }
      return;
    }
    case 'show': case 'hand': {
      const g = await load(cid);
      if (!g) return reply(`${E.INFO} No UNO game in this chat.`);
      const p = g.players.find(p => p.userId === user.id);
      if (!p) return reply(`${E.WARNING} You are not in this game.`);
      return reply(renderHand(g, p), { parseMode: 'HTML' });
    }
    case 'skip': {
      if (isPrivate) return reply(`${E.INFO} Use /skip in the game group.`);
      const g = await load(cid);
      if (!g?.started) return reply(`${E.INFO} No running game.`);
      if (g.players[g.current].userId !== user.id) return reply(`${E.WARNING} It's not your turn.`);
      const res = draw(g, user.id);
      await save(cid, g);
      return reply(`${E.INFO} ${mention(user.id, name)} drew ${res.amount} card(s).`, { parseMode: 'HTML' });
    }
    case 'kill': {
      if (isPrivate) return reply(`${E.INFO} Use /kill in the game group.`);
      const g = await load(cid);
      if (!g) return reply(`${E.INFO} No UNO game in this chat.`);
      if (!g.owner.includes(user.id)) return reply(`${E.LOCK} Only the game creator can kill it.`);
      await deleteState(key(cid));
      return reply(`${E.SUCCESS} UNO game ended. Use /newuno to play again.`);
    }
    case 'leave': {
      const g = await load(cid);
      if (!g) return reply(`${E.INFO} No UNO game in this chat.`);
      if (!removePlayer(g, user.id)) return reply(`${E.WARNING} You are not in this game.`);
      await save(cid, g);
      return reply(`${E.INFO} ${mention(user.id, name)} left the game.`, { parseMode: 'HTML' });
    }
    case 'modes':
      return reply(`${E.INFO} <b>UNO modes</b>\n${E.BULLET}\n\n<b>fast</b> (default) · <b>classic</b> · <b>wild</b>\nUse /newuno [mode] to create a game.`);
    case 'unostats': {
      const rows = await getState(`unostats:${user.id}`) || { games: 0, wins: 0, cards: 0 };
      return reply(`${E.TROPHY} <b>Your UNO stats</b>\n${E.BULLET}\n\n🎮 Games: ${rows.games}\n🏆 Wins: ${rows.wins}\n🃏 Cards played: ${rows.cards}`);
    }
    case 'open': case 'close': case 'kick': case 'notifyme':
      return reply(`${E.INFO} Use the inline UNO buttons to manage the game.`);
    default: return null;
  }
}

function renderHand(g, player) {
  const playable = g.started ? new Set(playableCards(g, player).map(cardKey)) : new Set();
  let html = `${E.FOLDER} <b>Your cards (${player.cards.length})</b>\n${E.BULLET}\n\n`;
  for (const card of player.cards) {
    const k = cardKey(card);
    const mark = playable.has(k) ? '✅ ' : '';
    html += `${mark}<code>${escapeHtml(cardDisplay(card))}</code>\n`;
  }
  if (g.choosingColor) html += `\n${E.WARNING} Choose a colour!`;
  return html;
}

export async function handleUnoCallback(query, ctx) {
  const data = query.data || '';
  if (!data.startsWith('mm:')) return false;
  const chat = query.message?.chat;
  const user = query.from;
  if (!chat || !user) return true;
  const cid = String(chat.id);
  const g = await load(cid);
  if (!g) { await answer(query, 'No UNO game in this chat.'); return true; }
  const action = data.slice(3);

  if (action === 'join') {
    if (!addPlayer(g, user)) { await answer(query, 'Already in the game.'); return true; }
    await save(cid, g);
    await answer(query, 'Joined!');
    return true;
  }
  if (action === 'start') {
    if (g.started || g.players.length < 2) { await answer(query, 'Need 2+ players.'); return true; }
    startGame(g);
    await save(cid, g);
    await answer(query, 'UNO started!');
    return true;
  }
  if (action.startsWith('hand:')) {
    const pl = g.players.find(p => p.userId === Number(action.slice(5)));
    if (!pl) { await answer(query, 'Not in game.'); return true; }
    try { await api.sendMessage({ chat_id: user.id, text: renderHand(g, pl), parse_mode: 'HTML' }); await answer(query, 'Check your DM!'); }
    catch (e) { await answer(query, 'Start the bot in DM first.'); }
    return true;
  }
  if (action.startsWith('play:')) {
    const keyCard = action.slice(5);
    const res = playCard(g, user.id, keyCard);
    if (!res.ok) { await answer(query, res.reason); return true; }
    await save(cid, g);
    const p = res.player;
    const stats = await getState(`unostats:${user.id}`) || { games: 0, wins: 0, cards: 0 };
    stats.cards++;
    if (res.finished) {
      stats.wins++;
      const score = g.players.filter(pl => pl.userId !== user.id)
        .reduce((s, pl) => s + countScore(pl.cards), 0);
      await api.sendMessage({ chat_id: chat.id, text: `<blockquote>${E.SUCCESS} ${mention(user.id, p.name)} won UNO! +${score} Xeons</blockquote>`, parse_mode: 'HTML' });
      await deleteState(key(cid));
    } else {
      await api.sendMessage({ chat_id: chat.id, text: `${E.INFO} ${mention(user.id, p.name)} played <b>${cardDisplay(res.card)}</b>`, parse_mode: 'HTML' });
    }
    await setState(`unostats:${user.id}`, stats);
    await answer(query, 'Card played!');
    return true;
  }
  if (action === 'draw') {
    const res = draw(g, user.id);
    if (!res.ok) { await answer(query, res.reason); return true; }
    await save(cid, g);
    await api.sendMessage({ chat_id: chat.id, text: `${E.INFO} ${mention(user.id, user.first_name || 'Player')} drew ${res.amount} card(s).`, parse_mode: 'HTML' });
    await answer(query, `You drew ${res.amount} card(s)`);
    return true;
  }
  if (action.startsWith('color:')) {
    const color = action.slice(6);
    if (!chooseColor(g, color)) { await answer(query, 'Not choosing a colour.'); return true; }
    await save(cid, g);
    await answer(query, `Colour: ${displayColor(color)}`);
    return true;
  }
  return true;
}

async function answer(query, text) {
  try { await api.answerCallbackQuery({ callback_query_id: query.id, text: plain(text) }); } catch (e) { /* ignore */ }
}
