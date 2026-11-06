import { pool } from './db.js';
import { appNow } from './app-clock.js';
import { deliver } from './smtp.js';

const CLAIM_SECONDS = 20;
const LINK_TTL_MS = 15 * 60 * 1000;

interface OutboxRow {
  id: string;
  email: string;
  subject: string;
  body_text: string;
  body_html: string;
  link_token: string | null;
}

// Claim undelivered outbox rows; a claim holds one instance at a time.
async function claim(now: number, ids?: string[]): Promise<OutboxRow[]> {
  if (ids && ids.length === 0) return [];
  const params: unknown[] = [new Date(now + CLAIM_SECONDS * 1000), new Date(now)];
  let where = 'sent_at IS NULL AND (claim_until IS NULL OR claim_until < $2)';
  if (ids) {
    params.push(ids);
    where += ` AND id = ANY($3)`;
  } else {
    where += ' ORDER BY created_at LIMIT 25';
  }
  const r = await pool.query<OutboxRow>(
    `UPDATE outbox SET claim_until = $1
     WHERE id IN (SELECT id FROM outbox WHERE ${where})
     RETURNING id, email, subject, body_text, body_html, link_token`,
    params,
  );
  return r.rows;
}

async function deliverRow(row: OutboxRow, now: number): Promise<boolean> {
  const ok = await deliver({ to: row.email, subject: row.subject, text: row.body_text, html: row.body_html });
  if (!ok) return false;
  await pool.query('UPDATE outbox SET sent_at = $1 WHERE id = $2 AND sent_at IS NULL', [new Date(now), row.id]);
  if (row.link_token) {
    // the email has been handed to the mail service; its link now expires
    await pool.query('UPDATE links SET expires_at = $1 WHERE token = $2 AND expires_at IS NULL', [new Date(now + LINK_TTL_MS), row.link_token]);
  }
  return true;
}

// Deliver one queued email at once (saves answer from the delivery attempt)
// and mark it sent when SMTP accepts it. Only one instance delivers a row.
export async function tryDeliverOne(outboxId: string): Promise<boolean> {
  const now = await appNow();
  const rows = await claim(now, [outboxId]);
  if (rows.length === 0) {
    // someone else is delivering this email; wait for their result
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const r = await pool.query<{ sent_at: Date | null }>('SELECT sent_at FROM outbox WHERE id = $1', [outboxId]);
      if (r.rows[0]?.sent_at) return true;
    }
    return false;
  }
  return deliverRow(rows[0]!, now);
}

// Claim and deliver undelivered outbox emails; each is claimed by one instance.
export async function drainOutbox(): Promise<void> {
  const now = await appNow();
  const rows = await claim(now);
  for (const row of rows) {
    await deliverRow(row, now);
  }
}
