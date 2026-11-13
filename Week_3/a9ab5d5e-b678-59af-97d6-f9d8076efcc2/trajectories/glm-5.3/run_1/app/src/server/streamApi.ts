/** Notices list, record log list, and the SSE household stream. */
import { Ctx, sendJson } from './http';
import { problem } from './problems';
import { AppDeps } from './apiTypes';
import { ValidationErrors } from './validate';
import { IncomingMessage, ServerResponse } from 'node:http';

export async function listNotices(ctx: Ctx, deps: AppDeps): Promise<void> {
  const rows = await deps.pool.query(
    `SELECT * FROM notices WHERE household_id=$1 ORDER BY queued_at DESC, id DESC`,
    [ctx.householdId!],
  );
  const degraded = await deps.pool.query(
    `SELECT 1 FROM notices WHERE household_id=$1 AND attempt_failed_at IS NOT NULL
       AND sent_at IS NULL ORDER BY attempt_failed_at DESC LIMIT 1`,
    [ctx.householdId!],
  );
  const mail = degraded.rows.length > 0 ? 'degraded' : 'ok';
  sendJson(ctx, 200, {
    items: rows.rows.map((n: Record<string, unknown>) => ({
      id: n.id,
      kind: n.kind,
      to: n.to_email,
      subject: n.subject,
      status: n.status,
      attempts: n.attempts,
      queuedAt: isoOut(n.queued_at as Date),
      sentAt: n.sent_at ? isoOut(n.sent_at as Date) : null,
    })),
    mail,
  });
}

function isoOut(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '+00:00').replace('Z', '+00:00');
}

export async function listLog(ctx: Ctx, deps: AppDeps): Promise<void> {
  const afterStr = ctx.query('after');
  let after = 0;
  if (afterStr !== null) {
    if (!/^\d+$/.test(afterStr)) throw new ValidationErrors({ after: 'This cursor is not valid.' });
    after = Number(afterStr);
  }
  const limitStr = ctx.query('limit');
  let limit = 50;
  if (limitStr !== null) {
    if (!/^\d+$/.test(limitStr)) throw new ValidationErrors({ limit: 'Use a limit from 1 to 100.' });
    const n = Number(limitStr);
    if (n < 1 || n > 100) throw new ValidationErrors({ limit: 'Use a limit from 1 to 100.' });
    limit = n;
  }
  const res = await deps.pool.query(
    `SELECT seq, at, actor, type, subject_id FROM log_entries
     WHERE household_id=$1 AND seq > $2 ORDER BY seq ASC LIMIT $3`,
    [ctx.householdId!, after, limit],
  );
  const rows = res.rows as Array<{ seq: string; at: Date; actor: string; type: string; subject_id: string | null }>;
  const items = rows.map((r) => ({
    seq: r.seq,
    at: isoOut(r.at),
    actor: r.actor,
    type: r.type,
    subjectId: r.subject_id,
  }));
  const lastSeq = rows.length > 0 ? String(rows[rows.length - 1].seq) : null;
  sendJson(ctx, 200, { items, next: lastSeq });
}

/** The household stream: every entry above Last-Event-ID in order, then new
 *  ones as they commit; a comment at least every 15 seconds. */
export async function events(ctx: Ctx, deps: AppDeps): Promise<void> {
  // token via query is not allowed; the stream needs the bearer header which
  // the browser EventSource cannot send. The app signs in via /api/session and
  // uses a session-token query param instead, named token.
  const token = ctx.bearerToken() ?? ctx.query('token');
  if (!token) throw problem(401, 'unauthenticated');
  const session = await deps.pool.query(`SELECT household_id FROM sessions WHERE token=$1`, [token]);
  if (session.rows.length === 0) throw problem(401, 'unauthenticated');
  const hid = session.rows[0].household_id as string;

  const res = ctx.res;
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const lastEventId = ctx.header('last-event-id');
  let fromSeq = 0;
  if (lastEventId && /^\d+$/.test(lastEventId)) fromSeq = Number(lastEventId);

  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      clearInterval(commentTimer);
      clearInterval(pollTimer);
      clearInterval(sessionTimer);
      res.end();
    }
  };
  ctx.req.on('close', close);
  res.on('close', close);

  const sendEntry = (row: { seq: string; type: string; at: Date; actor: string; subject_id: string | null }) => {
    res.write(`id: ${row.seq}\nevent: ${row.type}\ndata: ${JSON.stringify({
      seq: row.seq,
      at: isoOut(row.at),
      actor: row.actor,
      type: row.type,
      subjectId: row.subject_id,
    })}\n\n`);
  };

  // initial backlog
  const backlog = await deps.pool.query(
    `SELECT seq, type, at, actor, subject_id FROM log_entries WHERE household_id=$1 AND seq > $2 ORDER BY seq ASC`,
    [hid, fromSeq],
  );
  for (const row of backlog.rows) sendEntry(row);

  let lastSeq = backlog.rows.length > 0
    ? Number(backlog.rows[backlog.rows.length - 1].seq)
    : fromSeq;

  const pollTimer = setInterval(async () => {
    if (closed) return;
    try {
      const fresh = await deps.pool.query(
        `SELECT seq, type, at, actor, subject_id FROM log_entries WHERE household_id=$1 AND seq > $2 ORDER BY seq ASC`,
        [hid, lastSeq],
      );
      for (const row of fresh.rows) {
        sendEntry(row);
        lastSeq = Math.max(lastSeq, Number(row.seq));
      }
      // session ended: close within 3 seconds
      const alive = await deps.pool.query(`SELECT 1 FROM sessions WHERE token=$1`, [token]);
      if (alive.rows.length === 0) close();
    } catch {
      close();
    }
  }, 700);

  const commentTimer = setInterval(() => {
    if (!closed) res.write(': keep-alive\n\n');
  }, 10000);

  const sessionTimer = setInterval(async () => {
    if (closed) return;
    try {
      const alive = await deps.pool.query(`SELECT 1 FROM sessions WHERE token=$1`, [token]);
      if (alive.rows.length === 0) close();
    } catch {
      close();
    }
  }, 1000);
}

export type EventsHandle = { close: () => void };
export type CtxReq = IncomingMessage;
export type CtxRes = ServerResponse;
