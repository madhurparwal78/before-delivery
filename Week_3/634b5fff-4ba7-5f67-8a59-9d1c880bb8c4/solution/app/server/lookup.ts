import { config } from "./config.js";
import { pool } from "./db.js";
import { fail } from "./http.js";
import { claimLookupTry, returnLookupTry, ValkeyUnreachable } from "./valkey.js";
import { ORDER_LOOKUP_TRIES } from "../shared/domain.js";

/** Order lookup by reference and email, limited per connecting address to refused tries in a fixed window. */

const local = new Map<string, { count: number; resetsAt: number }>();

const localState = (client: string): { count: number; ttl: number } => {
  const entry = local.get(client);
  if (!entry || entry.resetsAt <= Date.now()) {
    local.delete(client);
    return { count: 0, ttl: 0 };
  }
  return { count: entry.count, ttl: Math.ceil((entry.resetsAt - Date.now()) / 1000) };
};

/** Every try is claimed before the search and given back if it finds the order, so a burst cannot outrun the limit. */
const claimTry = async (client: string): Promise<{ count: number; ttl: number }> => {
  try {
    return await claimLookupTry(client, config.lookupWindowSeconds);
  } catch (error) {
    if (!(error instanceof ValkeyUnreachable)) throw error;
    const current = localState(client);
    const ttl = current.ttl || config.lookupWindowSeconds;
    local.set(client, { count: current.count + 1, resetsAt: Date.now() + ttl * 1000 });
    return { count: current.count + 1, ttl };
  }
};

const returnTry = async (client: string): Promise<void> => {
  try {
    await returnLookupTry(client);
  } catch (error) {
    if (!(error instanceof ValkeyUnreachable)) throw error;
    const entry = local.get(client);
    if (entry) entry.count -= 1;
  }
};

export const lookupOrder = async (client: string, reference: unknown, email: unknown): Promise<{ reference: string; orderToken: string }> => {
  const claimed = await claimTry(client);
  if (claimed.count > ORDER_LOOKUP_TRIES) return fail("lookup_limited", { headers: { "retry-after": String(Math.max(1, claimed.ttl)) } });
  const found = typeof reference === "string" && typeof email === "string"
    ? await pool.query("SELECT reference, order_token FROM orders WHERE reference = $1 AND lower(buyer_email) = lower($2)", [reference, email])
    : null;
  if (!found?.rows[0]) return fail("lookup_refused");
  await returnTry(client);
  return { reference: found.rows[0].reference as string, orderToken: found.rows[0].order_token as string };
};
