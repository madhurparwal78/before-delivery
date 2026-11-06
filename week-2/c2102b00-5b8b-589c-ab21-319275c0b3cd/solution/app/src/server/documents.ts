// The distributor invoice and the packing-slip photo, stored byte for byte in MinIO under the cycle.
import { createHash } from "node:crypto";
import { effectiveStatus, visibleCycle } from "./cycles.js";
import { randomUUID } from "node:crypto";
import { all, nowSeconds, one, run, transaction } from "./db.js";
import { ApiError, conflict, notFound, type Reply } from "./errors.js";
import { allow, type Viewer } from "./session.js";
import { deleteObject, getObject, putObject } from "./storage.js";

/** Uploads may be up to 10,000,000 bytes, inclusive. */
export const UPLOAD_LIMIT = 10_000_000;

export type DocumentKind = "invoice" | "packing-slip";

const SIGNATURES: Record<DocumentKind, { type: string; magic: Buffer; ext: string }[]> = {
  invoice: [{ type: "application/pdf", magic: Buffer.from("%PDF-"), ext: "pdf" }],
  "packing-slip": [
    { type: "image/jpeg", magic: Buffer.from([0xff, 0xd8, 0xff]), ext: "jpg" },
    { type: "image/png", magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ext: "png" },
  ],
};

/** The upload type check: the declared type must be allowed and the leading bytes must match it. */
export function checkUpload(kind: DocumentKind, declared: string | undefined, body: Buffer) {
  const type = (declared ?? "").split(";")[0]!.trim().toLowerCase();
  const found = SIGNATURES[kind].find((s) => s.type === type);
  if (!found || body.length === 0 || !body.subarray(0, found.magic.length).equals(found.magic)) {
    throw new ApiError(
      415,
      "unsupported_media_type",
      kind === "invoice" ? "That file isn't a PDF." : "That file isn't a JPEG or PNG photo.",
    );
  }
  return found;
}

/** A running upload left behind by a dead process stops counting after this long. */
const UPLOAD_RUNNING_SECONDS = 60;

const UPLOADABLE = ["ordered", "received", "breakdown", "closing"];

interface DocumentRow {
  cycle_id: string;
  kind: string;
  key: string;
  content_type: string;
  bytes: number;
  sha256: string;
  uploaded_at: string;
}

/** Takes the one upload slot of this kind on this cycle, or answers upload_in_progress. */
function claimUpload(cycleId: string, kind: DocumentKind): string {
  const token = randomUUID();
  transaction(() => {
    const running = one<{ started_at: number }>("SELECT started_at FROM upload_locks WHERE cycle_id = ? AND kind = ?", cycleId, kind);
    if (running && running.started_at > nowSeconds() - UPLOAD_RUNNING_SECONDS) {
      throw conflict("upload_in_progress", "Another upload of this file is still running.");
    }
    run(
      `INSERT INTO upload_locks (cycle_id, kind, token, started_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (cycle_id, kind) DO UPDATE SET token = excluded.token, started_at = excluded.started_at`,
      cycleId, kind, token, nowSeconds(),
    );
  });
  return token;
}

function releaseUpload(cycleId: string, kind: DocumentKind, token: string): void {
  transaction(() => run("DELETE FROM upload_locks WHERE cycle_id = ? AND kind = ? AND token = ?", cycleId, kind, token));
}

/** Stores the bytes first; the record commits only after MinIO acknowledges them. */
export async function uploadDocument(
  viewer: Viewer, cycleId: string, kind: DocumentKind, signature: { type: string; ext: string }, body: Buffer,
): Promise<Reply> {
  const cycle = visibleCycle(cycleId, viewer);
  allow(viewer, "coordinator");
  if (!UPLOADABLE.includes(effectiveStatus(cycle))) {
    throw conflict("wrong_cycle_state", "Documents are uploaded once the order is placed.");
  }
  const token = claimUpload(cycleId, kind);
  try {
    const key = `cycles/${cycleId}/${kind}.${signature.ext}`;
    await putObject(key, body, signature.type);
    const sha256 = createHash("sha256").update(body).digest("hex");
    const replaced = transaction(() => {
      const old = one<DocumentRow>("SELECT * FROM documents WHERE cycle_id = ? AND kind = ?", cycleId, kind);
      run(
        `INSERT INTO documents (cycle_id, kind, key, content_type, bytes, sha256, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (cycle_id, kind) DO UPDATE SET key = excluded.key, content_type = excluded.content_type,
           bytes = excluded.bytes, sha256 = excluded.sha256, uploaded_at = excluded.uploaded_at`,
        cycleId, kind, key, signature.type, body.length, sha256, new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      );
      run("DELETE FROM stale_objects WHERE key = ?", key);
      if (old && old.key !== key) run("INSERT OR IGNORE INTO stale_objects (key, since) VALUES (?, strftime('%s','now'))", old.key);
      return old && old.key !== key ? old.key : null;
    });
    if (replaced) await dropStale(replaced);
    return { status: 201, body: { kind, key, bytes: body.length, sha256 } };
  } finally {
    releaseUpload(cycleId, kind, token);
  }
}

/** Deletes one replaced object once nothing records it, keeping it queued until MinIO confirms. */
async function dropStale(key: string): Promise<void> {
  if (one("SELECT 1 AS current FROM documents WHERE key = ?", key)) {
    transaction(() => run("DELETE FROM stale_objects WHERE key = ?", key));
    return;
  }
  if (await deleteObject(key)) transaction(() => run("DELETE FROM stale_objects WHERE key = ?", key));
}

/** Retries replaced packing slips that MinIO refused to delete, leaving cycles with a running upload alone. */
export async function deleteStaleObjects(): Promise<void> {
  const since = nowSeconds() - UPLOAD_RUNNING_SECONDS;
  for (const { key } of all<{ key: string }>("SELECT key FROM stale_objects")) {
    const cycleId = key.split("/")[1] ?? "";
    if (one("SELECT 1 AS running FROM upload_locks WHERE cycle_id = ? AND started_at > ?", cycleId, since)) continue;
    await dropStale(key);
  }
}

export function listDocuments(viewer: Viewer, cycleId: string): Reply {
  visibleCycle(cycleId, viewer);
  allow(viewer, "coordinator");
  const rows = all<DocumentRow>("SELECT * FROM documents WHERE cycle_id = ? ORDER BY kind", cycleId);
  return {
    status: 200,
    body: { documents: rows.map((d) => ({ kind: d.kind, key: d.key, bytes: d.bytes, sha256: d.sha256, uploaded_at: d.uploaded_at })) },
  };
}

export async function downloadDocument(viewer: Viewer, cycleId: string, kind: string) {
  visibleCycle(cycleId, viewer);
  allow(viewer, "coordinator");
  const doc = one<DocumentRow>("SELECT * FROM documents WHERE cycle_id = ? AND kind = ?", cycleId, kind);
  if (!doc) throw notFound("No such document.");
  return { data: await getObject(doc.key), contentType: doc.content_type, filename: doc.key.split("/").pop()! };
}
