/** The mail outbox: rows are written with their cause, sent after commit, and retried until sent exactly once. */
import { formatClock, formatDate } from '../shared/format';
import { inviteSubject, noticeSubject } from '../shared/messages';
import type { Role } from '../shared/types';
import { config } from './config';
import { pool, query, type Queryable } from './db';
import { now } from './clock';
import { sendMail } from './smtp';

type MailKind = 'invite' | 'publish';

interface OutboxMail {
  kind: MailKind;
  /** The invite id, or `<version number>` for a publish notice. */
  ref: string;
  projectId: string;
  to: string;
  subject: string;
  body: string;
}

const RETRY_MS = 10_000;
const REQUEST_SEND_TIMEOUT_MS = 3000;

export function inviteMail(input: {
  inviteId: string;
  projectId: string;
  projectName: string;
  inviter: string;
  email: string;
  role: Role;
  token: string;
  expiresAt: Date;
}): OutboxMail {
  const iso = input.expiresAt.toISOString();
  return {
    kind: 'invite',
    ref: input.inviteId,
    projectId: input.projectId,
    to: input.email,
    subject: inviteSubject(input.projectName),
    body: [
      `${input.inviter} invited you to ${input.projectName} in Halation Studio as ${input.role}.`,
      '',
      `Accept the invite: ${config.publicUrl}/invite/${input.token}`,
      '',
      `This link works once and expires on ${formatDate(iso, config.timeZone)} at ${formatClock(iso, config.timeZone)}.`,
    ].join('\n'),
  };
}

export function publishMail(input: { projectId: string; projectName: string; version: number; publisher: string; to: string }): OutboxMail {
  return {
    kind: 'publish',
    ref: String(input.version),
    projectId: input.projectId,
    to: input.to,
    subject: noticeSubject(input.projectName, input.version),
    body: [`${input.publisher} published version ${input.version} of ${input.projectName}.`, '', `Open the project: ${config.publicUrl}/projects/${input.projectId}`].join('\n'),
  };
}

/** Writes mail rows inside the caller's transaction and returns their ids. */
export async function enqueue(client: Queryable, mails: readonly OutboxMail[]): Promise<number[]> {
  const created = (await now(client)).toISOString();
  const ids: number[] = [];
  for (const mail of mails) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO outbox (kind, ref, project_id, to_email, subject, body, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [mail.kind, mail.ref, mail.projectId, mail.to, mail.subject, mail.body, created],
    );
    ids.push(Number((result.rows[0] as { id: string }).id));
  }
  return ids;
}

/** Claims one queued row and sends it. A row another copy holds, or one already sent, is skipped. */
async function deliver(id: number, timeoutMs: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query<{ to_email: string; subject: string; body: string }>(
      `SELECT to_email, subject, body FROM outbox WHERE id = $1 AND status = 'queued' FOR UPDATE SKIP LOCKED`,
      [id],
    );
    const row = claimed.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return;
    }
    try {
      await sendMail(config.smtp, { from: config.mailFrom, to: row.to_email, subject: row.subject, text: row.body }, timeoutMs);
    } catch {
      await client.query(`UPDATE outbox SET attempts = attempts + 1 WHERE id = $1`, [id]);
      await client.query('COMMIT');
      return;
    }
    await client.query(`UPDATE outbox SET status = 'sent', sent_at = $2, attempts = attempts + 1 WHERE id = $1`, [id, (await now(client)).toISOString()]);
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK').catch(() => undefined);
  } finally {
    client.release();
  }
}

/** Tries to send freshly written rows once, so a working Mailpit shows `sent` straight away. */
export async function deliverNow(ids: readonly number[]): Promise<void> {
  await Promise.all(ids.map((id) => deliver(id, REQUEST_SEND_TIMEOUT_MS)));
}

async function retryQueued(): Promise<void> {
  const rows = await query<{ id: string }>(`SELECT id FROM outbox WHERE status = 'queued' ORDER BY id`);
  for (const row of rows) await deliver(Number(row.id), REQUEST_SEND_TIMEOUT_MS);
}

/** Starts the retry loop of this copy: every queued row is tried again every 10 seconds. */
export function startOutbox(): void {
  setInterval(() => {
    void retryQueued().catch(() => undefined);
  }, RETRY_MS).unref();
}

/** SQL for whether any mail of one cause (a kind, a ref and a project) is still queued. */
export const queuedMailSql = (kind: MailKind, ref: string, projectId: string): string =>
  `COALESCE((SELECT bool_or(o.status = 'queued') FROM outbox o WHERE o.kind = '${kind}' AND o.ref = ${ref} AND o.project_id = ${projectId}), false)`;

/** `sent` or `queued` for the mail of one cause. */
export async function mailState(kind: MailKind, ref: string, projectId: string): Promise<'sent' | 'queued'> {
  const rows = await query<{ queued: boolean }>(`SELECT ${queuedMailSql(kind, '$1', '$2')} AS queued`, [ref, projectId]);
  return rows[0]?.queued ? 'queued' : 'sent';
}
