import { createHash } from "node:crypto";
import { one, run, tx } from "../db";
import { ApiError, errors } from "../errors";

export interface IdempotentRequest {
  person: string;
  key: string;
  method: string;
  path: string;
  body: string;
}

export interface IdemClaim {
  kind: "replay";
  status: number;
  body: string;
  replayHeader: boolean;
}

const CLAIM_LEASE_MS = 30000;
const WAIT_MS = 4500;
const POLL_MS = 40;

export function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

/**
 * The single place that decides idempotent replay. Either returns a stored
 * replay, or claims the key so this request may do its work; a concurrent
 * request with the same key waits for the first one's response.
 */
export async function withIdempotency(
  req: IdempotentRequest,
  work: () => Promise<{ status: number; body: unknown }>
): Promise<{ status: number; body: unknown; replay?: boolean }> {
  const bodyHash = hashBody(req.body);
  const claim = (): IdemClaim | "claimed" | "busy" =>
    tx(() => {
      const row = one<{
        method: string;
        path: string;
        body_hash: string;
        status: number | null;
        response_body: string | null;
        claimed_at: number;
      }>("SELECT method, path, body_hash, status, response_body, claimed_at FROM idempotency WHERE person = ? AND key = ?", req.person, req.key);
      if (row) {
        if (row.method !== req.method || row.path !== req.path || row.body_hash !== bodyHash) {
          throw errors.idempotencyKeyReused();
        }
        if (row.status !== null && row.response_body !== null) {
          return { kind: "replay", status: row.status, body: row.response_body, replayHeader: true };
        }
        const fresh = Date.now() - row.claimed_at < CLAIM_LEASE_MS;
        if (fresh) return "busy";
        run("UPDATE idempotency SET claimed_at = ? WHERE person = ? AND key = ?", Date.now(), req.person, req.key);
        return "claimed";
      }
      run(
        "INSERT INTO idempotency (person, key, method, path, body_hash, claimed_at, status, response_body) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)",
        req.person, req.key, req.method, req.path, bodyHash, Date.now()
      );
      return "claimed";
    });

  let first = claim();
  if (first === "busy") {
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      first = claim();
      if (first !== "busy") break;
    }
    if (first === "busy") {
      // The first request is still running; give up rather than double-work.
      throw errors.databaseBusy();
    }
  }
  if (first !== "claimed") {
    return { status: first.status, body: JSON.parse(first.body), replay: true };
  }
  let result: { status: number; body: unknown };
  try {
    result = await work();
  } catch (e) {
    release(req);
    throw e;
  }
  if (result.status < 500) {
    tx(() => {
      run(
        "UPDATE idempotency SET status = ?, response_body = ? WHERE person = ? AND key = ?",
        result.status, JSON.stringify(result.body), req.person, req.key
      );
    });
  } else {
    release(req);
  }
  return result;
}

function release(req: IdempotentRequest): void {
  try {
    tx(() => {
      run("DELETE FROM idempotency WHERE person = ? AND key = ? AND status IS NULL", req.person, req.key);
    });
  } catch {
    /* nothing to do; the lease expires on its own */
  }
}

export function checkIdempotencyKey(key: string | undefined): ApiError | null {
  if (key === undefined || key === null || key === "") return errors.idempotencyKeyMissing();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) return errors.idempotencyKeyMissing();
  return null;
}

export const UPLOAD_LEASE_MS = 60000;
export const CLOSE_LEASE_MS = 60000;

/** One document upload at a time per cycle and kind, across every process. */
export function acquireUploadLease(cycleId: string, kind: string): boolean {
  const now = Date.now();
  return tx(() => {
    const row = one<{ lease_until: number }>(
      "SELECT lease_until FROM upload_locks WHERE cycle_id = ? AND kind = ?",
      cycleId, kind
    );
    if (row) {
      if (row.lease_until > now) return false;
      run("UPDATE upload_locks SET lease_until = ? WHERE cycle_id = ? AND kind = ?", now + UPLOAD_LEASE_MS, cycleId, kind);
      return true;
    }
    run("INSERT INTO upload_locks (cycle_id, kind, lease_until) VALUES (?, ?, ?)", cycleId, kind, now + UPLOAD_LEASE_MS);
    return true;
  });
}

export function releaseUploadLease(cycleId: string, kind: string): void {
  try {
    tx(() => {
      run("DELETE FROM upload_locks WHERE cycle_id = ? AND kind = ?", cycleId, kind);
    });
  } catch {
    /* the lease expires on its own */
  }
}

/** One close at a time per cycle, across every process. */
export function acquireCloseLease(cycleId: string): boolean {
  const now = Date.now();
  return tx(() => {
    const row = one<{ lease_until: number }>("SELECT lease_until FROM close_locks WHERE cycle_id = ?", cycleId);
    if (row) {
      if (row.lease_until > now) return false;
      run("UPDATE close_locks SET lease_until = ? WHERE cycle_id = ?", now + CLOSE_LEASE_MS, cycleId);
      return true;
    }
    run("INSERT INTO close_locks (cycle_id, lease_until) VALUES (?, ?)", cycleId, now + CLOSE_LEASE_MS);
    return true;
  });
}

export function releaseCloseLease(cycleId: string): void {
  try {
    tx(() => {
      run("DELETE FROM close_locks WHERE cycle_id = ?", cycleId);
    });
  } catch {
    /* the lease expires on its own */
  }
}
