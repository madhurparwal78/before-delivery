// Email delivery with background retry for registration and work-assignment
// emails. Final-results emails are never retried here; publishing sends them
// inline as part of its pipeline.
import type { Db } from "../db.js";
import { Mailer, type MailMessage } from "./mailer.js";
import { newId } from "../ids.js";

export interface EmailContext {
  baseUrl: string;
  eventName: string;
}

export class EmailService {
  constructor(
    private db: Db,
    private mailer: Mailer,
  ) {}

  /** Queue a retriable email (registration or work assignment) and try once now. */
  async queue(
    clubId: string,
    kind: "registration" | "assignment",
    to: string,
    subject: string,
    body: string,
    refs: { registrationId?: string; eventId?: string },
  ): Promise<void> {
    const id = newId("eml");
    await this.db.query(
      `INSERT INTO email_deliveries (id, club_id, kind, registration_id, event_id, to_email, subject, body, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
      [id, clubId, kind, refs.registrationId ?? null, refs.eventId ?? null, to, subject, body],
    );
    await this.trySend(id);
  }

  async trySend(deliveryId: string): Promise<boolean> {
    const rows = await this.db.query(`SELECT * FROM email_deliveries WHERE id = $1`, [deliveryId]);
    const row = rows[0];
    if (!row || row.status !== "pending") return row ? row.status === "accepted" : false;
    const message: MailMessage = { to: row.to_email as string, subject: row.subject as string, body: row.body as string };
    const ok = await this.mailer.send(message);
    if (ok) {
      await this.db.query(
        `UPDATE email_deliveries SET status = 'accepted', accepted_at = now(), updated_at = now() WHERE id = $1`,
        [deliveryId],
      );
    } else {
      await this.db.query(
        `UPDATE email_deliveries SET attempts = attempts + 1, updated_at = now() WHERE id = $1`,
        [deliveryId],
      );
    }
    return ok;
  }

  /** Retry loop: every 10 seconds, retry every pending delivery older than its last attempt. */
  startRetryLoop(): NodeJS.Timeout {
    return setInterval(() => {
      void this.retryPending();
    }, 10_000);
  }

  async retryPending(): Promise<void> {
    const rows = await this.db.query(
      `SELECT id FROM email_deliveries
       WHERE status = 'pending' AND (attempts = 0 OR updated_at < now() - interval '10 seconds')`,
    );
    for (const row of rows) await this.trySend(row.id as string);
  }
}

export function resultsEmailBody(baseUrl: string, eventId: string, position: string): string {
  return [
    `Final results are published.`,
    ``,
    `Results PDF: ${baseUrl}/api/events/${eventId}/results.pdf`,
    `Your indexed finish: ${position}`,
  ].join("\n");
}
