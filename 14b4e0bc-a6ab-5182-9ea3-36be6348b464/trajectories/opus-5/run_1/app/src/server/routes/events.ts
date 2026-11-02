import type { Role } from '../../shared/domain.ts';
import { roleAtSeq } from '../commit.ts';
import { pool, query } from '../db.ts';
import type { AuditAction, AuditTargetType } from '../domain/audit.ts';
import { type ActivityRow, bus } from '../events.ts';
import type { Ctx, Reply } from '../http/context.ts';
import { errors } from '../http/errors.ts';
import type { Router } from '../http/router.ts';
import { latestSeq } from '../domain/snapshot.ts';

const KEEP_ALIVE_MS = 10_000;

/** An Admin's stream carries every row; every other role sees neither user rows nor downloads. */
function visibleToRole(row: ActivityRow, role: Role, callerId: string): boolean {
  if (role === 'Admin') return true;
  if (row.action === 'evidence.download') return false;
  if (row.action.startsWith('user.')) {
    return row.action === 'user.role_change' && row.target.id === callerId;
  }
  return true;
}

export function registerEventRoutes(router: Router): void {
  router.add('GET', '/api/events', async (ctx: Ctx): Promise<Reply | null> => {
    const actor = await ctx.requireActor();
    const rawCursor = ctx.header('last-event-id') ?? ctx.queryParam('after_seq');
    if (rawCursor !== null && rawCursor !== undefined && !/^\d+$/.test(rawCursor)) {
      throw errors.validation({ after_seq: 'Use a non-negative whole number.' });
    }
    const cursor =
      rawCursor === null || rawCursor === undefined ? await latestSeq(pool) : Number(rawCursor);

    ctx.response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });

    let lastSent = cursor;
    let role = await roleAtSeq(pool, actor.userId, cursor);
    let closed = false;
    const buffered: ActivityRow[] = [];
    let catchingUp = true;

    const write = (row: ActivityRow): void => {
      ctx.response.write(
        `id: ${row.seq}\nevent: change\ndata: ${JSON.stringify({
          seq: row.seq,
          action: row.action,
          target: row.target,
        })}\n\n`,
      );
    };

    const deliver = async (row: ActivityRow): Promise<void> => {
      if (closed || row.seq <= lastSent) return;
      lastSent = row.seq;
      const ownRoleChange = row.action === 'user.role_change' && row.target.id === actor.userId;
      if (visibleToRole(row, role, actor.userId)) write(row);
      if (ownRoleChange) role = await roleAtSeq(pool, actor.userId, row.seq);
    };

    const unsubscribeActivity = bus.onActivity((row) => {
      if (catchingUp) buffered.push(row);
      else void deliver(row);
    });

    const close = (): void => {
      if (closed) return;
      closed = true;
      unsubscribeActivity();
      unsubscribeSession();
      clearInterval(keepAlive);
      ctx.response.end();
    };

    const unsubscribeSession = bus.onSessionEnded((tokenHash) => {
      if (tokenHash === actor.tokenHash) close();
    });
    const keepAlive = setInterval(() => {
      if (!closed) ctx.response.write(': keep-alive\n\n');
    }, KEEP_ALIVE_MS);
    ctx.request.on('close', close);

    const backlog = await query<{
      seq: string;
      action: AuditAction;
      target_type: AuditTargetType;
      target_id: string;
    }>('SELECT seq, action, target_type, target_id FROM audit_log WHERE seq > $1 ORDER BY seq ASC', [
      cursor,
    ]);
    for (const row of backlog.rows) {
      await deliver({
        seq: Number(row.seq),
        action: row.action,
        target: { type: row.target_type, id: row.target_id },
      });
    }
    catchingUp = false;
    for (const row of buffered.sort((a, b) => a.seq - b.seq)) await deliver(row);

    return null;
  });
}
