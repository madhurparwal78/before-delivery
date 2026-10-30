// Attachments: the extension decides the kind, the bytes must match it, and the filename rules.
import { splitsSurrogatePair } from "../../shared/noteText.js";

export const MAX_ATTACHMENT_BYTES = 10_000_000;
const MAX_FILENAME = 120;

export type AttachmentKind = "txt" | "vtt" | "pdf" | "png" | "jpeg";

const KINDS: Record<string, AttachmentKind> = { ".txt": "txt", ".vtt": "vtt", ".pdf": "pdf", ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg" };

const CONTENT_TYPES: Record<AttachmentKind, string> = {
  txt: "text/plain; charset=utf-8",
  vtt: "text/vtt; charset=utf-8",
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
};

/** The extension of a filename, dot included ("" when there is none). */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot);
}

/** The display filename: last path segment, NFC, base cut so the whole name fits 120 characters, "file" for an empty base. */
export function displayFilename(clientName: string): string {
  const last = clientName.split(/[/\\]/).pop() ?? "";
  const name = last.normalize("NFC");
  const extension = extensionOf(name);
  let base = name.slice(0, name.length - extension.length);
  let keep = Math.max(0, MAX_FILENAME - extension.length);
  if (splitsSurrogatePair(base, keep)) keep -= 1;
  base = base.slice(0, keep);
  return `${base === "" ? "file" : base}${extension}`;
}

export function attachmentKind(filename: string): AttachmentKind | null {
  return KINDS[extensionOf(filename).toLowerCase()] ?? null;
}

export function contentTypeOf(kind: AttachmentKind): string {
  return CONTENT_TYPES[kind];
}

function isUtf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

const startsWith = (bytes: Buffer, prefix: readonly number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((byte, i) => bytes[i] === byte);

function isWebVtt(bytes: Buffer): boolean {
  if (!isUtf8Text(bytes)) return false;
  const body = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? bytes.subarray(3) : bytes;
  if (body.subarray(0, 6).toString("latin1") !== "WEBVTT") return false;
  const rest = body.subarray(6);
  return rest.length === 0 || rest[0] === 0x20 || rest[0] === 0x09 || rest[0] === 0x0a || startsWith(rest, [0x0d, 0x0a]);
}

/** The content check: true when the bytes really are a file of this kind. */
export function contentMatches(kind: AttachmentKind, bytes: Buffer): boolean {
  switch (kind) {
    case "png": return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpeg": return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "pdf": return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
    case "txt": return isUtf8Text(bytes);
    case "vtt": return isWebVtt(bytes);
  }
}

/** "Ränder call.vtt" → "R-nder-call.vtt": the object key's name part. */
function storageSafeName(filename: string): string {
  return filename.replace(/[^A-Za-z0-9._-]/gu, "-");
}

export function attachmentKey(noteId: string, attachmentId: string, filename: string): string {
  return `notes/${noteId}/${attachmentId}-${storageSafeName(filename)}`;
}

export function noteObjectPrefix(noteId: string): string {
  return `notes/${noteId}/`;
}

const DISPOSITION_SAFE = /[A-Za-z0-9!#$&+\-.^_`|~]/;

export function contentDisposition(filename: string): string {
  const fallback = Array.from(filename, (char) => ((char.codePointAt(0) ?? 0) > 0x7f || char === '"' || char === "\\" ? "_" : char)).join("");
  const encoded = Array.from(Buffer.from(filename, "utf8"), (byte) => {
    const char = String.fromCharCode(byte);
    return byte < 0x80 && DISPOSITION_SAFE.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
