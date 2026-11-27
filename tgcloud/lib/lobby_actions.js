// Callback actions for webapp lobby invites (join / spectate / open).
import { api } from 'sdk';
import { sendText, editText, editCaption, escapeHtml } from './msg.js';
import { E, plain } from './emojis.js';
import { gameBoardUrl } from './texts.js';
import { btnUrl, buildKeyboard } from './keyboards.js';
import {
  getLobby, getOpenLobby, createLobby, joinLobby, addSpectator,
  saveLobby, inviteText, lobbyKeyboard, startAppLink, isFull,
} from './lobby.js';

async function answer(query, text, alert = false) {
  try {
    await api.answerCallbackQuery({
      callback_query_id: query.id,
      ...(text ? { text: plain(text) } : {}),
      ...(alert ? { show_alert: true } : {}),
    });
  } catch (e) { /* ignore */ }
}

function openKeyboard(lobby, spectate = false) {
  return buildKeyboard([
    [btnUrl(
      spectate ? 'Watch the table' : 'Open table',
      startAppLink(lobby.game, lobby.code, spectate), undefined, 'primary',
    )],
    [btnUrl(`Open ${lobby.game.toUpperCase()} board`, gameBoardUrl(lobby.game), undefined, 'primary')],
  ]);
}

export async function handleLobbyCallback(query) {
  const data = query.data || '';
  if (!data.startsWith('lobby:')) return false;
  const [type, arg] = data.slice(6).split(':');
  const user = query.from;
  const chat = query.message?.chat;
  if (!user) { await answer(query, 'No user'); return true; }

  if (type === 'quick') {
    if (!chat || chat.type === 'private') {
      await answer(query, `${E.WARNING} Use this button in a group.`, true);
      return true;
    }
    const game = arg === 'ludo' ? 'ludo' : 'chess';
    const existing = await getOpenLobby(chat.id, game);
    const lobby = existing || await createLobby({
      game, creatorId: user.id, creatorName: user.first_name || 'Player',
      chatId: chat.id,
    });
    if (type === 'quickspect') {
      addSpectator(lobby, user);
      await saveLobby(lobby);
      try {
        await sendText(user.id,
          `${E.WATCH} You are spectating the <b>${game.toUpperCase()}</b> table <code>${escapeHtml(lobby.code)}</code>.`,
          { parseMode: 'HTML', replyMarkup: openKeyboard(lobby, true) });
        await answer(query, `${E.SUCCESS} Opening the spectator view in your DM.`);
      } catch (e) {
        await answer(query, `${E.INFO} Start the bot in DM first.`, true);
      }
      return true;
    }
    await joinAndNotify(query, lobby, user, chat);
    return true;
  }

  const lobby = await getLobby(arg);
  if (!lobby) { await answer(query, `${E.WARNING} This table has already ended.`, true); return true; }

  if (type === 'join') {
    await joinAndNotify(query, lobby, user, chat);
    return true;
  }
  if (type === 'spectate') {
    addSpectator(lobby, user);
    await saveLobby(lobby);
    try {
      await sendText(user.id,
        `${E.WATCH} You are spectating the <b>${lobby.game.toUpperCase()}</b> table <code>${escapeHtml(lobby.code)}</code>.`,
        { parseMode: 'HTML', replyMarkup: openKeyboard(lobby, true) });
      await answer(query, `${E.SUCCESS} Opening the spectator view in your DM.`);
    } catch (e) {
      await answer(query, `${E.INFO} Start the bot in a private chat first, then tap Spectate again.`, true);
    }
    return true;
  }
  if (type === 'open') {
    try {
      await sendText(user.id, `${E.GAME} <b>${lobby.game.toUpperCase()}</b> table <code>${escapeHtml(lobby.code)}</code>`, {
        parseMode: 'HTML', replyMarkup: openKeyboard(lobby),
      });
      await answer(query, `${E.SUCCESS} Check your DM!`);
    } catch (e) {
      await answer(query, `${E.INFO} Start the bot in a private chat first.`, true);
    }
    return true;
  }
  await answer(query, 'Unknown table action.');
  return true;
}

async function joinAndNotify(query, lobby, user, chat) {
  const result = joinLobby(lobby, user);
  if (result.already) {
    await answer(query, `${E.INFO} You are already in this table.`);
  } else if (result.full) {
    await answer(query, `${E.WARNING} This table is full. You can still spectate!`, true);
  } else {
    await saveLobby(lobby);
    await answer(query, `${E.SUCCESS} Joined! ${lobby.players.length}/${lobby.maxPlayers} players.`);
  }

  // Update the posted invite so everyone sees the live roster.
  if (chat && lobby.messageId) {
    try {
      // Invites are posted as board photos now — edit the caption, not text.
      await editCaption(chat.id, lobby.messageId, inviteText(lobby, lobby.players[0]?.name || 'Player', lobby.players[0]?.userId || 0), {
        parseMode: 'HTML', replyMarkup: lobbyKeyboard(lobby),
      });
    } catch (e) { /* message may be gone */ }
  } else if (chat && !lobby.messageId) {
    try {
      await sendText(chat.id,
        `${E.SUCCESS} ${escapeHtml(user.first_name || 'Player')} joined the <b>${lobby.game.toUpperCase()}</b> table · ${lobby.players.length}/${lobby.maxPlayers}\n` +
        `<a href="${gameBoardUrl(lobby.game)}">Open ${lobby.game.toUpperCase()} board</a>`,
        { parseMode: 'HTML', replyMarkup: lobbyKeyboard(lobby) });
    } catch (e) { /* ignore */ }
  }

  // Give the player a direct way into the room.
  try {
    await sendText(user.id,
      `${E.GAME} <b>${lobby.game.toUpperCase()}</b> table <code>${escapeHtml(lobby.code)}</code>\n` +
      `${E.INFO} ${lobby.players.length}/${lobby.maxPlayers} players · ${isFull(lobby) ? 'ready to start' : 'waiting for players'}\n` +
      `<a href="${gameBoardUrl(lobby.game)}">Open ${lobby.game.toUpperCase()} board</a>`,
      { parseMode: 'HTML', replyMarkup: openKeyboard(lobby) });
  } catch (e) {
    await answer(query, `${E.INFO} Start the bot in DM to receive the room link.`, true);
  }
}
