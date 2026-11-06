// The outbox: every customer email is a notice with a unique key. The sender
// keeps a strictly ordered drain, retries on the 5/15/45-second schedule, and
// guarantees at most one delivery per key across retries, resends and recovery.
import { Pool, type PoolClient } from "pg";
import type { Env } from "../core/env.js";
import { sendMail, pingMail } from "./mail.js";

export type NoticeKind =
  | "stepup_code"
  | "order_confirmation"
  | "subscription_started"
  | "refund"
  | "credit"
  | "contact_reply";

export const RETRY_DELAYS_SECONDS = [5, 15, 45];
export const MAX_ATTEMPTS = 4;
export const DASH_LINE = "----------";

export interface QueueNotice {
  key: string;
  kind: NoticeKind;
  to: string;
  locale: "fr-CA" | "en-CA";
  subjectEn: string;
  subjectFr: string;
  linesEn: string[];
  linesFr: string[];
}

interface NoticeRow {
  number: string;
  key: string;
  to_email: string;
  locale: "fr-CA" | "en-CA";
  subject: string;
  body: string;
  status: "queued" | "retrying" | "sent" | "failed";
  enqueued_at: Date;
  attempts: { at: string; outcome: "sent" | "failed" }[];
}

/** Compose the wire body: the customer's locale, then ten hyphens, then the other. */
function composeBody(notice: QueueNotice): string {
  const customerFirst = notice.locale === "fr-CA";
  const first = customerFirst ? notice.linesFr : notice.linesEn;
  const second = customerFirst ? notice.linesEn : notice.linesFr;
  return [...first, DASH_LINE, ...second].join("\n");
}

/** Queue a notice in the caller's transaction, taking its number in the same unit. */
export async function queueNotice(client: PoolClient, notice: QueueNotice): Promise<void> {
  const res = await client.query(
    "UPDATE counters SET value = value + 1 WHERE name = 'notice' RETURNING value"
  );
  const number = `NT-${String(res.rows[0].value).padStart(6, "0")}`;
  const subject = notice.locale === "fr-CA" ? notice.subjectFr : notice.subjectEn;
  await client.query(
    `INSERT INTO notices (number, key, kind, to_email, locale, subject, body, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued')
     ON CONFLICT (key) DO NOTHING`,
    [number, notice.key, notice.kind, notice.to, notice.locale, subject, composeBody(notice)]
  );
}

export class Outbox {
  private draining = false;
  private kickAgain = false;
  private timer: NodeJS.Timeout | null = null;
  private wasDown = false;
  mailUp = true;
  lastCheckedAt: Date | null = null;

  constructor(private env: Env, private pool: Pool) {}

  /** Check the mail server and drain everything that is due. */
  async tick(): Promise<void> {
    try {
      const up = await pingMail(this.env);
      this.lastCheckedAt = new Date();
      if (up) {
        this.mailUp = true;
        if (this.wasDown) {
          this.wasDown = false;
          await this.drain(true);
        } else {
          await this.drain(false);
        }
      } else {
        this.mailUp = false;
        this.wasDown = true;
      }
    } catch {
      this.mailUp = false;
      this.wasDown = true;
    }
  }

  /** Kick the outbox after an event queued a notice, for the first attempt inside 2 seconds. */
  kick(): void {
    if (this.draining) {
      this.kickAgain = true;
      return;
    }
    void this.drain(false);
  }

  private schedule(ms: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain(false);
    }, ms);
  }

  /** Send due notices one at a time, strictly oldest first. */
  private async drain(forceDue: boolean): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (;;) {
        const notice = await this.nextDue();
        if (!notice) return;
        if (forceDue) {
          await this.attempt(notice);
          continue;
        }
        const waitMs = this.waitMs(notice);
        if (waitMs > 0) {
          this.schedule(Math.min(waitMs, 5_000));
          return;
        }
        await this.attempt(notice);
      }
    } finally {
      this.draining = false;
      if (this.kickAgain) {
        this.kickAgain = false;
        void this.drain(false);
      }
    }
  }

  private async nextDue(): Promise<NoticeRow | null> {
    const res = await this.pool.query(
      `SELECT number, key, to_email, locale, subject, body, status, enqueued_at, attempts
       FROM notices WHERE status IN ('queued', 'retrying')
       ORDER BY enqueued_at ASC, number ASC
       LIMIT 1`
    );
    return (res.rows[0] as NoticeRow | undefined) ?? null;
  }

  private waitMs(notice: NoticeRow): number {
    if (notice.status === "queued" || notice.attempts.length === 0) return 0;
    const last = new Date(notice.attempts[notice.attempts.length - 1].at).getTime();
    const delayIndex = Math.min(notice.attempts.length - 1, RETRY_DELAYS_SECONDS.length - 1);
    const due = last + RETRY_DELAYS_SECONDS[delayIndex] * 1000;
    return Math.max(0, due - Date.now());
  }

  private async attempt(notice: NoticeRow): Promise<void> {
    const at = new Date();
    let outcome: "sent" | "failed";
    try {
      await sendMail(this.env, {
        to: notice.to_email,
        fromAddress: this.env.mailFromAddress,
        fromLine: this.env.mailFrom,
        messageId: `${notice.key}@paindelune.example`,
        subject: notice.subject,
        body: notice.body
      });
      outcome = "sent";
      this.mailUp = true;
    } catch {
      outcome = "failed";
      this.mailUp = false;
      this.wasDown = true;
    }
    const attempts = [...notice.attempts, { at: at.toISOString(), outcome }];
    const status: NoticeRow["status"] =
      outcome === "sent" ? "sent" : attempts.length >= MAX_ATTEMPTS ? "failed" : "retrying";
    await this.pool.query(
      "UPDATE notices SET status = $2, attempts = $3 WHERE number = $1",
      [notice.number, status, JSON.stringify(attempts)]
    );
  }

  /** Resend a failed notice: exactly one of N simultaneous calls succeeds. */
  async resend(number: string): Promise<NoticeRow | null> {
    const res = await this.pool.query(
      `UPDATE notices
       SET status = 'queued', attempts = '[]', enqueued_at = now()
       WHERE number = $1 AND status = 'failed'
       RETURNING number, key, to_email, locale, subject, body, status, enqueued_at, attempts`,
      [number]
    );
    const row = res.rows[0] as NoticeRow | undefined;
    if (!row) return null;
    this.kick();
    return row;
  }
}
