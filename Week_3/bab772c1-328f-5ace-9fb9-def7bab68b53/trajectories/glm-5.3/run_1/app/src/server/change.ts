// The change engine: the change-version increase, the audit entry and the
// webhook outbox row are all decided here and written in the change's own
// transaction. Routes and consumers never do this directly.

import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { canonicalJson } from "../shared/canonicalJson.js";
import { epochMsToIso } from "../shared/format.js";
import type { Json } from "../shared/strictJson.js";

export type AuditKind =
  | "mission.created"
  | "mission.updated"
  | "pass.stored"
  | "pass.parsed"
  | "pass.rejected"
  | "pass.deleted"
  | "event.pinned"
  | "landmark.added"
  | "landmark.removed"
  | "reference.set"
  | "reference.refreshed"
  | "share.revoked"
  | "share.created"
  | "subscriber.added"
  | "subscriber.removed";

export type WebhookEvent =
  | "pass.parsed"
  | "pass.rejected"
  | "pass.deleted"
  | "event.pinned"
  | "share.revoked";

export interface AuditData {
  kind: AuditKind;
  data: Record<string, Json>;
  webhook?: {
    event: WebhookEvent;
    payloadData: Record<string, Json>;
  };
  passId?: string;
}

export interface ChangeOutcome {
  version: number;
  occurredAtMs: number;
}

function hashEntry(entry: {
  seq: number;
  at: string;
  kind: string;
  data: Json;
  prev: string;
}): string {
  const canonical = canonicalJson({
    seq: entry.seq,
    at: entry.at,
    kind: entry.kind,
    data: entry.data,
    prev: entry.prev,
  });
  return createHash("sha256").update(Buffer.from(canonical, "utf8")).digest("hex");
}

export interface ChangeOptions {
  bumpVersion: boolean;
}

// Append one audit entry (and the version increase and webhook row when the
// change asks for them) inside the caller's transaction.
export async function recordChange(
  client: PoolClient,
  missionId: string,
  change: AuditData,
  options: ChangeOptions,
): Promise<ChangeOutcome> {
  const occurredAtMs = Date.now();
  const at = epochMsToIso(occurredAtMs);

  // Lock the mission row so simultaneous changes get consecutive seq values.
  const mission = await client.query<{ audit_seq: string; change_version: string }>(
    "SELECT audit_seq, change_version FROM missions WHERE id = $1 FOR UPDATE",
    [missionId],
  );
  const seq = Number(mission.rows[0].audit_seq) + 1;
  const version = Number(mission.rows[0].change_version) + (options.bumpVersion ? 1 : 0);

  const prevRow = await client.query<{ hash: string }>(
    "SELECT hash FROM audit_entries WHERE mission_id = $1 AND seq = $2",
    [missionId, seq - 1],
  );
  const prev = prevRow.rows.length > 0 ? prevRow.rows[0].hash : "0".repeat(64);

  const hash = hashEntry({ seq, at, kind: change.kind, data: change.data, prev });

  await client.query(
    "INSERT INTO audit_entries (mission_id, seq, at, kind, data, prev, hash) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [missionId, seq, at, change.kind, JSON.stringify(change.data), prev, hash],
  );

  await client.query("UPDATE missions SET audit_seq = $2, change_version = $3 WHERE id = $1", [
    missionId,
    seq,
    version,
  ]);

  if (change.webhook) {
    const eventOutboxId = `${missionId}:${version}`;
    await client.query(
      `INSERT INTO outbox (id, kind, event_id, payload, created_at) VALUES ($1, 'webhook.send', $2, $3, $4)`,
      [
        randomUUID(),
        eventOutboxId,
        JSON.stringify({
          type: change.webhook.event,
          mission_id: missionId,
          version,
          occurred_at: Math.floor(occurredAtMs / 1000),
          data: change.webhook.payloadData,
        }),
        epochMsToIso(occurredAtMs),
      ],
    );
  }

  // Change notices cross instances through Postgres.
  await client.query(
    "INSERT INTO change_notices (mission_id, version, notice, created_at) VALUES ($1, $2, $3, $4)",
    [missionId, version, "change", at],
  );

  return { version, occurredAtMs };
}

export interface AuditEntry {
  seq: number;
  at: string;
  kind: string;
  data: Json;
  prev: string;
  hash: string;
}

export function entryHash(entry: AuditEntry): string {
  return hashEntry(entry);
}
