import { AppConfig } from "./config.js";
import { Database } from "./database.js";
import { Mailer, SmtpUnreachable } from "./mailer.js";

export type MailKind = "receipt" | "alert" | "proposal" | "month_held" | "deposit";
export const MAIL_KINDS: readonly MailKind[] = ["receipt", "alert", "proposal", "month_held", "deposit"];
export interface QueuedMailInput {
  enquiryId: string;
  kind: MailKind;
  recipient: string;
  subject: string;
  body: string;
  from: string;
  replyTo?: string;
}
/**
 * Renders an email once, at queue time. The full message, headers and body, is
 * stored in the row; later edits to settings never change it (DP-51, DP: Mail
 * queue).
 */
export function renderMessage(input: QueuedMailInput): string {
  const headers: string[] = [
    `From: ${input.from}`,
    `To: ${input.recipient}`,
  ];
  if (input.replyTo) {
    headers.push(`Reply-To: ${input.replyTo}`);
  }
  headers.push(`Subject: ${encodeHeaderValue(input.subject)}`);
  headers.push("MIME-Version: 1.0");
  headers.push('Content-Type: text/plain; charset="utf-8"');
  headers.push("Content-Transfer-Encoding: 8bit");
  headers.push("Date: " + new Date().toUTCString());
  return `${headers.join("\r\n")}\r\n\r\n${input.body}`;
}
function encodeHeaderValue(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) {
    return foldAsciiHeader(value);
  }
  // RFC 2047 B-encoding keeps the decoded subject exact.
  const encoded = `=?utf-8?b?${Buffer.from(value, "utf-8").toString("base64")}?=`;
  return encoded;
}
function foldAsciiHeader(value: string): string {
  return value.replace(/\r?\n/g, " ");
}
/**
 * The outbound mail queue (DP-36, DP-60, DP-66). Holds, claims and retries all
 * live in PostgreSQL so every instance shares them.
 */
export class MailQueue {
  private timer: NodeJS.Timeout | null = null;
  private readonly retrySeconds: number;
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly mailer: Mailer,
    private readonly config: AppConfig,
  ) {
    this.retrySeconds = config.mailRetrySeconds;
  }

  async queue(input: QueuedMailInput): Promise<void> {
    const message = renderMessage(input);
    await this.db.query(
      `INSERT INTO mail_queue (enquiry_id, kind, message, recipient, state)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (enquiry_id, kind) DO NOTHING`,
      [input.enquiryId, input.kind, message, bareAddressOf(input.recipient)],
    );
  }

  /**
   * Tries to deliver a freshly queued row straight away. The first failed
   * attempt sets the hold (DP: Business rules).
   */
  async tryDeliverNewlyQueued(enquiryId: string, kind: MailKind): Promise<"sent" | "pending"> {
    const rows = await this.db.query<{ id: bigint }>(
      `SELECT id FROM mail_queue WHERE enquiry_id = $1 AND kind = $2 AND state = 'pending'`,
      [enquiryId, kind],
    );
    if (rows.length === 0) return "pending";
    const claimed = await this.claim(rows[0].id);
    if (!claimed) return "pending";
    return this.attemptDelivery(claimed);
  }

  private async claim(id: bigint): Promise<QueuedRow | null> {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // The claim is conditional on the row still being pending and unclaimed,
    // so two instances never deliver the same row.
    const rows = await this.db.query<QueuedRow>(
      `UPDATE mail_queue
         SET claim_token = $2, claim_expires_at = now() + interval '30 seconds'
       WHERE id = $1 AND state = 'pending' AND (claim_token IS NULL OR claim_token = '')
       RETURNING id, enquiry_id, kind, message, recipient, first_attempt_at, retry_at`,
      [id, token],
    );
    if (rows.length === 0) return null;
    return { ...rows[0], claim_token: token };
  }

  /** Claims any due row. A row is due once its hold has ended. */
  private async claimDueRow(): Promise<QueuedRow | null> {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const rows = await this.db.query<QueuedRow>(
      `UPDATE mail_queue
         SET claim_token = $1, claim_expires_at = now() + interval '30 seconds'
       WHERE id = (
         SELECT id FROM mail_queue
          WHERE state = 'pending'
            AND (retry_at IS NULL OR retry_at <= now())
            AND (claim_token IS NULL OR claim_token = '')
         ORDER BY id ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
       RETURNING id, enquiry_id, kind, message, recipient, first_attempt_at, retry_at`,
      [token],
    );
    if (rows.length === 0) return null;
    return { ...rows[0], claim_token: token };
  }

  private async attemptDelivery(row: QueuedRow): Promise<"sent" | "pending"> {
    const token = row.claim_token as string;
    // Cancellation rule (DP-60): a claimed proposal email checks the enquiry
    // and the accept-link expiry at the moment of sending.
    if (row.kind === "proposal") {
      const cancelled = await this.proposalEmailCancelled(row.enquiry_id);
      if (cancelled) {
        await this.markCancelled(row.id, token);
        return "pending";
      }
    }
    const first = row.first_attempt_at === null;
    try {
      await this.mailer.send(row.message, envelopeFrom());
      await this.markSent(row.id, token);
      return "sent";
    } catch (error) {
      if (!(error instanceof SmtpUnreachable)) throw error;
      if (first) {
        // Only the first failed attempt sets the hold (DP: Business rules).
        await this.recordFirstFailure(row.id, token);
      } else {
        await this.releaseClaim(row.id, token);
      }
      return "pending";
    }
  }

  private async proposalEmailCancelled(enquiryId: string): Promise<boolean> {
    const rows = await this.db.query<{ status: string; expires_at: string | null; accepted_at: string | null }>(
      `SELECT e.status, p.expires_at, p.accepted_at
         FROM enquiries e
         LEFT JOIN proposals p ON p.enquiry_id = e.id
        WHERE e.id = $1`,
      [enquiryId],
    );
    if (rows.length === 0) return true;
    const row = rows[0];
    if (row.status === "declined") return true;
    if (row.accepted_at) return false;
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return true;
    return false;
  }

  private async markSent(id: bigint, token: string): Promise<void> {
    await this.db.query(
      `UPDATE mail_queue
         SET state = 'sent', sent_at = now(), claim_token = NULL, claim_expires_at = NULL
       WHERE id = $1 AND claim_token = $2`,
      [id, token],
    );
  }

  private async markCancelled(id: bigint, token: string): Promise<void> {
    await this.db.query(
      `UPDATE mail_queue
         SET state = 'cancelled', cancelled_at = now(), claim_token = NULL, claim_expires_at = NULL
       WHERE id = $1 AND claim_token = $2`,
      [id, token],
    );
  }

  private async recordFirstFailure(id: bigint, token: string): Promise<void> {
    await this.db.query(
      `UPDATE mail_queue
         SET first_attempt_at = now(),
             retry_at = now() + make_interval(secs => $2::numeric),
             claim_token = NULL,
             claim_expires_at = NULL
       WHERE id = $1 AND claim_token = $3`,
      [id, this.retrySeconds, token],
    );
  }

  private async releaseClaim(id: bigint, token: string): Promise<void> {
    await this.db.query(
      `UPDATE mail_queue SET claim_token = NULL, claim_expires_at = NULL
       WHERE id = $1 AND claim_token = $2`,
      [id, token],
    );
  }

  /** Marks a pending proposal email cancelled in the same step as a decline. */
  async cancelProposalEmail(enquiryId: string): Promise<void> {
    await this.db.query(
      `UPDATE mail_queue
         SET state = 'cancelled', cancelled_at = now(), claim_token = NULL, claim_expires_at = NULL
       WHERE enquiry_id = $1 AND kind = 'proposal' AND state = 'pending'
         AND (claim_token IS NULL OR claim_token = '')`,
      [enquiryId],
    );
  }

  /** Marked cancelled no later than the next attempt that claims the row. */
  async sweepExpiredProposals(): Promise<void> {
    await this.db.query(
      `UPDATE mail_queue
         SET state = 'cancelled', cancelled_at = now(), claim_token = NULL, claim_expires_at = NULL
       WHERE kind = 'proposal'
         AND state = 'pending'
         AND (claim_token IS NULL OR claim_token = '')
         AND enquiry_id IN (
           SELECT e.id FROM enquiries e
             JOIN proposals p ON p.enquiry_id = e.id
            WHERE p.accepted_at IS NULL AND p.expires_at <= now()
         )`,
    );
  }
  async readDeliveryState(enquiryId: string, kind: MailKind): Promise<"sent" | "pending" | "cancelled" | null> {
    const rows = await this.db.query<{ state: string }>(
      `SELECT state FROM mail_queue WHERE enquiry_id = $1 AND kind = $2`,
      [enquiryId, kind],
    );
    if (rows.length === 0) return null;
    return rows[0].state as "sent" | "pending" | "cancelled";
  }
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.retrySeconds * 1000);
    this.timer.unref();
  }
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let index = 0; index < 20; index += 1) {
        const row = await this.claimDueRow();
        if (!row) break;
        await this.attemptDelivery(row);
      }
    } catch {
      // The next tick retries; mail rows keep their state.
    } finally {
      this.running = false;
    }
  }

  async listPending(): Promise<
    Array<{ id: number; kind: MailKind; reference: string; to: string; queued_at: string; retry_at: string | null }>
  > {
    return this.db.query(
      `SELECT q.id, q.kind, e.reference, q.recipient AS to, q.queued_at, q.retry_at
         FROM mail_queue q
         JOIN enquiries e ON e.id = q.enquiry_id
        WHERE q.state = 'pending'
          AND NOT (q.kind = 'proposal' AND e.status = 'declined')
          AND NOT (q.kind = 'proposal' AND EXISTS (
                SELECT 1 FROM proposals p
                 WHERE p.enquiry_id = e.id AND p.accepted_at IS NULL AND p.expires_at <= now()))
        ORDER BY q.queued_at ASC, e.reference ASC,
                 CASE q.kind WHEN 'receipt' THEN 0 WHEN 'alert' THEN 1 WHEN 'proposal' THEN 2 WHEN 'month_held' THEN 3 ELSE 4 END ASC`,
    );
  }
}

interface QueuedRow {
  id: bigint;
  enquiry_id: string;
  kind: MailKind;
  message: string;
  recipient: string;
  first_attempt_at: string | null;
  retry_at: string | null;
  claim_token: string | null;
}

function bareAddressOf(headerValue: string): string {
  const match = /<([^>]+)>\s*$/.exec(headerValue.trim());
  return match ? match[1] : headerValue.trim();
}

function envelopeFrom(): string {
  // The MAIL_FROM address, as configured; parsed from the environment value.
  const raw = process.env.MAIL_FROM || "";
  const match = /<([^>]+)>\s*$/.exec(raw.trim());
  return match ? match[1] : raw.trim();
}
