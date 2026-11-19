import type { Pool } from "pg";
import { randomBytes } from "node:crypto";

/** 128+ bits of randomness, URL-safe. */
export function token(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/** Booking reference: SS- followed by six uppercase letters or digits. */
export function bookingReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const buf = randomBytes(6);
  for (let i = 0; i < 6; i++) out += alphabet[buf[i] % alphabet.length];
  return `SS-${out}`;
}

export interface Outcome {
  status: number;
  body: unknown;
  store: boolean;
}

/**
 * One idempotency handler for the four keyed actions. A request with the same key,
 * method, path and body (parsed JSON compared) replays the stored final response
 * before any 404 or 410 check. A different request under that key answers 409.
 * Requests racing on one key wait for the first to finish.
 */
export class Idempotency {
  private inflight = new Map<string, Promise<Outcome>>();

  constructor(private pool: Pool) {}

  async run(key: string, method: string, path: string, body: unknown, execute: () => Promise<Outcome>): Promise<Outcome> {
    const scope = `${method} ${path}`;
    const bodyJson = JSON.stringify(body ?? null);

    // Replay any stored final response first.
    const stored = await this.pool.query<{ status: number; body: string }>(
      `SELECT status, body FROM idempotency_records
       WHERE idempotency_key = $1 AND scope = $2 AND request_body = $3`,
      [key, scope, bodyJson],
    );
    if (stored.rows.length > 0) {
      return { status: stored.rows[0].status, body: JSON.parse(stored.rows[0].body), store: false };
    }
    const conflict = await this.pool.query(
      `SELECT 1 FROM idempotency_records WHERE idempotency_key = $1 AND scope = $2`,
      [key, scope],
    );
    if (conflict.rows.length > 0) {
      throw new Error("idempotency_conflict");
    }

    // Serialize concurrent requests on the same key.
    const prior = this.inflight.get(scope);
    let run: Promise<Outcome>;
    if (prior) {
      run = prior.then(async () => {
        const again = await this.pool.query<{ status: number; body: string }>(
          `SELECT status, body FROM idempotency_records
           WHERE idempotency_key = $1 AND scope = $2 AND request_body = $3`,
          [key, scope, bodyJson],
        );
        if (again.rows.length > 0) {
          return { status: again.rows[0].status, body: JSON.parse(again.rows[0].body), store: false };
        }
        return execute();
      });
    } else {
      run = execute();
    }
    const tracked = run.finally(() => {
      if (this.inflight.get(scope) === tracked) this.inflight.delete(scope);
    });
    this.inflight.set(scope, tracked);

    const outcome = await tracked;
    if (outcome.store) {
      await this.pool.query(
        `INSERT INTO idempotency_records (idempotency_key, scope, status, body, request_body, created_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (idempotency_key, scope) DO NOTHING`,
        [key, scope, outcome.status, JSON.stringify(outcome.body), bodyJson],
      );
    }
    return outcome;
  }
}
