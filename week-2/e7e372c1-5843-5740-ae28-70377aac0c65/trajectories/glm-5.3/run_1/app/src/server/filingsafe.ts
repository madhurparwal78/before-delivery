// The single decision point for the filing-safe exhibit check. Decided from
// the request body alone, before the vault is contacted.

const FORBIDDEN_NAMES = ["/JavaScript", "/JS", "/Launch", "/EmbeddedFile", "/Encrypt", "/URI", "/SubmitForm"];

const PDF_DELIMITERS = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"]);
const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);

function isNameEnd(byte: number): boolean {
  return WHITESPACE.has(byte) || PDF_DELIMITERS.has(String.fromCharCode(byte));
}

function decodeHexEscape(body: Buffer, index: number): { byte: number; next: number } | null {
  let hex = "";
  let i = index;
  while (hex.length < 2 && i < body.length) {
    const c = String.fromCharCode(body[i] ?? 0);
    if (/[0-9a-fA-F]/.test(c)) {
      hex += c;
      i += 1;
    } else break;
  }
  if (hex.length === 0) return null;
  return { byte: parseInt(hex.padEnd(2, "0"), 16), next: i };
}

/** Extracts the whole name starting at `start` (which must be the `/`), decoding #xx escapes. */
function extractName(body: Buffer, start: number): { name: string; end: number } | null {
  if (body[start] !== 0x2f) return null;
  let name = "";
  let i = start + 1;
  while (i < body.length) {
    const b = body[i] ?? 0;
    if (isNameEnd(b)) break;
    if (b === 0x23 && i + 1 < body.length) {
      const decoded = decodeHexEscape(body, i + 1);
      if (decoded) {
        name += String.fromCharCode(decoded.byte);
        i = decoded.next;
        continue;
      }
      name += "#";
      i += 1;
      continue;
    }
    name += String.fromCharCode(b);
    i += 1;
  }
  return { name: "/" + name, end: i };
}

export interface FilingSafeResult {
  ok: boolean;
  reason: "incomplete_pdf" | "forbidden_name" | null;
}

export function checkFilingSafe(body: Buffer): FilingSafeResult {
  const head = body.subarray(0, 5).toString("latin1");
  if (head !== "%PDF-") return { ok: false, reason: "incomplete_pdf" };
  const tail = body.subarray(Math.max(0, body.length - 1024)).toString("latin1");
  if (!tail.includes("%%EOF")) return { ok: false, reason: "incomplete_pdf" };

  for (let i = 0; i < body.length; i++) {
    if (body[i] === 0x2f) {
      const extracted = extractName(body, i);
      if (extracted && FORBIDDEN_NAMES.includes(extracted.name)) {
        return { ok: false, reason: "forbidden_name" };
      }
    }
  }
  return { ok: true, reason: null };
}

export const FILING_SAFE_MESSAGES = {
  incomplete_pdf: "The exhibit is not a complete PDF.",
  forbidden_name: "The exhibit contains active content, links, embedded files or encryption.",
} as const;
