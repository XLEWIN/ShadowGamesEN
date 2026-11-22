// UNO commands — port of maumau_commands.py.
// Hands are NEVER sent as emoji text: cards live in the inline sticker bar.
import { api } from 'sdk';
import { getState, setState } from './db.js';
import { replyText, escapeHtml } from './msg.js';
import { E, plain } from './emojis.js';
import { mention } from './texts.js';
import {
  btnPrimary, btnSuccess, btnSwitchInline, buildKeyboard, unoChoiceKeyboard,
} from './keyboards.js';
import {
  newGame, addPlayer, startGame, playCard, draw, chooseColor, removePlayer,
  cardDisplay, displayColor,
} from './uno.js';
import { saveGame, clearGame, removeUserMapping } from './uno_inline.js';

const load = (chatId) => getState(`uno:${chatId}`);

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
      await saveGame(cid, g);
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
      await saveGame(cid, g);
      return reply(`${E.SUCCESS} ${mention(user.id, name)} joined! Players: ${g.players.length}`, { parseMode: 'HTML' });
    }
    case 'startuno': {
      if (isPrivate) return reply(`${E.INFO} Use /startuno in the game group.`);
      const g = await load(cid);
      if (!g) return reply(`${E.INFO} No UNO game in this chat.`);
      if (g.started) return reply(`${E.WARNING} The game is already running.`);
      if (g.players.length < 2) return reply(`${E.WARNING} Need at least 2 players. Use /join first.`);
      startGame(g);
      await saveGame(cid, g);
      const p = g.players[g.current];
      await reply(
        `<blockquote>${E.GAME} <b>UNO started!</b></blockquote>\n\n` +
        `${E.INFO} Top card: <b>${cardDisplay(g.lastCard)}</b>\n\n` +
        `${mention(p.userId, p.name)} — it's your turn! Tap below to see your cards.`,
        { parseMode: 'HTML', replyMarkup: unoChoiceKeyboard() });
      return;
    }
    case 'show': case 'hand': {
      const found = await (async () => {
        const id = await getState(`uno:user:${user.id}`);
        return id ? { cid: id, g: await load(id) } : null;
      })();
      if (!found?.g) return reply(`${E.INFO} You are not in an active UNO game. Use /newuno in a group.`);
      const p = found.g.players.find(p => p.userId === user.id);
      if (!p) return reply(`${E.WARNING} You are not in this game.`);
      return reply(
        `${E.FOLDER} <b>${escapeHtml(p.name)}, your cards are sticker tiles.</b>\n` +
        `${E.INFO} Tap the button below, then pick a card from the inline menu.\n` +
        `${E.WATCH} Top card: <b>${cardDisplay(found.g.lastCard)}</b>`,
        { parseMode: 'HTML', replyMarkup: unoChoiceKeyboard() });
    }
    case 'skip': {
      if (isPrivate) return reply(`${E.INFO} Use /skip in the game group.`);
      const g = await load(cid);
      if (!g?.started) return reply(`${E.INFO} No running game.`);
      if (g.players[g.current].userId !== user.id) return reply(`${E.WARNING} It's not your turn.`);
      const res = draw(g, user.id);
      await saveGame(cid, g);
      return reply(`${E.INFO} ${mention(user.id, name)} drew ${res.amount} card(s).`, { parseMode: 'HTML' });
    }
    case 'kill': {
      if (isPrivate) return reply(`${E.INFO} Use /kill in the game group.`);
      const g = await load(cid);
      if (!g) return reply(`${E.INFO} No UNO game in this chat.`);
      if (!g.owner.includes(user.id)) return reply(`${E.LOCK} Only the game creator can kill it.`);
      await clearGame(cid, g);
      return reply(`${E.SUCCESS} UNO game ended. Use /newuno to play again.`);
    }
    case 'leave': {
      const foundId = await getState(`uno:user:${user.id}`);
      const g = await load(foundId || cid);
      if (!g) return reply(`${E.INFO} No UNO game in this chat.`);
      if (!removePlayer(g, user.id)) return reply(`${E.WARNING} You are not in this game.`);
      await removeUserMapping(user.id);
      await saveGame(foundId || cid, g);
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
    await saveGame(cid, g);
    await answer(query, 'Joined!');
    return true;
  }
  if (action === 'start') {
    if (g.started || g.players.length < 2) { await answer(query, 'Need 2+ players.'); return true; }
    startGame(g);
    await saveGame(cid, g);
    const p = g.players[g.current];
    try {
      await api.sendMessage({
        chat_id: chat.id,
        text: `${E.GAME} <b>UNO started!</b>\nTop card: <b>${cardDisplay(g.lastCard)}</b>\n${mention(p.userId, p.name)} — it's your turn!`,
        parse_mode: 'HTML', reply_markup: unoChoiceKeyboard(),
      });
    } catch (e) { /* ignore */ }
    await answer(query, 'UNO started!');
    return true;
  }
  if (action.startsWith('hand:')) {
    const pl = g.players.find(p => p.userId === Number(action.slice(5)));
    if (!pl) { await answer(query, 'Not in game.'); return true; }
    try {
      await api.sendMessage({
        chat_id: user.id,
        text: `${E.FOLDER} <b>Your cards are sticker tiles.</b> Tap below to open the inline menu.`,
        parse_mode: 'HTML', reply_markup: unoChoiceKeyboard(),
      });
      await answer(query, 'Check your DM!');
    } catch (e) {
      await answer(query, 'Start the bot in DM first.');
    }
    return true;
  }
  await answer(query, 'Use the “Make your choice!” button to play with sticker cards.');
  return true;
}

async function answer(query, text) {
  try { await api.answerCallbackQuery({ callback_query_id: query.id, text: plain(text) }); } catch (e) { /* ignore */ }
}
