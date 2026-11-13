// The request-key rule, shared by uploads and pins. A key belongs to one
// mission and one route; of simultaneous requests with one key, exactly one
// proceeds and the rest answer in progress.

import type { PoolClient } from "pg";
import { validation } from "./errors.js";

export const IDEMPOTENCY_KEY_ERROR = "Send an Idempotency-Key of 1 to 64 letters, digits or dashes.";

const KEY_RE = /^[A-Za-z0-9-]{1,64}$/;

export function checkIdempotencyKey(key: string | undefined): string {
  if (!key || !KEY_RE.test(key)) {
    throw validation({ idempotency_key: IDEMPOTENCY_KEY_ERROR });
  }
  return key;
}

export type ReplayAnswer =
  | { kind: "fresh" }
  | { kind: "in_progress" }
  | { kind: "reused" }
  | { kind: "replay"; status: number; passId: string | null; eventId: string | null }
  | { kind: "replay_deleted" };

export async function beginRequest(
  client: PoolClient,
  key: string,
  missionId: string,
  route: "pass.upload" | "event.pin",
  fingerprint: string,
): Promise<ReplayAnswer> {
  const result = await client.query(
    `SELECT state, status, pass_id, event_id, fingerprint FROM request_keys
     WHERE key = $1 AND mission_id = $2 AND route = $3 FOR UPDATE`,
    [key, missionId, route],
  );
  if (result.rows.length === 0) {
    await client.query(
      `INSERT INTO request_keys (key, mission_id, route, state, fingerprint, created_at)
       VALUES ($1, $2, $3, 'in_progress', NULL, $4)`,
      [key, missionId, route, new Date().toISOString()],
    );
    return { kind: "fresh" };
  }
  const row = result.rows[0];
  if (row.state === "in_progress") {
    return { kind: "in_progress" };
  }
  if (row.fingerprint !== fingerprint) {
    return { kind: "reused" };
  }
  if (row.pass_id !== null) {
    const pass = await client.query<{ deleted: boolean }>("SELECT deleted FROM passes WHERE id = $1", [
      row.pass_id,
    ]);
    if (pass.rows.length === 0 || pass.rows[0].deleted) {
      return { kind: "replay_deleted" };
    }
  }
  return {
    kind: "replay",
    status: Number(row.status),
    passId: row.pass_id ?? null,
    eventId: row.event_id ?? null,
  };
}

export async function keepRequestKey(
  client: PoolClient,
  key: string,
  missionId: string,
  route: "pass.upload" | "event.pin",
  fingerprint: string,
  status: number,
  passId: string | null,
  eventId: string | null,
): Promise<void> {
  await client.query(
    `UPDATE request_keys
     SET state = 'kept', fingerprint = $4, status = $5, pass_id = $6, event_id = $7
     WHERE key = $1 AND mission_id = $2 AND route = $3`,
    [key, missionId, route, fingerprint, status, passId, eventId],
  );
}

export async function releaseRequestKey(
  client: PoolClient,
  key: string,
  missionId: string,
  route: "pass.upload" | "event.pin",
): Promise<void> {
  await client.query(
    `DELETE FROM request_keys WHERE key = $1 AND mission_id = $2 AND route = $3`,
    [key, missionId, route],
  );
}
