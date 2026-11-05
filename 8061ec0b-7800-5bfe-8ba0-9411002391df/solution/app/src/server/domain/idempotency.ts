// Idempotency for payments, reversals, buyouts and exchanges: one key per contract and action, the first answer
// stored byte for byte. Copies arriving while the first is in flight wait on the contract lock, then replay it.

import type { Request, Reply } from "../http/router.js";
import { ApiError, idempotencyConflict } from "../http/errors.js";
import { query, withContractLock, type Db } from "../db/pool.js";

type IdempotentAction = "payment" | "reversal" | "buyout" | "exchange";

interface Idempotency {
  /** The request's key when it is 1 to 100 printable ASCII characters, else null (a 422 at validation). */
  key: string | null;
  /** The key was used before on this contract and action with a different body: 409 at the state-conflict step. */
  conflicting: boolean;
  /** Field errors for the key itself, merged into the request's 422. */
  keyFields: Record<string, string>;
  /** Serialises the answer once, stores it under the key (inside the caller's commit) and returns it. */
  respond: (db: Db, status: number, body: unknown) => Promise<Answer>;
}

interface Answer { status: number; raw: string }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

/**
 * Runs `work` under the contract lock with replay handled first. 4xx answers are stored like successes (the work
 * stores its own success inside its commit); 503 answers are not stored.
 */
export async function idempotent(request: Request, contractId: string, action: IdempotentAction, scope: unknown,
  work: (db: Db, idempotency: Idempotency) => Promise<Answer>): Promise<Reply> {
  const header = request.headers["idempotency-key"];
  const raw = typeof header === "string" ? header : undefined;
  const key = raw !== undefined && /^[\x20-\x7e]{1,100}$/.test(raw) ? raw : null;
  const fingerprint = JSON.stringify(canonical({ scope, body: request.body }));
  return withContractLock(contractId, async (db) => {
    const [stored] = key === null ? [] : await query<{ fingerprint: string; status: number; body: string }>(db,
      "SELECT fingerprint, status, body FROM idempotent_responses WHERE contract_id = $1 AND action = $2 AND key = $3",
      [contractId, action, key]);
    if (stored !== undefined && stored.fingerprint === fingerprint) return { status: stored.status, raw: stored.body };
    const respond = async (into: Db, status: number, body: unknown): Promise<Answer> => {
      const text = JSON.stringify(body);
      if (key !== null && stored === undefined) {
        await into.query(`INSERT INTO idempotent_responses (contract_id, action, key, fingerprint, status, body)
          VALUES ($1, $2, $3, $4, $5, $6)`, [contractId, action, key, fingerprint, status, text]);
      }
      return { status, raw: text };
    };
    const keyFields: Record<string, string> = key !== null ? {} : { idempotency_key: raw === undefined ? "required" : "invalid" };
    try {
      return await work(db, { key, conflicting: stored !== undefined, keyFields, respond });
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.code !== idempotencyConflict().code) {
        await respond(db, error.status, error.body());
      }
      throw error;
    }
  });
}
