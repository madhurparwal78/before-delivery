// Scan file names: decoding the upload's filename parameter and encoding the download's header.

import { hasControlCharacter } from "./text.js";

const ESCAPES: Record<string, string> = { "%22": '"', "%0d": "\r", "%0a": "\n" };

/** Decodes exactly %22, %0D and %0A (either letter case) and nothing else. */
export function decodeUploadFileName(parameter: string): string {
  return parameter.replace(/%22|%0d|%0a/gi, (escape) => ESCAPES[escape.toLowerCase()] ?? escape);
}

/** Why a decoded file name cannot be stored, or null when it can. */
export function fileNameProblem(name: string): string | null {
  if (name.length === 0) return "The file name is empty.";
  if (Buffer.byteLength(name, "utf8") > 255) return "The file name is longer than 255 bytes.";
  if (/[/\\]/.test(name)) return "The file name can't contain a slash.";
  if (hasControlCharacter(name)) return "The file name can't contain control characters.";
  return null;
}

const ATTR_CHAR = /[A-Za-z0-9!#$&+\-.^_`|~]/;

/** `attachment; filename="<ASCII fallback>"; filename*=UTF-8''<encoded name>` built from the stored name. */
export function contentDisposition(name: string): string {
  const fallback = [...name].map((c) => (/^[ -~]$/.test(c) && c !== '"' && c !== "\\" ? c : "_")).join("");
  const encoded = [...Buffer.from(name, "utf8")]
    .map((byte) => {
      const c = String.fromCharCode(byte);
      return byte < 0x80 && ATTR_CHAR.test(c) ? c : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
