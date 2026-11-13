import { transact } from '../db.js';
import {
  chargeDescription,
  lockPendingCharges,
  markAttempt,
  markPosted,
  type ChargeRow,
} from '../store/charges.js';
import {
  ensureAccount,
  findInvoiceIdByDescription,
  postExternalCharge,
} from '../services/killbill.js';
import type { Queryable } from '../db.js';

const INTERVAL_MS = 10_000;
const BATCH = 10;

async function accountIdFor(client: Queryable, charge: ChargeRow): Promise<string> {
  const stored = await client.query<{ killbill_account_id: string }>(
    `SELECT killbill_account_id FROM killbill_accounts WHERE organisation_id = $1`,
    [charge.organisation_id],
  );
  const existing = stored.rows[0]?.killbill_account_id;
  if (existing !== undefined) return existing;
  const accountId = await ensureAccount(charge.organisation_code, charge.organisation_name);
  await client.query(
    `INSERT INTO killbill_accounts (organisation_id, killbill_account_id) VALUES ($1, $2)
       ON CONFLICT (organisation_id) DO NOTHING`,
    [charge.organisation_id, accountId],
  );
  return accountId;
}

async function postOne(client: Queryable, charge: ChargeRow): Promise<void> {
  const accountId = await accountIdFor(client, charge);
  const description = chargeDescription(charge);
  // A timed-out earlier attempt may already have landed; adopt it instead of charging twice.
  const existing =
    charge.attempts > 0 ? await findInvoiceIdByDescription(accountId, description) : null;
  const invoiceId = existing ?? (await postExternalCharge(accountId, charge.amount, description));
  await markPosted(client, charge.id, invoiceId);
}

/** Posts pending charges, or just one when a close or cancellation has only created it. */
export async function postPendingCharges(onlyChargeId: string | null = null): Promise<void> {
  await transact(async (client) => {
    const charges = await lockPendingCharges(client, onlyChargeId === null ? BATCH : 1, onlyChargeId);
    for (const charge of charges) {
      try {
        await postOne(client, charge);
      } catch {
        await markAttempt(client, charge.id);
      }
    }
  });
}

export function startBillingPoster(): void {
  const tick = (): void => {
    void postPendingCharges().catch(() => undefined);
  };
  tick();
  setInterval(tick, INTERVAL_MS).unref();
}
