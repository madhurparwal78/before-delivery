// Timed work on the server, every two seconds: answer windows, claim ends, request page ends, erasure, and the
// storage bucket while MinIO was unreachable at boot.
import { pool, rows, tx } from "./db.js";
import { storage } from "./s3.js";
import { markNoResponse } from "./cases/transitions.js";

const TICK_MS = 2000;
let bucketReady = false;

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  await storage.ensureBucket();
  bucketReady = true;
}

/** A message working copy with the party names nulled. */
function withoutPartyNames(working: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(working);
  for (const party of ["originator", "beneficiary"]) {
    const value = copy[party];
    if (value && typeof value === "object") (value as Record<string, unknown>).name = null;
  }
  return copy;
}

/**
 * Erasure after the retention time: personal data leaves the database at once; each stored object is deleted from
 * MinIO and the case reads Erased only when every deletion is confirmed. Digests stay.
 */
async function eraseDueCases(): Promise<void> {
  const due = await rows<{ id: string }>(pool,
    "SELECT id FROM cases WHERE erased_at IS NULL AND erasure_due_at <= now() ORDER BY erasure_due_at LIMIT 50");
  for (const { id } of due) {
    await tx(async (db) => {
      await db.query(
        `UPDATE cases SET originator_name = NULL, originator_identity_number = NULL, originator_date_of_birth = NULL,
           beneficiary_name = NULL WHERE id = $1`, [id]);
      await db.query("UPDATE request_pages SET answer_note = NULL WHERE case_id = $1", [id]);
      const linked = await rows<{ id: string; working: Record<string, unknown> }>(db, "SELECT id, working FROM messages WHERE case_id = $1", [id]);
      for (const m of linked) await db.query("UPDATE messages SET working = $2 WHERE id = $1", [m.id, JSON.stringify(withoutPartyNames(m.working))]);
      const stored = await rows<{ partner_key_id: string; request_key: string; body: string }>(db,
        "SELECT partner_key_id, request_key, body FROM partner_requests WHERE status = 201 AND position($1 in body) > 0", [id]);
      for (const r of stored) {
        const reply = JSON.parse(r.body) as { case: Record<string, unknown> };
        reply.case.originator = null;
        reply.case.beneficiaryName = null;
        await db.query("UPDATE partner_requests SET body = $3 WHERE partner_key_id = $1 AND request_key = $2",
          [r.partner_key_id, r.request_key, JSON.stringify(reply)]);
      }
    });
    const objects = await rows<{ id: string; object_key: string }>(pool,
      "SELECT id, object_key FROM stored_objects WHERE case_id = $1 AND deleted_at IS NULL", [id]);
    let confirmed = true;
    for (const object of objects) {
      try {
        await storage.remove(object.object_key);
        await pool.query("UPDATE stored_objects SET deleted_at = now() WHERE id = $1", [object.id]);
      } catch {
        confirmed = false;
      }
    }
    if (confirmed) await pool.query("UPDATE cases SET erased_at = date_trunc('second', now()) WHERE id = $1", [id]);
  }
}

async function tick(): Promise<void> {
  await markNoResponse(pool);
  await pool.query(
    `UPDATE cases SET claim_member_id = NULL, claim_member_name = NULL, claimed_at = NULL, claim_ends_at = NULL
      WHERE claim_ends_at <= now()`);
  await pool.query("UPDATE request_pages SET ended_at = ends_at WHERE ended_at IS NULL AND answered_at IS NULL AND ends_at <= now()");
  await eraseDueCases();
}

export function startJobs(): void {
  const run = async (): Promise<void> => {
    for (const work of [ensureBucket, tick]) {
      try {
        await work();
      } catch (error) {
        console.error("timed work", error instanceof Error ? error.message : error);
      }
    }
    setTimeout(run, TICK_MS);
  };
  void run();
}
