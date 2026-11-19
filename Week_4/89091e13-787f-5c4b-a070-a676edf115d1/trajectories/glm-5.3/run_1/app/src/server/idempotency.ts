// Idempotency for transaction-creating writes: a repeated key with the same
// body returns the stored response; a different body answers 409.

import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Db, DbLike } from "./db.js";
import { sendJson } from "./api.js";

export function requestHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? {})).digest("hex");
}

/** Stores the response of a successful idempotent write. */
export async function rememberResponse(
  db: DbLike,
  senderId: string,
  workspaceId: string,
  key: string,
  body: unknown,
  status: number,
  response: unknown,
): Promise<void> {
  await db.query(
    `INSERT INTO idempotency (sender_id, workspace_id, key, request_hash, status, body)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (sender_id, workspace_id, key) DO NOTHING`,
    [senderId, workspaceId, key, requestHash(body), status, JSON.stringify(response)],
  );
}

export type IdempotencyOutcome =
  | { kind: "new" }
  | { kind: "replay"; replay: { status: number; body: unknown } }
  | { kind: "conflict" };

/** Checks an idempotency key before a write creates anything. */
export async function checkIdempotency(
  db: Db,
  senderId: string,
  workspaceId: string,
  key: string | undefined,
  body: unknown,
): Promise<IdempotencyOutcome> {
  if (!key) return { kind: "new" };
  const row = await db.one<{ request_hash: string; status: number; body: string }>(
    `SELECT request_hash, status, body FROM idempotency WHERE sender_id = $1 AND workspace_id = $2 AND key = $3`,
    [senderId, workspaceId, key],
  );
  if (!row) return { kind: "new" };
  if (row.request_hash !== requestHash(body)) return { kind: "conflict" };
  return { kind: "replay", replay: { status: row.status, body: JSON.parse(row.body) } };
}

/** Middleware-shaped helper for transaction routes. */
export function idempotencyGuard(
  db: Db,
  workspaceId: (req: Request) => string,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void (async () => {
      const key = req.headers["idempotency-key"];
      if (key === undefined || !req.session) {
        next();
        return;
      }
      const outcome = await checkIdempotency(db, req.session.personId, workspaceId(req), String(key), req.body);
      if (outcome.kind === "replay") {
        sendJson(res, outcome.replay.status, outcome.replay.body);
        return;
      }
      if (outcome.kind === "conflict") {
        sendJson(res, 409, { error: "This idempotency key was used for a different request." });
        return;
      }
      next();
    })();
  };
}
