import type { Request, Response } from 'express';
import { ERR, asyncRoute } from '../errors';
import type { AppServices } from '../session';
import { roleAtSeq, roleTimeline, streamVisible } from './reads';
import type { Fanout, AuditEventRow } from '../fanout';
import type { Role } from '../../shared/domain';
import type { DbRow } from '../querier';

/**
 * GET /api/events (DP-81, DP-82, DP-84): one event per visible committed audit
 * row, in ascending seq, with the caller's role as it stood right after each
 * row committed. Each stream keeps its own cursor and visibility decisions.
 */
export function eventsRoute(svc: AppServices, fanout: Fanout) {
  return asyncRoute(async (req: Request, res: Response) => {
    const user = req.sessionUser!;
    const header = req.headers['last-event-id'];
    const param = req.query.after_seq;
    const cursorRaw = header !== undefined ? String(header) : param !== undefined ? String(param) : null;
    let cursor: number;
    if (cursorRaw !== null && String(cursorRaw).trim() !== '') {
      const raw = String(cursorRaw).trim();
      if (!/^\d+$/.test(raw)) {
        throw ERR.validation({ after_seq: 'Use a non-negative whole number.' });
      }
      cursor = Number(raw);
    } else {
      const max = await svc.db.queryOne<{ max: string | null }>(`SELECT max(seq) AS max FROM audit_log`);
      cursor = Number(max?.max ?? 0);
    }

    const timeline = await roleTimeline(svc.db, user.id, user.role);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    let lastSent = cursor;
    const sent = new Set<number>();
    const buffer: AuditEventRow[] = [];
    let closed = false;

    const sendRow = (row: { seq: number; action: string; target_type: string; target_id: string }): void => {
      const role = roleAtSeq(timeline, row.seq);
      if (!streamVisible(role, { action: row.action, target_id: row.target_id }, user.id)) return;
      const data = JSON.stringify({ seq: row.seq, action: row.action, target: { type: row.target_type, id: row.target_id } });
      res.write(`id: ${row.seq}\nevent: change\ndata: ${data}\n\n`);
    };

    const flush = (): void => {
      buffer.sort((a, b) => a.seq - b.seq);
      while (buffer.length > 0 && buffer[0]!.seq <= lastSent + 1) {
        const row = buffer.shift()!;
        if (!sent.has(row.seq)) {
          sendRow(row);
          sent.add(row.seq);
          lastSent = Math.max(lastSent, row.seq);
        }
      }
      if (buffer.length > 0) {
        // A buffered row past a gap waits for the missing rows to arrive.
        const next = buffer[0]!.seq;
        if (next <= lastSent + 1) flush();
      }
    };

    // Subscribe before the catch-up, so rows committed during it are buffered.
    const offRows = fanout.onRows((rows: AuditEventRow[]) => {
      if (closed) return;
      for (const row of rows) {
        if (row.action === 'user.role_change' && row.target_id === user.id) {
          timeline.changes.push({ seq: row.seq, role: roleOfChange(row) });
          timeline.changes.sort((a, b) => a.seq - b.seq);
        }
        if (!sent.has(row.seq) && row.seq > cursor) buffer.push(row);
      }
      flush();
    });

    // Catch-up: every visible row above the cursor, in ascending seq.
    const backlog = await svc.db.query<RowInfoDb>(
      `SELECT seq, action, target_type, target_id FROM audit_log WHERE seq > $1 ORDER BY seq ASC`,
      [cursor]
    );
    for (const row of backlog) {
      if (!sent.has(row.seq)) {
        sendRow(row);
        sent.add(row.seq);
        lastSent = Math.max(lastSent, row.seq);
      }
    }
    flush();

    const offSession = fanout.watchSession(req.sessionTokenHash!, () => {
      if (!closed) {
        closed = true;
        cleanup();
        try {
          res.write('event: end\ndata: {}\n\n');
        } catch {
          /* the client is gone */
        }
        res.end();
      }
    });
    const keepAlive = setInterval(() => {
      if (closed) return;
      res.write(': keep-alive\n\n');
    }, 10_000);

    const cleanup = (): void => {
      offRows();
      offSession();
      clearInterval(keepAlive);
    };

    req.on('close', () => {
      closed = true;
      cleanup();
    });
  });
}

interface RowInfoDb extends DbRow {
  seq: number;
  action: string;
  target_type: string;
  target_id: string;
}

function roleOfChange(row: AuditEventRow): Role {
  const after = (row.after ?? {}) as Record<string, unknown>;
  return String(after.role) as Role;
}
