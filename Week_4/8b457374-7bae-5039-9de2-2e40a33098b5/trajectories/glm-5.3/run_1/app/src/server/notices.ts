import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Config } from "./config.js";
import type { MailClient } from "./mail.js";
import { formatPence } from "../shared/money.js";
import { newId } from "./ids.js";

// Every notice is recorded in the campaign's notice ledger and is sent exactly
// once, within 10 seconds of becoming due while mail is up. When SMTP is
// unreachable the notice stays queued and the triggering action still succeeds.

export type NoticeKind =
  | "pledge_receipt"
  | "pledge_cancelled"
  | "funded_charged"
  | "not_funded"
  | "campaign_cancelled"
  | "fix_payment"
  | "dropped"
  | "settlement_ready";

interface NoticeInput {
  campaignId: string;
  pledgeId: string | null;
  kind: NoticeKind;
  to: string;
  campaignTitle: string;
  amountPence?: number;
  fixCode?: string;
}

export interface NoticeRow {
  id: string;
  kind: string;
  to_email: string;
  subject: string;
  status: "queued" | "sent";
  created_at: Date;
  sent_at: Date | null;
}

export class NoticeService {
  private readonly pool: Pool;
  private readonly config: Config;
  private readonly mail: MailClient;

  constructor(pool: Pool, config: Config, mail: MailClient) {
    this.pool = pool;
    this.config = config;
    this.mail = mail;
  }

  private subjectFor(kind: NoticeKind, title: string): string {
    switch (kind) {
      case "pledge_receipt":
        return `Pledge held: ${title}`;
      case "pledge_cancelled":
        return `Pledge cancelled: ${title}`;
      case "funded_charged":
        return `Funded and charged: ${title}`;
      case "not_funded":
        return `Not funded, card released: ${title}`;
      case "campaign_cancelled":
        return `Campaign cancelled: ${title}`;
      case "fix_payment":
        return `Fix your payment: ${title}`;
      case "dropped":
        return `Pledge dropped: ${title}`;
      case "settlement_ready":
        return `Settlement ready: ${title}`;
    }
  }

  private bodyFor(input: NoticeInput): string {
    const amount =
      input.amountPence === undefined ? "" : ` ${formatPence(input.amountPence)}.`;
    switch (input.kind) {
      case "pledge_receipt":
        return (
          `Your pledge on "${input.campaignTitle}" is held.\n\n` +
          `Amount:${amount} Your card is held, not charged.\n` +
          `You are charged only if the run is funded.`
        );
      case "pledge_cancelled":
        return `Your pledge on "${input.campaignTitle}" was cancelled.\n\nAmount held:${amount}\nThe hold on your card was released.`;
      case "funded_charged":
        return `The run "${input.campaignTitle}" was funded.\n\nYour card was charged.\nAmount:${amount}\nA statement is on its way.`;
      case "not_funded":
        return `The run "${input.campaignTitle}" did not reach its goal.\n\nYour card was not charged and the hold of${amount} was released.`;
      case "campaign_cancelled":
        return `The creator cancelled the run "${input.campaignTitle}".\n\nYour card was not charged and the hold of${amount} was released.`;
      case "fix_payment": {
        const link = `${this.config.appPublicUrl}/fix/${input.fixCode}`;
        return (
          `The collection of your pledge on "${input.campaignTitle}" failed.\n\n` +
          `Amount:${amount}\n` +
          `Update your card before the fix window closes:\n\n${link}`
        );
      }
      case "dropped":
        return `The fix window for your pledge on "${input.campaignTitle}" has closed without a successful collection.\n\nAmount:${amount}\nYour pledge was dropped and every hold was released.`;
      case "settlement_ready":
        return `The settlement sheet for "${input.campaignTitle}" is ready to download in your Studio.`;
    }
  }

  private dedupeKey(input: NoticeInput): string {
    const parts = [input.kind, input.campaignId, input.to];
    if (input.pledgeId !== null) parts.push(input.pledgeId);
    return parts.join(":");
  }

  async record(input: NoticeInput, dedupeKey: string | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO notices (id, campaign_id, pledge_id, kind, to_email, subject, body, status, due_at, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', now(), $8)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [
        newId("ntc"),
        input.campaignId,
        input.pledgeId,
        input.kind,
        input.to,
        this.subjectFor(input.kind, input.campaignTitle),
        this.bodyFor(input),
        dedupeKey ?? `${randomUUID()}`,
      ],
    );
  }

  async recordPledgeReceipt(input: NoticeInput): Promise<void> {
    await this.record(input, this.dedupeKey(input));
  }

  /** Sends every due queued notice. Called by the worker loop. */
  async dispatchDue(): Promise<void> {
    const due = await this.pool.query<{ id: string; to_email: string; subject: string; body: string }>(
      `SELECT id, to_email, subject, body FROM notices
       WHERE status = 'queued' AND due_at <= now()
       ORDER BY created_at ASC
       LIMIT 50`,
    );
    for (const notice of due.rows) {
      const sent = await this.mail.send(notice.to_email, notice.subject, notice.body);
      if (sent) {
        await this.pool.query(
          `UPDATE notices SET status = 'sent', sent_at = now() WHERE id = $1`,
          [notice.id],
        );
      } else {
        // Mail is down: the notice stays queued and is retried on the next tick.
        await this.pool.query(
          `UPDATE notices SET due_at = now() + interval '10 seconds' WHERE id = $1`,
          [notice.id],
        );
        return;
      }
    }
  }
}
