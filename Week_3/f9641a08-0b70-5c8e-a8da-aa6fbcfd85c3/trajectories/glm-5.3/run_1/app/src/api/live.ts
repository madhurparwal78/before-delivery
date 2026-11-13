import type { Request, Response } from 'express';
import { withClient } from '../db/pool.js';
import { eventsSince, firstEventSeq, visibleTo } from '../domain/events.js';
import { lookupSession, type SessionInfo } from '../api/session.js';

/**
 * The live stream. A client resumes from its last sequence number with
 * Last-Event-ID or ?after; a resume point older than 24 hours gets a reset.
 */
export async function liveHandler(req: Request, res: Response): Promise<void> {
  const token = (req as unknown as { session?: SessionInfo }).session?.token ?? '';
  const session = token === '' ? null : await lookupSession(token);
  if (session === null) {
    res.status(401).json({ error: 'unauthenticated', message: 'Sign in to continue.' });
    return;
  }
  const viewer = {
    userId: session.userId,
    sessionId: session.token,
    staff: session.role === 'operations' || session.role === 'support',
  };

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let lastId = 0;
  const headerId = req.header('last-event-id');
  const queryAfter = req.query.after;
  if (typeof headerId === 'string' && headerId !== '') {
    lastId = Number(headerId);
  } else if (typeof queryAfter === 'string' && queryAfter !== '') {
    lastId = Number(queryAfter);
  } else {
    lastId = await withClient((client) => firstEventSeq(client)) - 1;
    if (lastId < 0) lastId = 0;
  }

  // A resume point older than 24 hours resets the client.
  const first = await withClient((client) => firstEventSeq(client));
  if (lastId > 0 && lastId < first - 1) {
    res.write(`event: reset\ndata: {}\n\n`);
    lastId = first - 1;
    if (lastId < 0) lastId = 0;
  }

  let stopped = false;
  req.on('close', () => { stopped = true; });

  const sendBatch = async (): Promise<void> => {
    if (stopped) return;
    const rows = await withClient((client) => eventsSince(client, lastId, 200));
    for (const row of rows) {
      if (!visibleTo({ scope_user: row.scope_user, scope_session: row.scope_session, staff_visible: row.staff_visible }, viewer)) {
        lastId = Number(row.seq);
        continue;
      }
      res.write(`id: ${row.seq}\nevent: ${row.type}\ndata: ${JSON.stringify(row.data)}\n\n`);
      lastId = Number(row.seq);
    }
  };

  await sendBatch();
  const interval = setInterval(() => { void sendBatch(); }, 1000);
  const keepAlive = setInterval(() => {
    if (!stopped) res.write(': keepalive\n\n');
  }, 15000);
  req.on('close', () => {
    clearInterval(interval);
    clearInterval(keepAlive);
  });
}
