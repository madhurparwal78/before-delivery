// Idempotency keys (brief: API, Idempotency), adapted from kit/modules/idempotency: the fingerprint is
// the path and the exact body bytes; keys are scoped to the staff id and the route; 2xx and 4xx
// responses are stored, 503s are not.
import { createHash } from "node:crypto";
import type { Db } from "./db.js";
import { ApiError, validationFailed } from "./errors.js";

interface Stored {
  status: number;
  body: string;
}

export class Idempotency {
  private constructor(
    readonly staffId: string,
    readonly route: string,
    readonly key: string,
    readonly fingerprint: string,
    readonly conflict: boolean,
  ) {}

  /** Reads the key header. Returns the stored response for an identical replay. */
  static async open(
    db: Db,
    header: string | undefined,
    staffId: string,
    route: string,
    path: string,
    body: Buffer,
  ): Promise<{ replay: Stored } | { idem: Idempotency | null }> {
    if (header === undefined) return { idem: null };
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(header)) {
      throw validationFailed({ idempotencyKey: "Use 1 to 64 letters, digits, hyphens or underscores." });
    }
    const fingerprint = createHash("sha256").update(path).update("\n").update(body).digest("hex");
    const { rows } = await db.query(
      "SELECT fingerprint, status, body FROM idempotency_keys WHERE staff_id = $1 AND route = $2 AND key = $3",
      [staffId, route, header],
    );
    const stored = rows[0];
    if (stored && stored.fingerprint === fingerprint) return { replay: { status: stored.status, body: stored.body } };
    return { idem: new Idempotency(staffId, route, header, fingerprint, Boolean(stored)) };
  }

  /** The state-conflict step of the error precedence: same key, different request. */
  assertNoConflict(): void {
    if (this.conflict) {
      throw new ApiError(409, "idempotency_conflict", "That idempotency key was already used for a different request.");
    }
  }

  /** Records the response; inside the effect's transaction for a success. False when a twin won the race. */
  async record(db: Db, status: number, body: string): Promise<boolean> {
    const { rowCount } = await db.query(
      `INSERT INTO idempotency_keys (staff_id, route, key, fingerprint, status, body) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT DO NOTHING`,
      [this.staffId, this.route, this.key, this.fingerprint, status, body],
    );
    return rowCount === 1;
  }
}

/** Thrown inside a transaction when a concurrent twin stored its response first. */
export class LostRace extends Error {}
