import { createHash, randomUUID } from "node:crypto";
import type { Tx } from "./db.ts";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** RFC 8785 canonical JSON: keys sorted by UTF-16 code units, no whitespace. */
function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const ZERO_HASH = "0".repeat(64);

type AuditPayload = {
  seq: number;
  at: string;
  actor_id: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string;
  before: Json;
  after: Json;
};

/** The chain link: SHA-256 of prev_hash, a newline and the canonical payload (DP-12). */
function auditHash(prevHash: string, payload: AuditPayload): string {
  return createHash("sha256")
    .update(`${prevHash}\n${canonicalJson(payload)}`, "utf8")
    .digest("hex");
}

export interface AuditRowChange {
  action: string;
  targetType: string;
  targetId: string;
  before: Json;
  after: Json;
}

/** The highest committed audit seq (0 for an empty log), optionally among rows at or before an instant. */
export async function latestSeq(db: Pick<Tx, "query">, atOrBefore?: Date): Promise<number> {
  const { rows } = atOrBefore
    ? await db.query("select max(seq) as latest_seq from audit_log where at::timestamptz <= $1", [atOrBefore.toISOString()])
    : await db.query("select max(seq) as latest_seq from audit_log");
  return Number(rows[0].latest_seq ?? 0);
}

export async function appendAudit(tx: Tx, prevHash: string, payload: AuditPayload): Promise<void> {
  const hash = auditHash(prevHash, payload);
  await tx.query(
    `insert into audit_log(seq, id, at, actor_id, actor_role, action, target_type, target_id, before, after, prev_hash, hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      payload.seq, randomUUID(), payload.at, payload.actor_id, payload.actor_role, payload.action,
      payload.target_type, payload.target_id, JSON.stringify(payload.before), JSON.stringify(payload.after), prevHash, hash,
    ],
  );
  await tx.query("select pg_notify('strata_audit', $1)", [String(payload.seq)]);
}

interface ChainResult {
  intact: boolean;
  checked_through: number;
  first_broken_seq: number | null;
}

/** Walk the stored rows in ascending seq, recomputing from the stored columns (DP-12). */
export async function checkChain(tx: Tx): Promise<ChainResult> {
  const { rows } = await tx.query(
    `select seq, at, actor_id, actor_role, action, target_type, target_id, before, after, prev_hash, hash
     from audit_log order by seq`,
  );
  let expected = 1;
  let prev = ZERO_HASH;
  for (const r of rows as (AuditPayload & { prev_hash: string; hash: string })[]) {
    let broken: number | null = null;
    if (r.seq !== expected) broken = expected;
    else if (r.prev_hash !== prev || auditHash(r.prev_hash, {
      seq: r.seq, at: r.at, actor_id: r.actor_id, actor_role: r.actor_role, action: r.action,
      target_type: r.target_type, target_id: r.target_id, before: r.before, after: r.after,
    }) !== r.hash) broken = r.seq;
    if (broken !== null) return { intact: false, checked_through: broken - 1, first_broken_seq: broken };
    prev = r.hash;
    expected++;
  }
  return { intact: true, checked_through: expected - 1, first_broken_seq: null };
}
