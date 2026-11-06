import type { Locale } from '../../shared/types.js';
import type { Queryable } from '../db/pool.js';
import { killbill } from '../services/killbill.js';

/** One Kill Bill account per customer, found before it is ever created again. */
export async function ensureKillbillAccount(
  client: Queryable,
  customer: { id: string; email: string; locale: Locale },
  shippingName: string,
  actor: string,
): Promise<string> {
  const stored = await client.query<{ killbill_account_id: string | null }>(
    'SELECT killbill_account_id FROM customers WHERE id = $1',
    [customer.id],
  );
  const existing = stored.rows[0]?.killbill_account_id;
  if (existing) return existing;
  const found = await killbill.findAccountId(customer.email);
  const accountId =
    found ??
    (await killbill.createAccount({
      email: customer.email,
      name: shippingName,
      locale: customer.locale,
      actor,
    }));
  await client.query('UPDATE customers SET killbill_account_id = $2 WHERE id = $1', [
    customer.id,
    accountId,
  ]);
  return accountId;
}
