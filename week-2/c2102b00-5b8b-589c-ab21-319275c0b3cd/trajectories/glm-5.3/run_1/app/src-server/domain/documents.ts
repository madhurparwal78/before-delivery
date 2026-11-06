import { createHash } from "node:crypto";
import { CycleRow, all, one, run, tx } from "../db";
import { ApiError, errors } from "../errors";
import { acquireUploadLease, releaseUploadLease } from "../util/idem";
import * as s3 from "../providers/s3";

export type DocKind = "invoice" | "packing-slip";

/** The single place that checks an upload's declared type against its bytes. */
export function checkUpload(contentType: string | undefined, body: Buffer): { type: string; ext: string } | ApiError {
  const declared = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (body.length === 0) return errors.unsupportedMediaType();
  if (declared === "application/pdf") {
    if (body.subarray(0, 5).toString("latin1") === "%PDF-") return { type: "application/pdf", ext: "pdf" };
    return errors.unsupportedMediaType();
  }
  if (declared === "image/png") {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (body.subarray(0, 8).equals(sig)) return { type: "image/png", ext: "png" };
    return errors.unsupportedMediaType();
  }
  if (declared === "image/jpeg") {
    if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
    return errors.unsupportedMediaType();
  }
  return errors.unsupportedMediaType();
}

export function storageKey(cycleId: string, kind: DocKind, ext: string): string {
  if (kind === "invoice") return `cycles/${cycleId}/invoice.pdf`;
  return `cycles/${cycleId}/packing-slip.${ext}`;
}

export interface StoredDoc {
  kind: string;
  key: string;
  bytes: number;
  sha256: string;
}

export function documentRecord(cycleId: string, kind: DocKind): StoredDoc | undefined {
  const row = one<{ kind: string; key: string; bytes: number; sha256: string }>(
    "SELECT kind, key, bytes, sha256 FROM documents WHERE cycle_id = ? AND kind = ?",
    cycleId, kind
  );
  return row;
}

export function documentsOf(cycleId: string): (StoredDoc & { uploaded_at: number })[] {
  return all(
    "SELECT kind, key, bytes, sha256, uploaded_at FROM documents WHERE cycle_id = ? ORDER BY kind",
    cycleId
  );
}

/** Upload state rule: accepted in ordered, received, breakdown, closing. */
export function uploadsAllowed(c: CycleRow): boolean {
  return ["ordered", "received", "breakdown", "closing"].includes(c.status);
}

export async function uploadDocument(c: CycleRow, kind: DocKind, body: Buffer, type: string, ext: string): Promise<StoredDoc> {
  const sha256 = createHash("sha256").update(body).digest("hex");
  const key = storageKey(c.id, kind, ext);
  if (!acquireUploadLease(c.id, kind)) throw errors.uploadInProgress();
  try {
    await s3.putObject(key, body, type);
    tx(() => {
      const previous = documentRecord(c.id, kind);
      run(
        `INSERT INTO documents (cycle_id, kind, key, bytes, sha256, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (cycle_id, kind) DO UPDATE SET key = excluded.key, bytes = excluded.bytes, sha256 = excluded.sha256, uploaded_at = excluded.uploaded_at`,
        c.id, kind, key, body.length, sha256, Math.floor(Date.now() / 1000)
      );
      if (previous && previous.key !== key) {
        run("INSERT OR IGNORE INTO pending_slip_deletions (key, enqueued_at) VALUES (?, ?)", previous.key, Math.floor(Date.now() / 1000));
      }
    });
  } finally {
    releaseUploadLease(c.id, kind);
  }
  scheduleSlipCleanup();
  return { kind, key, bytes: body.length, sha256 };
}

let cleanupRunning = false;
export function scheduleSlipCleanup(): void {
  if (cleanupRunning) return;
  cleanupRunning = true;
  void (async () => {
    for (;;) {
      const pending = all<{ key: string }>("SELECT key FROM pending_slip_deletions ORDER BY enqueued_at LIMIT 1");
      if (pending.length === 0) break;
      try {
        await s3.deleteObject(pending[0].key);
        tx(() => {
          run("DELETE FROM pending_slip_deletions WHERE key = ?", pending[0].key);
        });
      } catch {
        await new Promise((r) => setTimeout(r, 30000));
      }
    }
    cleanupRunning = false;
  })();
}
