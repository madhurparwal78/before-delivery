// The notice outbox. Every notice is written to PostgreSQL as queued first,
// then sent by SMTP exactly once, one sender claiming a notice at a time.
import { pg } from './db.js';
import { broadcastNotice } from './engine.js';
import { mailer } from './services.js';
import { isoOf, localParts, pad } from '../domain/time.js';

export async function queueNotice(key: string, kind: string, subject: string, body: string): Promise<void> {
  const household = await pg.query('SELECT notice_address FROM household LIMIT 1');
  const to = household.rows[0]!.notice_address;
  const id = `notice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await pg.query('BEGIN');
  try {
    const exists = await pg.query('SELECT notice_id FROM notice_keys WHERE key = $1', [key]);
    if (exists.rowCount) {
      await pg.query('COMMIT');
      return;
    }
    await pg.query(`INSERT INTO notices (id, kind, subject, body, to_address, state, attempts, created_at) VALUES ($1, $2, $3, $4, $5, 'queued', 0, $6)`, [id, kind, subject, body, to, new Date()]);
    await pg.query('INSERT INTO notice_keys (key, notice_id, created_at) VALUES ($1, $2, $3)', [key, id, new Date()]);
    await pg.query('COMMIT');
  } catch (e) {
    await pg.query('ROLLBACK');
    throw e;
  }
  const n = await noticeById(id);
  if (n) await broadcastNotice(n);
}

export async function noticeById(id: string): Promise<Record<string, unknown> | null> {
  const r = await pg.query('SELECT id, kind, subject, to_address, state, attempts, created_at, sent_at FROM notices WHERE id = $1', [id]);
  if (!r.rowCount) return null;
  return serializeNotice(r.rows[0] as NoticeRow);
}

interface NoticeRow { id: string; kind: string; subject: string; to_address: string; state: string; attempts: number; created_at: Date; sent_at: Date | null }

export function serializeNotice(n: NoticeRow): Record<string, unknown> {
  return { id: n.id, kind: n.kind, subject: n.subject, to: n.to_address, state: n.state, attempts: n.attempts, created_at: isoOf(n.created_at.getTime()), sent_at: n.sent_at === null ? null : isoOf(n.sent_at.getTime()) };
}

export async function notices(): Promise<Record<string, unknown>[]> {
  const r = await pg.query('SELECT id, kind, subject, to_address, state, attempts, created_at, sent_at FROM notices ORDER BY created_at DESC, id DESC');
  return (r.rows as NoticeRow[]).map(serializeNotice);
}

/** Claim-and-send loop: each queued notice is sent exactly once, by one sender. */
export async function drainOutbox(): Promise<void> {
  if (!mailer.up) return;
  const claimed = await pg.query(
    `UPDATE notices SET attempts = attempts + 1 WHERE id IN (SELECT id FROM notices WHERE state = 'queued' ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING id, kind, subject, body, to_address, attempts`,
  );
  for (const row of claimed.rows as { id: string; kind: string; subject: string; body: string; to_address: string; attempts: number }[]) {
    try {
      await mailer.send({ from: mailer.from, to: row.to_address, subject: row.subject, text: row.body, headers: { 'X-Nightplan-Notice': row.id } });
      await pg.query(`UPDATE notices SET state = 'sent', sent_at = $2 WHERE id = $1 AND state = 'queued'`, [row.id, new Date()]);
      const n = await noticeById(row.id);
      if (n) await broadcastNotice(n);
    } catch {
      await pg.query(`UPDATE notices SET state = 'queued' WHERE id = $1`, [row.id]);
    }
  }
}

export function sentTime(n: { sent_at: Date | null }): string | null {
  if (n.sent_at === null) return null;
  const p = localParts(n.sent_at.getTime());
  return `${pad(p.h)}:${pad(p.mi)}`;
}
