import { config } from '../config.js';
import type { Queryable } from '../db.js';
import type { RequestRecord } from '../domain/records.js';

export type TimerKind = 'warning' | 'breach' | 'ceiling';

export interface TimerRow {
  id: number;
  requestId: string;
  kind: TimerKind;
  submissionSeq: number;
  dueAt: Date;
}

export async function scheduleTimers(
  tx: Queryable,
  request: RequestRecord,
  submittedAt: Date,
  windowHours: number,
): Promise<void> {
  const windowMs = windowHours * 3_600_000;
  const due: [TimerKind, Date][] = [
    ['warning', new Date(submittedAt.getTime() + (windowMs * config.deadlineWarningPercent) / 100)],
    ['breach', new Date(submittedAt.getTime() + windowMs)],
    ['ceiling', new Date(submittedAt.getTime() + windowMs * config.expiryCeilingMultiplier)],
  ];
  for (const [kind, dueAt] of due) {
    await tx.query('insert into timers (request_id, kind, submission_seq, due_at) values ($1,$2,$3,$4)', [
      request.id,
      kind,
      request.submissionSeq,
      dueAt,
    ]);
  }
}

export async function cancelTimers(tx: Queryable, requestId: string): Promise<void> {
  await tx.query('update timers set cancelled = true where request_id = $1 and fired_at is null', [requestId]);
}

export async function dueTimers(tx: Queryable, upTo: Date): Promise<TimerRow[]> {
  const result = await tx.query<{
    id: number;
    request_id: string;
    kind: string;
    submission_seq: number;
    due_at: Date;
  }>(
    `select id, request_id, kind, submission_seq, due_at from timers
     where fired_at is null and cancelled = false and due_at <= $1
     order by due_at asc, id asc`,
    [upTo],
  );
  return result.rows.map((row) => ({
    id: row.id,
    requestId: row.request_id,
    kind: row.kind as TimerKind,
    submissionSeq: row.submission_seq,
    dueAt: row.due_at,
  }));
}

export async function markTimerFired(tx: Queryable, id: number, firedAt: Date): Promise<void> {
  await tx.query('update timers set fired_at = $1 where id = $2', [firedAt, id]);
}
