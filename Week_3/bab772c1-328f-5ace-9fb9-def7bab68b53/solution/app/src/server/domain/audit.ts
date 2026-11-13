/** The mission audit chain: appended and verified through one canonicaliser. */

import { createHash } from "node:crypto";
import { canonicalize, type JsonValue } from "../../shared/canonical.js";
import { isoInstant } from "../../shared/doy.js";
import type { Queryable } from "../db/pool.js";
import type { AuditEntry } from "../../shared/model.js";

const GENESIS_PREV = "0".repeat(64);

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

function entryHash(entry: {
  seq: number;
  at: string;
  kind: string;
  data: JsonValue;
  prev: string;
}): string {
  const canonical = canonicalize({
    seq: entry.seq,
    at: entry.at,
    kind: entry.kind,
    data: entry.data,
    prev: entry.prev,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Appends exactly one entry, in the caller's transaction. */
export async function appendAuditEntry(
  tx: Queryable,
  missionId: string,
  kind: AuditKind,
  data: JsonValue,
  atMs: number,
): Promise<AuditEntry> {
  await tx.query("select id from missions where id = $1 for no key update", [missionId]);
  const previous = await tx.query<{ seq: number; hash: string }>(
    "select seq, hash from audit_entries where mission_id = $1 order by seq desc limit 1",
    [missionId],
  );
  const last = previous.rows[0];
  const seq = (last?.seq ?? 0) + 1;
  const prev = last?.hash ?? GENESIS_PREV;
  const at = isoInstant(atMs);
  const hash = entryHash({ seq, at, kind, data, prev });
  await tx.query(
    `insert into audit_entries (mission_id, seq, at_ms, kind, data, prev, hash)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [missionId, seq, Math.floor(atMs / 1000) * 1000, kind, JSON.stringify(data), prev, hash],
  );
  return { seq, at, kind, data: data as Record<string, unknown>, prev, hash };
}

export async function listAuditEntries(
  tx: Queryable,
  missionId: string,
): Promise<AuditEntry[]> {
  const result = await tx.query<{
    seq: number;
    at_ms: number;
    kind: string;
    data: Record<string, unknown>;
    prev: string;
    hash: string;
  }>(
    "select seq, at_ms, kind, data, prev, hash from audit_entries where mission_id = $1 order by seq",
    [missionId],
  );
  return result.rows.map((row) => ({
    seq: row.seq,
    at: isoInstant(row.at_ms),
    kind: row.kind,
    data: row.data,
    prev: row.prev,
    hash: row.hash,
  }));
}

export function verifyChain(
  entries: readonly AuditEntry[],
): { ok: true; length: number } | { ok: false; first_bad_seq: number } {
  let expectedPrev = GENESIS_PREV;
  for (const [index, entry] of entries.entries()) {
    const expectedSeq = index + 1;
    const hash = entryHash({
      seq: entry.seq,
      at: entry.at,
      kind: entry.kind,
      data: entry.data as JsonValue,
      prev: entry.prev,
    });
    if (entry.seq !== expectedSeq || entry.prev !== expectedPrev || entry.hash !== hash) {
      return { ok: false, first_bad_seq: entry.seq };
    }
    expectedPrev = entry.hash;
  }
  return { ok: true, length: entries.length };
}
