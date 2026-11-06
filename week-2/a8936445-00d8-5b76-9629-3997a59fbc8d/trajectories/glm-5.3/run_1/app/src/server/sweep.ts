/**
 * The sweep: expiry reminders, the email queue, pending Kill Bill reversals and seeded
 * document files — each retried every REMINDER_SWEEP_SECONDS until it succeeds.
 */

import type { Db } from "./db.js";
import { writeSeededDocumentFiles } from "./db.js";
import type { Storage } from "./providers/storage.js";
import type { KillBillClient } from "./providers/killbill.js";
import type { Mailer } from "./providers/mail.js";
import { expiryReminderEmail } from "./email.js";
import { resolveTenantStatuses } from "./domain/tenants.js";
import { REQUIRED_KINDS } from "./domain/tenants.js";

const REMINDER_LEAD_DAYS = 14;

export class Sweep {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    readonly db: Db,
    readonly storage: Storage,
    readonly killbill: KillBillClient,
    readonly mailer: Mailer
  ) {}

  start(intervalSeconds: number): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalSeconds * 1000);
    this.timer.unref();
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await resolveTenantStatuses(this.db);
      await this.sendReminders();
      await this.drainEmailQueue();
      await this.retryReversals();
      await writeSeededDocumentFiles(this.db, this.storage);
    } catch (e) {
      console.error("sweep error:", e instanceof Error ? e.message : e);
    } finally {
      this.running = false;
    }
  }

  /**
   * One reminder per approved document within the lead time, and only when no
   * later-expiring approved document of the same kind (and holder) exists.
   */
  private async sendReminders(): Promise<void> {
    const today = this.db.clock.today();
    const docs = await this.db.query<{
      id: string;
      tenant_id: string;
      kind: string;
      holder_name: string | null;
      expires_on: string;
      reminder_sent_at: Date | null;
    }>(
      `SELECT id, tenant_id, kind, holder_name, expires_on::text AS expires_on, reminder_sent_at
       FROM documents WHERE status = 'approved' AND reminder_sent_at IS NULL`
    );
    for (const doc of docs) {
      const lead = new Date(Date.parse(doc.expires_on) - REMINDER_LEAD_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 10);
      if (today < lead || today > doc.expires_on) continue;
      const later = await this.db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM documents
         WHERE tenant_id = $1 AND kind = $2 AND status = 'approved' AND expires_on > $3
           AND (kind <> 'food_handler_card' OR coalesce(holder_name,'') = coalesce($4,''))`,
        [doc.tenant_id, doc.kind, doc.expires_on, doc.holder_name]
      );
      if (Number(later[0].count) > 0) continue;
      const owner = await this.db.query<{ owner_email: string }>(
        "SELECT owner_email FROM tenants WHERE id = $1",
        [doc.tenant_id]
      );
      if (owner.length === 0) continue;
      const message = expiryReminderEmail(owner[0].owner_email, doc.kind as never, doc.expires_on);
      try {
        await this.mailer.send(message);
      } catch {
        continue; // Try again on the next sweep.
      }
      await this.db.query("UPDATE documents SET reminder_sent_at = now() WHERE id = $1", [doc.id]);
    }
  }

  /** Queued email is marked delivered only when SMTP accepts it. */
  private async drainEmailQueue(): Promise<void> {
    const pending = await this.db.query<{ id: string; to_email: string; subject: string; body: string }>(
      "SELECT id, to_email, subject, body FROM email_queue WHERE sent_at IS NULL ORDER BY created_at"
    );
    for (const message of pending) {
      try {
        await this.mailer.send({ to: message.to_email, subject: message.subject, body: message.body });
      } catch {
        continue;
      }
      await this.db.query("UPDATE email_queue SET sent_at = now() WHERE id = $1", [message.id]);
    }
  }

  /** Pending Kill Bill reversals are retried until Kill Bill records them. */
  private async retryReversals(): Promise<void> {
    const pending = await this.db.query<{
      id: string;
      tenant_id: string;
      kind: "charge" | "credit";
      description: string;
      amount_cents: number;
    }>(
      "SELECT id, tenant_id, kind, description, amount_cents FROM kb_reversals WHERE recorded_at IS NULL ORDER BY created_at"
    );
    for (const reversal of pending) {
      const tenant = await this.db.query<{ business_name: string }>(
        "SELECT business_name FROM tenants WHERE id = $1",
        [reversal.tenant_id]
      );
      if (tenant.length === 0) continue;
      try {
        const accountId = await this.killbill.ensureAccount(reversal.tenant_id, tenant[0].business_name);
        if (reversal.kind === "charge") {
          await this.killbill.createCredit(accountId, {
            kind: "credit",
            description: reversal.description,
            amountCents: reversal.amount_cents
          });
        } else {
          await this.killbill.createCharge(accountId, {
            kind: "charge",
            description: reversal.description,
            amountCents: reversal.amount_cents
          });
        }
      } catch {
        continue;
      }
      await this.db.query("UPDATE kb_reversals SET recorded_at = now() WHERE id = $1", [reversal.id]);
    }
  }
}
