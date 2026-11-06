// Units of work that change records in more than one system (brief: Units of work).
// Records are written in one uncommitted PostgreSQL transaction, then Kill Bill, then MinIO, then
// synchronous email (sent by the caller as its last step); any provider failure rolls the transaction back and undoes what was made.
import { randomUUID } from "node:crypto";
import { pool, transaction, type Db } from "./db";
import * as killbill from "./killbill";
import { deleteObject, putObject } from "./storage";

export interface BillingAccount {
  tenantId: string;
  accountId: string;
}

interface Made {
  account: BillingAccount;
  kind: killbill.BillingRecord;
  cents: number;
  description: string;
}

export class Effects {
  readonly billing: Made[] = [];
  readonly objects: string[] = [];

  async bill(account: BillingAccount, kind: killbill.BillingRecord, cents: number, description: string): Promise<void> {
    await killbill.record(account.accountId, kind, cents, description);
    this.billing.push({ account, kind, cents, description });
  }

  async store(key: string, data: Buffer, contentType: string): Promise<void> {
    await putObject(key, data, contentType);
    this.objects.push(key);
  }
}

export async function unitOfWork<T>(work: (db: Db, effects: Effects) => Promise<T>): Promise<T> {
  const effects = new Effects();
  try {
    return await transaction((db) => work(db, effects));
  } catch (error) {
    await undo(effects);
    throw error;
  }
}

async function undo(effects: Effects): Promise<void> {
  for (const key of effects.objects) {
    await deleteObject(key).catch(() => undefined);
  }
  for (const made of [...effects.billing].reverse()) {
    const reversal = made.kind === "charge" ? "credit" : "charge";
    await reverse(made.account, reversal, made.cents, `Reversal: ${made.description}`);
  }
}

/** Records a reversal now, or keeps it in PostgreSQL for the sweep to retry until Kill Bill records it. */
async function reverse(account: BillingAccount, kind: killbill.BillingRecord, cents: number, description: string): Promise<void> {
  try {
    await killbill.record(account.accountId, kind, cents, description);
  } catch {
    await pool.query("INSERT INTO pending_reversals (id, tenant_id, record, amount_cents, description) VALUES ($1, $2, $3, $4, $5)", [
      randomUUID(),
      account.tenantId,
      kind,
      cents,
      description,
    ]);
  }
}

export async function retryPendingReversals(): Promise<void> {
  for (;;) {
    const done = await transaction(async (db) => {
      const next = (
        await db.query<{ id: string; record: killbill.BillingRecord; amount_cents: number; description: string; killbill_account_id: string }>(
          `SELECT r.id, r.record, r.amount_cents, r.description, t.killbill_account_id
             FROM pending_reversals r JOIN tenants t ON t.id = r.tenant_id
            WHERE r.recorded_at IS NULL ORDER BY r.created_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
        )
      ).rows[0];
      if (!next) return true;
      await killbill.record(next.killbill_account_id, next.record, next.amount_cents, next.description);
      await db.query("UPDATE pending_reversals SET recorded_at = now() WHERE id = $1", [next.id]);
      return false;
    });
    if (done) return;
  }
}
