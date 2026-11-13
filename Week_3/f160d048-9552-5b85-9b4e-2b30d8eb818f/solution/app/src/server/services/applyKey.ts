import { createHash } from "node:crypto";
import type { Multipart } from "../http/multipart";

export const IDEMPOTENCY_HEADER = "idempotency-key";

/** The same answers and the same file bytes for the same job give the same fingerprint. */
export function applyFingerprint(jobId: string, form: Multipart | undefined): string {
  const file = form?.files.find((entry) => entry.field === "resume");
  const fileHash = file ? createHash("sha256").update(file.data).digest("hex") : "";
  const answers = ["candidate_name", "contact_email", "phone", "cover_note"].map((name) => form?.fields[name] ?? "");
  return createHash("sha256").update(JSON.stringify([jobId, ...answers, fileHash])).digest("hex");
}
