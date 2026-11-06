// The renter's Kill Bill account, set up once: concurrent first uses for one renter wait on a
// transaction-scoped advisory lock instead of racing to create the account and payment method.

import type { Tx } from "../db.js";
import { type BillingRenter, type Deadline, ensureAccount } from "../services/killbill.js";

export async function billingAccountFor(tx: Tx, renter: BillingRenter, deadline: Deadline): Promise<string> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`killbill-account:${renter.id}`]);
  return ensureAccount(renter, deadline);
}
