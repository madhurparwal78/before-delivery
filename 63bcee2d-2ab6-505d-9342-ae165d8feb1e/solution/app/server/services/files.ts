import { createHash } from "node:crypto";
import { fileTooLarge } from "../http/errors.js";
import type { UploadedFile } from "../http/multipart.js";
import type { Fields } from "../http/validate.js";

// Uploaded files are judged by their first bytes alone, never by name or declared type
// (brief: Drawing register), within the one 10,000,000-byte file limit.

export const FILE_LIMIT = 10_000_000;
type FileKind = "pdf" | "png" | "jpg" | "svg";
export const CONTENT_TYPE: Record<FileKind, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml",
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const utf8 = new TextDecoder("utf-8", { fatal: true });

function svgText(data: Buffer): string | null {
  let text: string;
  try {
    text = utf8.decode(data);
  } catch {
    return null;
  }
  let rest = text.replace(/^﻿/, "");
  // Skip whitespace, the XML declaration, comments and the doctype before the first element.
  for (;;) {
    rest = rest.trimStart();
    const prolog = /^(<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>)/i.exec(rest);
    if (!prolog) break;
    rest = rest.slice(prolog[0].length);
  }
  return /^<svg[\s/>]/.test(rest) ? text : null;
}

function judge(data: Buffer): FileKind | null {
  if (data.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) return "png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  return svgText(data) === null ? null : "svg";
}

function svgHasScript(text: string): boolean {
  const decoded = text.replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number(dec)));
  if (/<(?:[a-z0-9_-]+:)?script[\s/>]/i.test(decoded)) return true;
  if (/<[^>]*\son[a-z0-9_.:-]*\s*=/i.test(decoded)) return true;
  return /javascript\s*:/i.test(decoded.replace(/[\t\r\n]/g, ""));
}

/** The original name kept for display, with any folder parts removed. */
const displayName = (filename: string): string => filename.split(/[\\/]/).pop() ?? filename;

export interface AcceptedFile {
  kind: FileKind;
  contentType: string;
  data: Buffer;
  name: string;
  bytes: number;
  sha256: string;
}

/**
 * Validates the single file of an upload field. `images` limits it to PNG and JPEG (renders and photos).
 * Too large is 413 file_too_large; other refusals are field errors on `file`.
 */
export function acceptFile(fields: Fields, file: UploadedFile | undefined, label: string, images = false): AcceptedFile | null {
  if (!file || (!file.filename && !file.data.length)) {
    fields.fail("file", `${label} is required.`);
    return null;
  }
  const name = displayName(file.filename);
  if (file.data.length > FILE_LIMIT) throw fileTooLarge(FILE_LIMIT);
  const kind = judge(file.data);
  if (images && kind !== "png" && kind !== "jpg") {
    fields.fail("file", `${name} isn't a PNG or JPEG image.`);
    return null;
  }
  if (!kind) {
    fields.fail("file", `${name} isn't a PDF, PNG, JPEG or SVG file.`);
    return null;
  }
  if (kind === "svg" && svgHasScript(file.data.toString("utf8"))) {
    fields.fail("file", `${name} contains scripts, so it wasn't accepted.`);
    return null;
  }
  return { kind, contentType: CONTENT_TYPE[kind], data: file.data, name, bytes: file.data.length,
    sha256: createHash("sha256").update(file.data).digest("hex") };
}

/** Headers for serving a stored file: its judged type, never sniffed, and SVGs sandboxed. */
export function fileHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    ...(contentType === CONTENT_TYPE.svg ? { "Content-Security-Policy": "sandbox" } : {}),
  };
}
