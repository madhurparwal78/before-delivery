import { config } from './config.js';
import { query } from './db.js';
import { ApiError, fail } from './errors.js';
import { errorCopy } from '../shared/copy.js';
import { loadOrder } from './orders.js';
import { countRefusedLookup, readRefusedLookups, valkeyUp } from './services/valkey.js';

const ALLOWED_REFUSALS = 5;

async function refusedCount(client: string): Promise<{ count: number; waitSeconds: number }> {
  if (valkeyUp()) {
    const { count, ttl } = await readRefusedLookups(client);
    return { count, waitSeconds: ttl };
  }
  const rows = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM lookup_attempts
      WHERE client = $1 AND attempted_at > now() - ($2 || ' seconds')::interval`,
    [client, String(config.lookupWindowSeconds)],
  );
  return { count: Number(rows[0]?.count ?? '0'), waitSeconds: config.lookupWindowSeconds };
}

async function recordRefusal(client: string): Promise<void> {
  if (valkeyUp()) {
    await countRefusedLookup(client, config.lookupWindowSeconds);
    return;
  }
  await query('INSERT INTO lookup_attempts (client) VALUES ($1)', [client]);
}

/** One identical refusal for any wrong pair, and 429 after the allowed tries. */
export async function lookupOrder(
  client: string,
  reference: unknown,
  email: unknown,
): Promise<{ reference: string; orderToken: string }> {
  const { count, waitSeconds } = await refusedCount(client);
  if (count >= ALLOWED_REFUSALS) {
    throw new ApiError(
      429,
      'lookup_limited',
      errorCopy.lookup_limited,
      undefined,
      undefined,
      Math.max(1, waitSeconds),
    );
  }
  const order =
    typeof reference === 'string' && typeof email === 'string' ? await loadOrder(reference) : null;
  if (
    order === null ||
    typeof email !== 'string' ||
    order.buyer_email.toLowerCase() !== email.trim().toLowerCase()
  ) {
    await recordRefusal(client);
    throw fail(404, 'lookup_refused');
  }
  return { reference: order.reference, orderToken: order.order_token };
}
