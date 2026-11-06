/** The renter's one Kill Bill account, remembered after it is first created. */

import { db } from '../db.js';
import { ensureAccount } from '../services/killbill.js';
import type { RenterRow } from '../rows.js';

export async function renterBillingAccountId(renter: RenterRow): Promise<string> {
  if (renter.killbill_account_id !== null) return renter.killbill_account_id;
  const accountId = await ensureAccount({
    renterId: renter.id,
    businessName: renter.business_name,
    email: renter.email,
  });
  await db.query('UPDATE renters SET killbill_account_id = $2 WHERE id = $1', [
    renter.id,
    accountId,
  ]);
  return accountId;
}
