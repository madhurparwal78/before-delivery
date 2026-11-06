import { randomUUID } from 'node:crypto';
import type { Trade } from '../shared/domain.js';
import { db, type Queryable } from './db.js';
import { config } from './env.js';
import type { ItemRecord, JobRecord, MemberRecord } from './model.js';
import { MailUnavailable, sendMessage } from './services/smtp.js';

export type OutboxKind = 'assignment' | 'summary';

export async function queueOutbox(
  tx: Queryable,
  jobId: string,
  kind: OutboxKind,
  to: string,
  subject: string,
  body: string,
  at: Date,
): Promise<void> {
  await tx.query(
    `insert into outbox (id, job_id, kind, to_email, subject, body, status, created_at)
     values ($1, $2, $3, $4, $5, $6, 'queued', $7)`,
    [randomUUID(), jobId, kind, to, subject, body, at.toISOString()],
  );
}

export function signInLine(): string {
  return `Sign in to see the details: ${config.publicUrl}/signin`;
}

/**
 * One code-free notice per active member of the trade an item has just been given.
 * The single place that decides what an assignment notice says.
 */
export async function queueAssignmentNotices(
  tx: Queryable,
  job: JobRecord,
  item: { number: number; title: string },
  roomName: string,
  trade: Trade,
  members: MemberRecord[],
  at: Date,
): Promise<void> {
  const subject = `Snaglight: new item on ${job.name}`;
  const body = [
    `Item ${item.number}: ${item.title}`,
    `Room: ${roomName}`,
    signInLine(),
  ].join('\n');
  for (const member of members) {
    if (member.role !== 'trade' || member.trade !== trade || !member.active) continue;
    await queueOutbox(tx, job.id, 'assignment', member.email, subject, body, at);
  }
}

export function itemTitleFor(item: ItemRecord): string {
  return item.title;
}

/* ----------------------------------------------------------------- sending */

async function sendOneQueuedEntry(): Promise<boolean> {
  const claim = await db.query(
    `update outbox set claimed_at = now()
      where id = (
        select id from outbox
         where status = 'queued'
           and (claimed_at is null or claimed_at < now() - interval '60 seconds')
         order by created_at
         for update skip locked
         limit 1
      )
      returning id, to_email, subject, body`,
  );
  if (claim.rowCount === 0) return false;
  const row = claim.rows[0];
  try {
    await sendMessage(
      {
        to: row.to_email as string,
        subject: row.subject as string,
        body: row.body as string,
      },
      new Date(),
    );
    await db.query(`update outbox set status = 'sent', sent_at = now() where id = $1`, [row.id]);
  } catch (error) {
    await db.query(`update outbox set claimed_at = null where id = $1`, [row.id]);
    if (!(error instanceof MailUnavailable)) throw error;
    return false;
  }
  return true;
}

/** Tries each queued entry at once, then at least every 30 seconds until mail accepts it. */
export function startOutboxSender(): void {
  let running = false;
  const drain = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (let sent = 0; sent < 200; sent++) {
        if (!(await sendOneQueuedEntry())) break;
      }
    } catch {
      // A database hiccup is retried on the next pass.
    } finally {
      running = false;
    }
  };
  setInterval(() => void drain(), 5000);
  void drain();
}
