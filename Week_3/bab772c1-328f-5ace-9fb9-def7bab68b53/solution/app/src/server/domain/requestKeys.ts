/** The request-key rule shared by uploads and pins. */

import { pool, type Queryable } from "../db/pool.js";

export const REQUEST_KEY_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

type RequestRoute = "upload" | "pin";

type RequestKeyOutcome =
  | { kind: "proceed" }
  | { kind: "in_progress" }
  | { kind: "reused" }
  | { kind: "replay"; status: number; passId: string | null; eventId: string | null };

export function uploadFingerprint(sha256: string, filename: string): string {
  return `${sha256}:${filename}`;
}

export function pinFingerprint(met: unknown, title: unknown, note: unknown): string {
  const trimmed = (value: unknown): unknown =>
    typeof value === "string" ? value.trim() : value;
  return JSON.stringify({
    met: met ?? null,
    title: trimmed(title) ?? null,
    note: trimmed(note) ?? "",
  });
}

/** Claims the key, or reports that the request is a replay, a reuse or still in progress. */
export async function beginRequestKey(
  missionId: string,
  route: RequestRoute,
  key: string,
  fingerprint: string,
): Promise<RequestKeyOutcome> {
  const claimed = await pool.query(
    `insert into request_keys (mission_id, route, key, state, fingerprint, created_ms)
     values ($1, $2, $3, 'in_progress', $4, $5)
     on conflict (mission_id, route, key) do nothing
     returning key`,
    [missionId, route, key, fingerprint, Date.now()],
  );
  if (claimed.rowCount === 1) {
    return { kind: "proceed" };
  }
  const existing = await pool.query<{
    state: string;
    fingerprint: string;
    status: number | null;
    pass_id: string | null;
    event_id: string | null;
  }>(
    `select state, fingerprint, status, pass_id, event_id from request_keys
     where mission_id = $1 and route = $2 and key = $3`,
    [missionId, route, key],
  );
  const row = existing.rows[0];
  if (!row || row.state === "in_progress") {
    return { kind: "in_progress" };
  }
  if (row.fingerprint !== fingerprint) {
    return { kind: "reused" };
  }
  return {
    kind: "replay",
    status: row.status ?? 200,
    passId: row.pass_id,
    eventId: row.event_id,
  };
}

export async function keepRequestKey(
  tx: Queryable,
  missionId: string,
  route: RequestRoute,
  key: string,
  status: number,
  ids: { passId?: string; eventId?: string },
): Promise<void> {
  await tx.query(
    `update request_keys set state = 'kept', status = $4, pass_id = $5, event_id = $6
     where mission_id = $1 and route = $2 and key = $3`,
    [missionId, route, key, status, ids.passId ?? null, ids.eventId ?? null],
  );
}

export async function releaseRequestKey(
  missionId: string,
  route: RequestRoute,
  key: string,
): Promise<void> {
  await pool.query(
    `delete from request_keys where mission_id = $1 and route = $2 and key = $3 and state = 'in_progress'`,
    [missionId, route, key],
  );
}
