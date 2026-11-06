import { randomUUID } from 'node:crypto';
import type { EmailStatus } from '../../shared/api.js';
import { pool, type Queryable } from '../db.js';
import { deliver, type Message } from './smtp.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatUtcExpiry(at: Date): string {
  const day = at.getUTCDate();
  const month = MONTHS[at.getUTCMonth()] ?? '';
  const hours = String(at.getUTCHours()).padStart(2, '0');
  const minutes = String(at.getUTCMinutes()).padStart(2, '0');
  return `${day} ${month} ${at.getUTCFullYear()}, ${hours}:${minutes} UTC`;
}

export interface MailTarget {
  recipientUserId?: string | null;
  inviteId?: string;
  memberProjectId?: string;
  memberUserId?: string;
  linkId?: string;
}

export async function enqueue(
  client: Queryable,
  message: Message,
  target: MailTarget = {},
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `insert into outbox (id, to_email, subject, body, state, recipient_user_id,
                         invite_id, member_project_id, member_user_id, link_id)
     values ($1, $2, $3, $4, 'queued', $5, $6, $7, $8, $9)`,
    [
      id,
      message.to,
      message.subject,
      message.body,
      target.recipientUserId ?? null,
      target.inviteId ?? null,
      target.memberProjectId ?? null,
      target.memberUserId ?? null,
      target.linkId ?? null,
    ],
  );
  return id;
}

async function markSent(id: string): Promise<void> {
  const { rows } = await pool.query<{
    invite_id: string | null;
    member_project_id: string | null;
    member_user_id: string | null;
    link_id: string | null;
  }>(
    `update outbox set state = 'sent', claimed_at = null where id = $1 and state = 'queued'
     returning invite_id, member_project_id, member_user_id, link_id`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) return;
  if (row.invite_id !== null) {
    await pool.query(`update invites set email_status = 'sent' where id = $1`, [row.invite_id]);
  }
  if (row.member_project_id !== null && row.member_user_id !== null) {
    await pool.query(
      `update memberships set email_status = 'sent' where project_id = $1 and user_id = $2`,
      [row.member_project_id, row.member_user_id],
    );
  }
  if (row.link_id !== null) {
    await pool.query(`update reviewer_links set email_status = 'sent' where id = $1`, [row.link_id]);
  }
}

/** Attempts one queued message straight away and reports the resulting status. */
export async function attempt(id: string, message: Message): Promise<EmailStatus> {
  try {
    await deliver(message);
  } catch {
    await pool.query(
      `update outbox set next_attempt_at = now() + interval '5 seconds' where id = $1`,
      [id],
    );
    return 'queued';
  }
  await markSent(id);
  return 'sent';
}

/** Retries queued messages, with each one claimed by a single instance at a time. */
export async function flushQueuedMail(): Promise<void> {
  const { rows } = await pool.query<{ id: string; to_email: string; subject: string; body: string }>(
    `update outbox set claimed_at = now()
      where id in (
        select id from outbox
         where state = 'queued' and next_attempt_at <= now()
           and (claimed_at is null or claimed_at < now() - interval '60 seconds')
         order by created_at
         for update skip locked
         limit 20
      )
      returning id, to_email, subject, body`,
  );
  for (const row of rows) {
    try {
      await deliver({ to: row.to_email, subject: row.subject, body: row.body });
      await markSent(row.id);
    } catch {
      await pool.query(
        `update outbox set claimed_at = null, next_attempt_at = now() + interval '5 seconds'
          where id = $1`,
        [row.id],
      );
    }
  }
}
