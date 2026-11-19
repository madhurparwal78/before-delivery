import { query, withTransaction, type Tx } from './db';
import type { Config } from './config';
import { appendAudit } from './audit';
import { queueMail, warningMail, breachMail, expiredMail } from './mail';
import { notify } from './pglisten';
import { loadRequestTx } from './timers-data';
import { tierHours } from './requests-core';
import { formatDateTime } from './datetime';

export async function runDueTimers(now: Date, cfg: Config): Promise<boolean> {
  const due = await query<{
    request_id: string;
    kind: string;
    due_at: Date;
    done_at: Date | null;
    deadline: Date;
    submitted_at: Date;
    holder_id: string;
    state: string;
  }>(
    `SELECT t.request_id, t.kind, t.due_at, t.done_at, r.deadline, r.submitted_at, r.holder_id, r.state
       FROM timers t
       JOIN requests r ON r.id = t.request_id AND r.state = 'under_review'
      WHERE t.done_at IS NULL AND t.due_at <= $1
      ORDER BY t.due_at ASC, t.request_id ASC`,
    [now],
  );
  if (due.length === 0) return false;
  for (const timer of due) {
    await withTransaction(async (tx) => {
      const locked = await tx.query<{ done_at: Date | null; due_at: Date; request_id: string }>(
        'SELECT done_at, due_at, request_id FROM timers WHERE request_id = $1 AND kind = $2 FOR UPDATE',
        [timer.request_id, timer.kind],
      );
      if (locked.rows.length === 0 || locked.rows[0].done_at !== null) return;
      if (timer.state === 'withdrawn' || timer.state === 'granted' || timer.state === 'rejected' || timer.state === 'expired') {
        await tx.query(`UPDATE timers SET done_at = $3 WHERE request_id = $1 AND kind = $2`, [
          timer.request_id,
          timer.kind,
          now,
        ]);
        return;
      }
      await tx.query(`UPDATE timers SET done_at = $3 WHERE request_id = $1 AND kind = $2`, [
        timer.request_id,
        timer.kind,
        now,
      ]);
      const record = await loadRequestTx(tx, timer.request_id);
      if (timer.kind === 'warning') {
        const holder = await holderEmail(tx, record.holderId);
        if (holder) {
          await queueMail(tx, warningMail(cfg, timer.request_id, record.deadline ?? now, holder.email), now);
        }
      } else if (timer.kind === 'breach') {
        const previous = await holderEmail(tx, record.holderId);
        const owners = await txRows<{ id: string; email: string; display_name: string }>(
          tx,
          `SELECT p.id, p.email, p.display_name FROM principals p
           WHERE p.role = 'owner'
           ORDER BY (SELECT COUNT(*) FROM request_stages x
                      WHERE x.assignee_id = p.id AND x.decision IS NULL
                        AND x.request_id IN (SELECT id FROM requests WHERE state = 'under_review')), p.display_name`,
          [],
        );
        const owner = owners[0];
        if (!owner) return;
        const open = await txRows<{ n: number }>(
          tx,
          `SELECT n FROM request_stages WHERE request_id = $1 AND decision IS NULL ORDER BY n LIMIT 1`,
          [timer.request_id],
        );
        if (open.length === 0) return;
        await tx.query(
          `UPDATE request_stages SET assignee_id = $2 WHERE request_id = $1 AND n = $3`,
          [timer.request_id, owner.id, open[0].n],
        );
        await tx.query(`UPDATE requests SET holder_id = $2, escalation = 'deadline_missed' WHERE id = $1`, [
          timer.request_id,
          owner.id,
        ]);
        await appendAudit(tx, {
          occurredAt: now,
          actorId: 'system',
          actorRole: 'system',
          action: 'request.escalated',
          resourceType: 'request',
          resourceId: timer.request_id,
          requestId: timer.request_id,
          before: { holder: record.holderId },
          after: { escalation: 'deadline_missed', holder: owner.id },
          outcome: 'success',
        });
        await queueMail(tx, breachMail(cfg, timer.request_id, previous?.name ?? 'the previous holder', owner.email), now);
        await notify(tx, JSON.stringify({ type: 'queue.updated' }));
      } else if (timer.kind === 'ceiling') {
        await tx.query(`UPDATE requests SET state = 'expired', holder_id = requester_id WHERE id = $1`, [
          timer.request_id,
        ]);
        await appendAudit(tx, {
          occurredAt: now,
          actorId: 'system',
          actorRole: 'system',
          action: 'request.expired',
          resourceType: 'request',
          resourceId: timer.request_id,
          requestId: timer.request_id,
          before: { state: record.state },
          after: { state: 'expired' },
          outcome: 'success',
        });
        const requester = await requesterEmail(tx, timer.request_id);
        if (requester) {
          await queueMail(tx, expiredMail(cfg, timer.request_id, requester.email), now);
        }
      }
    });
  }
  return true;
}

async function holderEmail(tx: Tx, principalId: string): Promise<{ email: string; name: string } | null> {
  const rows = await txRows<{ email: string; display_name: string }>(
    tx,
    'SELECT email, display_name FROM principals WHERE id = $1',
    [principalId],
  );
  return rows[0] ? { email: rows[0].email, name: rows[0].display_name } : null;
}

async function requesterEmail(tx: Tx, requestId: string): Promise<{ email: string } | null> {
  const rows = await txRows<{ email: string }>(
    tx,
    `SELECT p.email FROM requests r JOIN principals p ON p.id = r.requester_id WHERE r.id = $1`,
    [requestId],
  );
  return rows[0] ?? null;
}

async function txRows<T extends Record<string, unknown>>(
  tx: Tx,
  sql: string,
  params: readonly unknown[],
): Promise<T[]> {
  const res = await tx.query(sql, params as unknown[]);
  return res.rows as T[];
}

export { tierHours, formatDateTime };
