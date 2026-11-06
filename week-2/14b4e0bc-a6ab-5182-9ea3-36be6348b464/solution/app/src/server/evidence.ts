import { FieldErrors, invalid } from "./errors.ts";
import { codePoints, hasControlCharacter } from "./text.ts";

const EVIDENCE_MAX_BYTES = 5_000_000;

interface Submission {
  file: { filename: string; bytes: Buffer } | null;
  note: string | null;
}

/** Parses a multipart/form-data verify body into its evidence file and note. */
export function parseMultipart(contentType: string | undefined, body: Buffer): Submission {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType ?? "");
  if (!m || !/^multipart\/form-data/i.test(contentType ?? "")) throw invalid({ evidence: "Attach a PDF or text sign-off." });
  const delimiter = Buffer.from(`--${m[1] ?? m[2]}`);
  const out: Submission = { file: null, note: null };
  let start = body.indexOf(delimiter);
  while (start >= 0) {
    const partStart = start + delimiter.length;
    if (body.subarray(partStart, partStart + 2).toString() === "--") break;
    const next = body.indexOf(delimiter, partStart);
    if (next < 0) break;
    const part = body.subarray(partStart + 2, next - 2);
    const split = part.indexOf("\r\n\r\n");
    if (split >= 0) {
      const headers = part.subarray(0, split).toString("utf8");
      const content = part.subarray(split + 4);
      const name = /name="([^"]*)"/i.exec(headers)?.[1];
      const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
      if (name === "evidence" && filename !== undefined) out.file = { filename, bytes: Buffer.from(content) };
      if (name === "note") out.note = content.toString("utf8");
    }
    start = next;
  }
  return out;
}

export interface AcceptedEvidence {
  filename: string;
  bytes: Buffer;
  contentType: string;
  note: string | null;
}

/** Evidence acceptance (DP-49): the first failing rule in the published order; the server decides the type. */
export function acceptEvidence(submission: Submission): AcceptedEvidence {
  const errors = new FieldErrors();
  const file = submission.file;
  const name = file?.filename ?? "";
  if (!file || file.bytes.length === 0) errors.add("evidence", "Attach a PDF or text sign-off.");
  else if (file.bytes.length > EVIDENCE_MAX_BYTES) errors.add("evidence", "Evidence must be 5,000,000 bytes or smaller.");
  else if (codePoints(name) > 200) errors.add("evidence", "Evidence filename must be 200 characters or fewer.");
  else if (/[/\\]/.test(name)) errors.add("evidence", "Evidence filename cannot contain / or \\.");
  else if (hasControlCharacter(name)) errors.add("evidence", "Evidence filename cannot contain control characters.");
  else if (!/\.(pdf|txt)$/i.test(name)) errors.add("evidence", "Evidence must be a .pdf or .txt file.");
  if (submission.note !== null && codePoints(submission.note) > 500) errors.add("note", "Note must be 500 characters or fewer.");
  errors.throwIfAny();
  return {
    filename: name,
    bytes: file!.bytes,
    contentType: /\.pdf$/i.test(name) ? "application/pdf" : "text/plain; charset=utf-8",
    note: submission.note,
  };
}
