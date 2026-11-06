import { pool, type Transaction } from '../db/pool.js';
import { recordPendingReversal } from '../db/repo/outbox.js';
import * as killbill from '../providers/killbill.js';
import * as storage from '../providers/storage.js';
import { sendEmail, type OutgoingEmail } from '../providers/smtp.js';

interface BillingRecord {
  tenantId: string;
  accountId: string;
  kind: 'charge' | 'credit';
  amountCents: number;
  description: string;
}

/**
 * One action that touches PostgreSQL, Kill Bill, MinIO and SMTP. Records are written in an
 * uncommitted transaction, then the provider records are made in order, then the transaction
 * commits. Any provider failure rolls the transaction back and undoes the provider records.
 */
export class UnitOfWork {
  private readonly billingRecords: BillingRecord[] = [];
  private readonly storedKeys: string[] = [];

  constructor(readonly tx: Transaction) {}

  async charge(
    tenantId: string,
    accountId: string,
    amountCents: number,
    description: string,
  ): Promise<void> {
    await killbill.externalCharge(accountId, amountCents, description);
    this.billingRecords.push({ tenantId, accountId, kind: 'charge', amountCents, description });
  }

  async credit(
    tenantId: string,
    accountId: string,
    amountCents: number,
    description: string,
  ): Promise<void> {
    await killbill.credit(accountId, amountCents, description);
    this.billingRecords.push({ tenantId, accountId, kind: 'credit', amountCents, description });
  }

  async purchase(accountId: string, amountCents: number, externalKey: string): Promise<void> {
    await killbill.purchase(accountId, amountCents, externalKey);
  }

  async store(key: string, body: Buffer, contentType: string): Promise<void> {
    await storage.putObject(key, body, contentType);
    this.storedKeys.push(key);
  }

  async sendNow(email: OutgoingEmail): Promise<void> {
    await sendEmail(email);
  }

  async undo(): Promise<void> {
    for (const key of this.storedKeys.reverse()) {
      await storage.deleteObject(key).catch(() => undefined);
    }
    for (const record of this.billingRecords.reverse()) {
      const description = `Reversal: ${record.description}`;
      try {
        if (record.kind === 'charge') {
          await killbill.credit(record.accountId, record.amountCents, description);
        } else {
          await killbill.externalCharge(record.accountId, record.amountCents, description);
        }
      } catch {
        await recordPendingReversal(
          record.tenantId,
          record.kind === 'charge' ? 'credit' : 'external_charge',
          record.amountCents,
          description,
        );
      }
    }
  }
}

export async function inUnitOfWork<T>(run: (uow: UnitOfWork) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const uow = new UnitOfWork(client);
  try {
    await client.query('BEGIN');
    const result = await run(uow);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    await uow.undo();
    throw error;
  } finally {
    client.release();
  }
}
