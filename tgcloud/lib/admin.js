// Admin / owner power tools — port of ws_admin.py
import { api } from 'sdk';
import { db, eq, and, sql, asc, desc } from 'sdk/db';
import { getState, setState, deleteState } from './db.js';
import { escapeHtml } from './msg.js';
import { E, plain } from './emojis.js';
import { OWNER_ID } from './texts.js';
import {
  wsChatGameTopics, wsAuthorizedUsers, wsTracking, wsBroadcastChats,
  wsBroadcastState, wsUsers, wsLeaderboard, gbannedUsers,
} from '../schema.js';

const ownerGate = (uid) => Number(uid) === OWNER_ID || Number(uid) === 8301883098;
const topicId = (m) => m.message_thread_id ? String(m.message_thread_id) : 'general';

export async function handleAdminCommand(command, args, message, ctx) {
  const uid = message.from?.id;
  const chat = message.chat;
  const isPrivate = chat?.type === 'private';
  const argParts = (args || '').trim().split(/\s+/).filter(Boolean);
  const reply = (text, markup) => ctx.reply(text, markup);

  switch (command) {
    // ── Group admin: topic settings ────────────────────────
    case 'setgametopic': {
      if (!chat?.is_forum) return reply(`${E.WARNING} This command can only be used in forum groups.`);
      const exists = await db.select().from(wsChatGameTopics)
        .where(and(eq(wsChatGameTopics.chatId, String(chat.id)), eq(wsChatGameTopics.topicId, topicId(message)))).get();
      if (exists) return reply(`${E.WARNING} Game has already been set for this topic.\nUse /unsetgametopic to unset it first.`);
      const now = new Date().toISOString();
      await db.insert(wsChatGameTopics).values({
        chatId: String(chat.id), topicId: topicId(message), allowedLengths: '5,4,6',
        shouldRecreateOnExpire: 0, createdAt: now, updatedAt: now,
      }).onConflictDoNothing().run();
      return reply(`${E.SUCCESS} @ShadowGameEnBot will now use this topic for the game.`);
    }
    case 'unsetgametopic': {
      if (!chat?.is_forum) return reply(`${E.WARNING} This command can only be used in forum groups.`);
      await db.delete(wsChatGameTopics)
        .where(and(eq(wsChatGameTopics.chatId, String(chat.id)), eq(wsChatGameTopics.topicId, topicId(message)))).run();
      return reply(`${E.SUCCESS} @ShadowGameEnBot won't use this topic for the game.`);
    }
    case 'allowonlylen': {
      if (!chat?.is_forum) return reply(`${E.WARNING} This command can only be used in forum groups.`);
      if (!argParts.length) return reply(`${E.INFO} Usage: /allowonlylen 5 4 6`);
      const lengths = argParts.map(Number).filter(n => [4, 5, 6].includes(n));
      if (!lengths.length) return reply(`${E.WARNING} Allowed lengths are only: 4, 5, 6`);
      const topic = await db.select().from(wsChatGameTopics)
        .where(and(eq(wsChatGameTopics.chatId, String(chat.id)), eq(wsChatGameTopics.topicId, topicId(message)))).get();
      if (!topic) return reply(`${E.WARNING} This topic is not set for the game.\nUse /setgametopic first.`);
      await db.update(wsChatGameTopics).set({ allowedLengths: lengths.join(','), updatedAt: new Date().toISOString() })
        .where(eq(wsChatGameTopics.chatId, String(chat.id))).run();
      return reply(`${E.SUCCESS} Allowed word lengths updated.\nDefault length: ${lengths[0]}\nAllowed: ${lengths.join(', ')}`);
    }
    case 'seekauth': {
      if (!ownerGate(uid)) return reply(`${E.LOCK} This command is owner only.`);
      if (!chat || chat.type === 'private') return reply(`${E.WARNING} Use this command in a group chat.`);
      const target = argParts[0];
      let targetId = target ? Number(target.replace('@', '')) : message.replyToMessage?.from?.id;
      if (!targetId) return reply(`${E.INFO} Usage: /seekauth <user_id> (or reply to a user)`);
      const now = new Date().toISOString();
      await db.insert(wsAuthorizedUsers).values({ chatId: String(chat.id), userId: String(targetId), authorizedBy: String(uid), createdAt: now })
        .onConflictDoNothing().run();
      return reply(`${E.SUCCESS} User ${targetId} is now authorized to end games in this chat.`);
    }
    case 'recreatetopic': {
      if (!chat?.is_forum) return reply(`${E.WARNING} This command can only be used in forum groups.`);
      await db.update(wsChatGameTopics).set({ shouldRecreateOnExpire: 1, updatedAt: new Date().toISOString() })
        .where(and(eq(wsChatGameTopics.chatId, String(chat.id)), eq(wsChatGameTopics.topicId, topicId(message)))).run();
      return reply(`${E.SUCCESS} Topic recreation on expire has been turned ON.`);
    }

    // ── Owner: bans ────────────────────────────────────────
    case 'ban': case 'gban': {
      if (!ownerGate(uid)) return reply(`${E.LOCK} This command is owner only.`);
      let targetId = argParts[0] ? Number(argParts[0].replace('@', '')) : message.replyToMessage?.from?.id;
      if (!targetId || Number.isNaN(targetId)) return reply(`${E.INFO} Usage: /ban <user_id> (or reply to a user)`);
      if (targetId === uid) return reply(`${E.ERROR} You cannot gban yourself.`);
      await db.insert(gbannedUsers).values({ userId: Number(targetId), bannedAt: new Date().toISOString(), reason: argParts.slice(1).join(' ') || null })
        .onConflictDoNothing().run();
      return reply(`${E.BAN} User ${targetId} has been globally banned.`);
    }
    case 'unban': case 'ungban': {
      if (!ownerGate(uid)) return reply(`${E.LOCK} This command is owner only.`);
      const targetId = argParts[0] ? Number(argParts[0].replace('@', '')) : message.replyToMessage?.from?.id;
      if (!targetId) return reply(`${E.INFO} Usage: /unban <user_id>`);
      await db.delete(gbannedUsers).where(eq(gbannedUsers.userId, Number(targetId))).run();
      return reply(`${E.UNBAN} User ${targetId} has been unbanned.`);
    }

    // ── Owner: tracking ────────────────────────────────────
    case 'track': {
      if (!isPrivate || !ownerGate(uid)) return reply(isPrivate ? `${E.LOCK} This command is owner only.` : `${E.WARNING} Use this command in a private chat with the bot.`);
      const cid = argParts[0];
      if (!cid) return reply(`${E.INFO} Usage: /track <chat_id>`);
      const exists = await db.select().from(wsTracking).where(eq(wsTracking.chatId, cid)).get();
      if (exists) return reply(`${E.WARNING} Chat ${cid} is already being tracked.`);
      await db.insert(wsTracking).values({ chatId: cid, adminChatId: String(chat.id), createdAt: new Date().toISOString() }).run();
      return reply(`${E.SUCCESS} Now tracking chat: ${cid}\nAll messages will be forwarded here.`);
    }
    case 'untrack': {
      if (!isPrivate || !ownerGate(uid)) return reply(isPrivate ? `${E.LOCK} This command is owner only.` : `${E.WARNING} Use this command in a private chat with the bot.`);
      const cid = argParts[0];
      if (!cid) return reply(`${E.INFO} Usage: /untrack <chat_id>`);
      const res = await db.delete(wsTracking).where(eq(wsTracking.chatId, cid)).run();
      return reply(res.rowsAffected ? `${E.SUCCESS} Stopped tracking chat: ${cid}` : `${E.WARNING} Chat ${cid} is not being tracked.`);
    }
    case 'tracklist': {
      if (!isPrivate || !ownerGate(uid)) return reply(isPrivate ? `${E.LOCK} This command is owner only.` : `${E.WARNING} Use this command in a private chat with the bot.`);
      const rows = await db.select().from(wsTracking).all();
      if (!rows.length) return reply(`${E.INFO} No chats are currently being tracked.`);
      return reply(`${E.INFO} <b>Currently tracking:</b>\n` + rows.map(r => `• <code>${escapeHtml(r.chatId)}</code>`).join('\n'), { parseMode: 'HTML' });
    }

    // ── Owner: leaderboard transfer ────────────────────────
    case 'transfer': {
      if (!isPrivate || !ownerGate(uid)) return reply(isPrivate ? `${E.LOCK} This command is owner only.` : `${E.WARNING} Use this command in a private chat with the bot.`);
      if (argParts.length !== 2) return reply(`${E.INFO} Usage: /transfer &lt;from_user&gt; &lt;to_user&gt;`, { parseMode: 'HTML' });
      const findUser = async (id) => {
        const clean = id.replace('@', '');
        const byId = await db.select().from(wsUsers).where(eq(wsUsers.id, clean)).get();
        if (byId) return byId;
        return await db.select().from(wsUsers).where(sql`lower(${wsUsers.username}) = lower(${clean})`).get() || null;
      };
      const from = await findUser(argParts[0]), to = await findUser(argParts[1]);
      if (!from) return reply(`${E.ERROR} Source user not found: ${escapeHtml(argParts[0])}`, { parseMode: 'HTML' });
      if (!to) return reply(`${E.ERROR} Destination user not found: ${escapeHtml(argParts[1])}`, { parseMode: 'HTML' });
      if (from.id === to.id) return reply(`${E.ERROR} Cannot transfer to the same user.`);
      const entries = await db.select().from(wsLeaderboard).where(eq(wsLeaderboard.userId, from.id)).all();
      if (!entries.length) return reply(`${E.INFO} ${escapeHtml(from.name)} has no leaderboard entries to transfer.`, { parseMode: 'HTML' });
      const total = entries.reduce((s, e) => s + (e.score || 0), 0);
      for (const e of entries) {
        await db.update(wsLeaderboard).set({ userId: to.id }).where(eq(wsLeaderboard.id, e.id)).run();
      }
      return reply(`${E.SUCCESS} <b>Successfully transferred leaderboard data!</b>\n\nFrom: ${escapeHtml(from.name)} (${from.id})\nTo: ${escapeHtml(to.name)} (${to.id})\n\nEntries transferred: ${entries.length}\nTotal score transferred: ${total}`, { parseMode: 'HTML' });
    }

    // ── Owner: broadcast (chunked across invocations) ─────
    case 'broadcast': {
      if (!isPrivate || !ownerGate(uid)) return reply(isPrivate ? `${E.LOCK} This command is owner only.` : `${E.WARNING} Use this command in a private chat with the bot.`);
      if (!message.replyToMessage) return reply(`<blockquote>${E.ANNOUNCE} No message to broadcast!</blockquote>\n\nPlease mention the message that you want to broadcast.`, { parseMode: 'HTML' });
      const existing = await getState('bcast:job');
      if (existing) return reply(`<blockquote>${E.WARNING} A broadcast is already in progress!</blockquote>\n\nProgress: ${existing.currentIndex}/${existing.totalChats}\nUse /broadcast_status or /broadcast_cancel.`, { parseMode: 'HTML' });
      const chats = await db.select().from(wsBroadcastChats).all();
      if (!chats.length) return reply(`${E.INFO} Not enough users are recorded yet!\n\n<blockquote>Please try again later</blockquote>`, { parseMode: 'HTML' });
      const targets = chats.map(c => c.id);
      await setState('bcast:targets', targets);
      const status = await ctx.replyMessage(`<blockquote>${E.ANNOUNCE} Broadcasting your message to ${targets.length} members</blockquote>`, { parseMode: 'HTML' });
      await setState('bcast:job', {
        messageId: message.replyToMessage.messageId, sourceChatId: chat.id,
        totalChats: targets.length, currentIndex: 0, success: 0, blocked: 0,
        statusMessageId: status?.message_id, statusChatId: chat.id,
        startTime: Date.now(), text: message.replyToMessage.text || '',
      });
      // Process first small batch now; further batches on /broadcast_status taps.
      await runBroadcastBatch(ctx);
      return;
    }
    case 'broadcast_status': {
      if (!isPrivate || !ownerGate(uid)) return reply(isPrivate ? `${E.LOCK} This command is owner only.` : `${E.WARNING} Use this command in a private chat with the bot.`);
      const job = await getState('bcast:job');
      if (!job) return reply(`<blockquote>${E.INFO} No broadcast in progress</blockquote>`, { parseMode: 'HTML' });
      if (job.currentIndex < job.totalChats) await runBroadcastBatch(ctx);
      const j2 = await getState('bcast:job') || job;
      const elapsed = Math.floor((Date.now() - j2.startTime) / 1000);
      return reply(`<blockquote>${E.ANNOUNCE} <b>Broadcast progress</b>\n${j2.currentIndex}/${j2.totalChats} sent\n✅ ${j2.success} · 🚫 ${j2.blocked}\n⏱ ${elapsed}s</blockquote>`, { parseMode: 'HTML' });
    }
    case 'broadcast_cancel': {
      if (!isPrivate || !ownerGate(uid)) return reply(isPrivate ? `${E.LOCK} This command is owner only.` : `${E.WARNING} Use this command in a private chat with the bot.`);
      await deleteState('bcast:job'); await deleteState('bcast:targets');
      return reply(`${E.SUCCESS} Broadcast cancelled.`);
    }
    case 'captcha': {
      if (!ownerGate(uid)) return reply(`${E.LOCK} This command is owner only.`);
      return reply(`${E.INFO} Usage: /captcha <chatId> <userId>`);
    }
    default: return null;
  }
}

async function runBroadcastBatch(ctx) {
  const job = await getState('bcast:job');
  const targets = await getState('bcast:targets');
  if (!job || !targets) return;
  const BATCH = 10;
  const end = Math.min(job.currentIndex + BATCH, targets.length);
  for (let i = job.currentIndex; i < end; i++) {
    try {
      await api.sendMessage({ chat_id: targets[i], text: job.text || '📢 Announcement' });
      job.success++;
    } catch (e) {
      if (e.code === 403) job.blocked++;
    }
    job.currentIndex = i + 1;
    await setState('bcast:job', job); // checkpoint after every target
  }
  if (job.currentIndex >= job.totalChats) {
    await deleteState('bcast:job'); await deleteState('bcast:targets');
    try {
      await api.sendMessage({ chat_id: job.statusChatId, text: `<blockquote>${E.SUCCESS} Broadcast complete!\n✅ ${job.success} delivered · 🚫 ${job.blocked} blocked</blockquote>`, parse_mode: 'HTML' });
    } catch (e) { /* ignore */ }
  }
}
