import { Pool } from "pg";
import type { Config } from "./config.js";
import { KillBill } from "./killbill.js";
import { centsToMoney } from "../shared/domain.js";

type ChargeRow = {
  id: string;
  organisation_id: string;
  kind: "interpreting" | "late_cancellation";
  amount_cents: number;
  reference: string;
  org_name: string;
  org_code: string;
};

/** Pending charges are retried every 10 seconds until Kill Bill accepts them; each charge posts exactly once. */
export class PostingWorker {
  private readonly pool: Pool;
  private readonly killbill: KillBill;
  private running = false;

  constructor(pool: Pool, killbill: KillBill) {
    this.pool = pool;
    this.killbill = killbill;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  async runOnce(): Promise<number> {
    const client = await this.pool.connect();
    let posted = 0;
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<ChargeRow>(
        `SELECT c.id, c.organisation_id, c.kind, c.amount_cents, c.billing_status,
                r.reference, o.name AS org_name, o.code AS org_code
           FROM charge c
           JOIN request r ON r.id = c.request_id
           JOIN organisation o ON o.id = c.organisation_id
          WHERE c.billing_status = 'pending'
          ORDER BY c.created_at
          LIMIT 10
          FOR UPDATE OF c SKIP LOCKED`,
      );
      for (const row of rows) {
        try {
          const accountId = await this.killbill.ensureAccount(row.org_name, row.org_code);
          const description = row.kind === "interpreting"
            ? `${row.reference} interpreting`
            : `${row.reference} late cancellation`;
          const result = await this.killbill.createCharge(accountId, description, centsToMoney(row.amount_cents));
          await client.query(
            "UPDATE charge SET billing_status = 'posted', killbill_invoice_id = $2 WHERE id = $1",
            [row.id, result.invoiceId],
          );
          posted++;
        } catch {
          // Kill Bill unreachable for this charge; leave it pending and retry next tick
        }
      }
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
    } finally {
      client.release();
    }
    return posted;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.runOnce();
      } catch {
        // database hiccup; retry next tick
      }
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
}
