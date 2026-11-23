// Scheduled cleanup: expire unstarted lobbies older than 2 minutes.
import { db, eq, and, sql } from 'sdk/db';
import { webappLobbies } from '../schema.js';
import { deleteState } from '../lib/db.js';
import { SESSION_MS } from '../lib/lobby.js';

export default async function () {
  const cutoff = new Date(Date.now() - SESSION_MS).toISOString();
  const stale = await db.select().from(webappLobbies)
    .where(and(
      eq(webappLobbies.status, 'open'),
      sql`${webappLobbies.createdAt} < ${cutoff}`,
    )).all();
  const codes = [];
  for (const lobby of stale) {
    await db.update(webappLobbies)
      .set({ status: 'expired', updatedAt: new Date().toISOString() })
      .where(eq(webappLobbies.code, lobby.code)).run();
    await deleteState(`lobby:host:${lobby.code}`);
    codes.push(lobby.code);
  }
  return { ok: true, expired: codes.length, codes };
}
