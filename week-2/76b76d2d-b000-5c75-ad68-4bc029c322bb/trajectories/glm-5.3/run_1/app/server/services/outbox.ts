import { DateTime } from 'luxon';
import type { PoolClient } from 'pg';
import { query, withTransaction } from './database';
import type { MailService } from './mail';
import type { Config } from '../config';
import { isoMs } from '../time';

export interface EnqueueInput {
  messageKey: string;
  kind: string;
  to: string;
  subject: string;
  bodyText: string;
  html: string;
  locale: 'en' | 'fr';
}

export interface OutboxRow {
  seq: string;
  message_key: string;
  kind: string;
  to_email: string;
  subject: string;
  state: 'pending' | 'sent' | 'dead';
  enqueued_at: string;
  attempts: number;
}

/** The published retry ladder: first retry after 5s, then 15s, then 45s, then every 60s. */
export function retryDelaySeconds(attemptNumber: number): number {
  if (attemptNumber <= 1) return 5;
  if (attemptNumber === 2) return 15;
  if (attemptNumber === 3) return 45;
  return 60;
}

export const maxAttempts = 20;

/**
 * The mail outbox: enqueued in the same commit as its business event, delivered
 * oldest-first by the instance that enqueued it, with the published retry schedule.
 */
export class OutboxService {
  private readonly cfg: Config;
  private readonly mail: MailService;
  private readonly instanceId: number;
  private running = false;
  private busy = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(cfg: Config, mail: MailService) {
    this.cfg = cfg;
    this.mail = mail;
    this.instanceId = cfg.port;
  }

  /** Enqueue inside the caller's transaction. A repeated key is a no-op. */
  enqueueInTx(client: PoolClient, input: EnqueueInput): void {
    client.query(
      `INSERT INTO outbox (message_key, kind, to_email, subject, body_text, html, locale, state, enqueued_at, instance_id, attempts, next_attempt_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',now(),$8,0,NULL)
       ON CONFLICT (message_key) DO NOTHING`,
      [input.messageKey, input.kind, input.to, input.subject, input.bodyText, input.html, input.locale, this.instanceId],
    );
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = () => { void this.deliverPending(); };
    this.timer = setInterval(tick, 500);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }

  /** The head is tried first; nothing newer is tried until it is sent or dead. */
  private async deliverPending(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        const head = await this.findHead();
        if (!head) return;
        if (head.attempts > 0) {
          const nextAt = DateTime.fromISO(head.next_attempt_at as unknown as string);
          if (nextAt > DateTime.now()) return;
        }
        const sent = await this.attempt(head.seq);
        if (!sent) return;
      }
    } finally {
      this.busy = false;
    }
  }

  private async findHead(): Promise<(OutboxRow & { next_attempt_at: string | null }) | null> {
    const res = await query<OutboxRow & { next_attempt_at: string | null }>(
      `SELECT seq::text AS seq, message_key, kind, to_email, subject, state,
              enqueued_at, attempts, next_attempt_at
       FROM outbox
       WHERE state = 'pending' AND instance_id = $1
       ORDER BY enqueued_at, seq
       LIMIT 1`,
      [this.instanceId],
    );
    return res.rows[0] ?? null;
  }

  private async attempt(seq: string): Promise<boolean> {
    const startedAt = DateTime.now();
    let outcome: 'sent' | 'failed' = 'failed';
    let sentOk = false;
    try {
      const row = await query<{
        message_key: string; to_email: string; subject: string;
        body_text: string; html: string;
      }>(
        `SELECT message_key, to_email, subject, body_text, html FROM outbox WHERE seq = $1`,
        [seq],
      );
      const msg = row.rows[0];
      if (!msg) return false;
      await this.mail.send({
        to: msg.to_email,
        subject: msg.subject,
        text: msg.body_text,
        html: msg.html,
        messageKey: msg.message_key,
      });
      outcome = 'sent';
      sentOk = true;
    } catch {
      outcome = 'failed';
    }
    const finishedAt = DateTime.now();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO outbox_attempts (seq, started_at, finished_at, outcome) VALUES ($1,$2,$3,$4)`,
        [seq, startedAt.toUTC().toISO(), finishedAt.toUTC().toISO(), outcome],
      );
      if (sentOk) {
        await client.query(
          `UPDATE outbox SET state='sent', sent_at=now(), attempts=attempts+1 WHERE seq=$1`,
          [seq],
        );
      } else {
        const current = await client.query<{ attempts: number }>(
          'SELECT attempts FROM outbox WHERE seq=$1 FOR UPDATE',
          [seq],
        );
        const attempts = (current.rows[0]?.attempts ?? 0) + 1;
        if (attempts >= maxAttempts) {
          await client.query(
            `UPDATE outbox SET state='dead', attempts=$2, last_attempt_at=now() WHERE seq=$1`,
            [seq, attempts],
          );
        } else {
          const delay = retryDelaySeconds(attempts);
          await client.query(
            `UPDATE outbox SET attempts=$2, last_attempt_at=now(), next_attempt_at=now() + ($3 || ' seconds')::interval WHERE seq=$1`,
            [seq, attempts, String(delay)],
          );
        }
      }
    });
    return sentOk;
  }

  /** The state of the newest message whose key starts with this prefix. */
  async messageState(keyPrefix: string): Promise<'pending' | 'sent' | 'dead' | null> {
    const res = await query<{ state: string }>(
      `SELECT state FROM outbox WHERE message_key LIKE $1 || '%' ORDER BY seq DESC LIMIT 1`,
      [keyPrefix],
    );
    const row = res.rows[0];
    return row ? (row.state as 'pending' | 'sent' | 'dead') : null;
  }

  /** All outbox messages, newest seq order, for the finance console. */
  async list(): Promise<OutboxMessageView[]> {
    const res = await query<{
      seq: string; message_key: string; kind: string; to_email: string; subject: string;
      state: string; enqueued_at: string;
    }>(
      `SELECT seq::text AS seq, message_key, kind, to_email, subject, state, enqueued_at
       FROM outbox ORDER BY seq DESC LIMIT 200`,
    );
    const views: OutboxMessageView[] = [];
    for (const r of res.rows) {
      const attempts = await query<{ started_at: string; finished_at: string; outcome: string }>(
        `SELECT started_at, finished_at, outcome FROM outbox_attempts
         WHERE seq = $1 ORDER BY id`,
        [r.seq],
      );
      views.push({
        seq: Number(r.seq),
        key: r.message_key,
        kind: r.kind,
        to: r.to_email,
        subject: r.subject,
        enqueued_at: isoMs(DateTime.fromISO(r.enqueued_at)),
        state: r.state as 'pending' | 'sent' | 'dead',
        attempts: attempts.rows.map((a: { started_at: string; finished_at: string; outcome: string }) => ({
          started_at: isoMs(DateTime.fromISO(a.started_at)),
          finished_at: isoMs(DateTime.fromISO(a.finished_at)),
          outcome: a.outcome as 'failed' | 'sent',
        })),
      });
    }
    return views;
  }
}

export interface OutboxAttemptView {
  started_at: string;
  finished_at: string;
  outcome: 'failed' | 'sent';
}

export interface OutboxMessageView {
  seq: number;
  key: string;
  kind: string;
  to: string;
  subject: string;
  enqueued_at: string;
  state: 'pending' | 'sent' | 'dead';
  attempts: OutboxAttemptView[];
}
