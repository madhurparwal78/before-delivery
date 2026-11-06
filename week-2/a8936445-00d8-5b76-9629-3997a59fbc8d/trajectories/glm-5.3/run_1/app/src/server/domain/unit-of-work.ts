/**
 * Units of work that span PostgreSQL, Kill Bill, MinIO and SMTP.
 *
 * Order: every rule is checked first; records are written in one uncommitted PostgreSQL
 * transaction; Kill Bill records are made; any MinIO object is stored; synchronous email
 * is handed to SMTP last; then the transaction commits.
 *
 * When a provider fails: the transaction rolls back, objects this action stored are deleted,
 * and every Kill Bill record this action made is reversed (a charge by a credit of the same
 * amount, a credit by an external charge), each described `Reversal: <original description>`.
 * A reversal Kill Bill does not accept at once is kept in PostgreSQL and retried by the sweep.
 */

import type { PoolClient } from "pg";
import type { KillBillClient, KbcCharge } from "../providers/killbill.js";
import type { Storage } from "../providers/storage.js";
import type { Mailer, OutgoingEmail } from "../providers/mail.js";
import type { Db } from "../db.js";
import { uuid } from "../db.js";

export interface KbcRecordPlan {
  tenantId: string;
  businessName: string;
  kind: "charge" | "credit";
  charge: KbcCharge;
}

export interface PaymentPlan {
  tenantId: string;
  businessName: string;
  amountCents: number;
  transactionExternalKey: string;
}

export interface UnitOfWorkSteps {
  /** Records written inside the uncommitted transaction. */
  write: (client: PoolClient) => Promise<void>;
  /** Kill Bill charges and credits made after the writes, before the commit. */
  killBill?: KbcRecordPlan[];
  /** Kill Bill PURCHASE payments made after the writes, before the commit. */
  payments?: PaymentPlan[];
  /** Storage put after Kill Bill; the stored key is deleted again on failure. */
  store?: { key: string; body: () => Buffer | Promise<Buffer>; contentType: string };
  /** A synchronous email handed to SMTP as the last step before the commit. */
  syncEmail?: OutgoingEmail | null;
}

export class UnitOfWorkRunner {
  constructor(
    readonly db: Db,
    readonly killbill: KillBillClient,
    readonly storage: Storage,
    readonly mailer: Mailer
  ) {}

  async run(steps: UnitOfWorkSteps): Promise<void> {
    const made: KbcRecordPlan[] = [];
    let storedKey: string | null = null;
    try {
      await this.db.withTransaction(async (client) => {
        await steps.write(client);
        for (const record of steps.killBill ?? []) {
          const accountId = await this.killbill.ensureAccount(record.tenantId, record.businessName);
          if (record.kind === "charge") {
            await this.killbill.createCharge(accountId, record.charge);
          } else {
            await this.killbill.createCredit(accountId, record.charge);
          }
          made.push(record);
        }
        for (const payment of steps.payments ?? []) {
          const accountId = await this.killbill.ensureAccount(payment.tenantId, payment.businessName);
          const paymentMethodId = await this.killbill.ensurePaymentMethod(
            accountId,
            payment.tenantId
          );
          await this.killbill.createPurchasePayment(
            accountId,
            paymentMethodId,
            payment.amountCents,
            payment.transactionExternalKey
          );
        }
        if (steps.store) {
          const body = await steps.store.body();
          await this.storage.putObject(steps.store.key, body, steps.store.contentType);
          storedKey = steps.store.key;
        }
        if (steps.syncEmail) {
          await this.mailer.send(steps.syncEmail);
        }
      });
    } catch (e) {
      await this.compensate(made, storedKey);
      throw e;
    }
  }

  private async compensate(made: KbcRecordPlan[], storedKey: string | null): Promise<void> {
    if (storedKey !== null) {
      try {
        await this.storage.deleteObject(storedKey);
      } catch {
        // Best effort; the object belongs to a rolled-back record and is unreachable by id.
      }
    }
    for (const record of made) {
      const reversal: KbcCharge = {
        kind: record.kind === "charge" ? "credit" : "charge",
        description: `Reversal: ${record.charge.description}`,
        amountCents: record.charge.amountCents
      };
      try {
        const accountId = await this.killbill.ensureAccount(record.tenantId, record.businessName);
        if (reversal.kind === "charge") {
          await this.killbill.createCharge(accountId, reversal);
        } else {
          await this.killbill.createCredit(accountId, reversal);
        }
      } catch {
        // Kill Bill did not accept the reversal; the sweep retries it.
        await this.db
          .query(
            `INSERT INTO kb_reversals (id, tenant_id, kind, description, amount_cents, created_at)
             VALUES ($1,$2,$3,$4,$5, now())`,
            [
              uuid(),
              record.tenantId,
              record.kind,
              `Reversal: ${record.charge.description}`,
              record.charge.amountCents
            ]
          )
          .catch(() => undefined);
      }
    }
  }
}
