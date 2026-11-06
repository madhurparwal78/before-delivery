import type { Locale } from '../../shared/money.ts';
import { OUTBOX_BACKOFF_SECONDS, OUTBOX_BACKOFF_TAIL_SECONDS, OUTBOX_MAX_ATTEMPTS } from '../../shared/domain.ts';
import { env, mailFromDomain } from '../env.ts';
import { probeSmtp, sendMail } from './smtp.ts';
import { query } from '../db/pool.ts';
import type { Tx } from '../db/pool.ts';
import { mailState, setMail } from '../services.ts';

export type OutboxMessage = {
  key: string;
  kind: string;
  to: string;
  subject: string;
  lines: string[];
  locale: Locale;
};

export async function enqueueMail(tx: Tx, message: OutboxMessage): Promise<void> {
  await tx.query(
    `insert into outbox(message_key, instance_port, kind, recipient, subject, body, locale, state, next_attempt_at)
     values($1,$2,$3,$4,$5,$6,$7,'pending', now())
     on conflict (message_key) do nothing`,
    [message.key, env.port, message.kind, message.to, message.subject, message.lines.join('\n'), message.locale],
  );
}

export async function nextMailSequence(tx: Tx, prefix: string): Promise<number> {
  const row = await tx.one<{ count: number }>(
    'select count(*)::int as count from outbox where message_key like $1',
    [`${prefix}%`],
  );
  return (row?.count ?? 0) + 1;
}

/** The published retry schedule: 5, 15, 45 seconds after the previous failure, then every 60. */
export function retryDelaySeconds(failedAttempts: number): number {
  return OUTBOX_BACKOFF_SECONDS[failedAttempts - 1] ?? OUTBOX_BACKOFF_TAIL_SECONDS;
}

function htmlOf(lines: string[]): string {
  const escape = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<html><body>${lines.map((line) => `<p>${escape(line)}</p>`).join('')}</body></html>`;
}

async function deliver(row: {
  seq: number;
  message_key: string;
  recipient: string;
  subject: string;
  body: string;
  attempt_count: number;
}): Promise<void> {
  const startedAt = new Date();
  const lines = row.body.split('\n');
  try {
    await sendMail({
      to: row.recipient,
      subject: row.subject,
      text: `${lines.join('\n')}\n`,
      html: htmlOf(lines),
      headers: { 'X-Halide-Message-Key': row.message_key },
      messageId: `<${row.message_key.replace(/[^A-Za-z0-9:._-]/g, '-')}.${startedAt.getTime()}@${mailFromDomain}>`,
    });
    setMail('up');
    await query(
      `update outbox set state='sent', attempt_count = attempt_count + 1 where seq = $1`,
      [row.seq],
    );
    await query(
      `insert into outbox_attempts(outbox_seq, started_at, finished_at, outcome) values($1,$2,now(),'sent')`,
      [row.seq, startedAt.toISOString()],
    );
  } catch {
    setMail('down');
    const attempts = row.attempt_count + 1;
    await query(
      `update outbox set attempt_count = $2,
         next_attempt_at = now() + make_interval(secs => $3::int),
         state = $4
       where seq = $1`,
      [row.seq, attempts, retryDelaySeconds(attempts), attempts >= OUTBOX_MAX_ATTEMPTS ? 'dead' : 'pending'],
    );
    await query(
      `insert into outbox_attempts(outbox_seq, started_at, finished_at, outcome) values($1,$2,now(),'failed')`,
      [row.seq, startedAt.toISOString()],
    );
  }
}

let draining = false;

async function drainHead(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const head = await query<{
      seq: number;
      message_key: string;
      recipient: string;
      subject: string;
      body: string;
      attempt_count: number;
      due: boolean;
    }>(
      `select seq, message_key, recipient, subject, body, attempt_count, next_attempt_at <= now() as due
         from outbox where instance_port = $1 and state = 'pending'
         order by enqueued_at asc, seq asc limit 1`,
      [env.port],
    );
    const row = head[0];
    if (row === undefined || !row.due) return;
    await deliver(row);
  } finally {
    draining = false;
  }
}

/** Gives the head one immediate attempt, then reports whether the named message was delivered. */
export async function attemptNow(messageKey: string): Promise<'sent' | 'queued'> {
  await drainHead();
  const row = await query<{ state: string }>('select state from outbox where message_key = $1', [messageKey]);
  return row[0]?.state === 'sent' ? 'sent' : 'queued';
}

export async function probeMail(): Promise<void> {
  const before = mailState();
  const reachable = await probeSmtp();
  setMail(reachable ? 'up' : 'down');
  if (reachable && before === 'down') {
    await query(
      `update outbox set next_attempt_at = now() where instance_port = $1 and state = 'pending'`,
      [env.port],
    );
  }
}

export function startOutboxWorker(): void {
  setInterval(() => {
    void drainHead().catch(() => undefined);
  }, 500);
  setInterval(() => {
    void probeMail().catch(() => undefined);
  }, 5000);
  void probeMail().catch(() => undefined);
}
