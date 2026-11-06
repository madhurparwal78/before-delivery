// The filing-safe exhibit check: a complete PDF with no active content, links, embedded files or encryption.

const FORBIDDEN_NAMES = new Set(["JavaScript", "JS", "Launch", "EmbeddedFile", "Encrypt", "URI", "SubmitForm"]);
const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set(["(", ")", "<", ">", "[", "]", "{", "}", "/", "%"].map((c) => c.charCodeAt(0)));
const SLASH = 0x2f;
const HASH = 0x23;

const INCOMPLETE_PDF = "The exhibit is not a complete PDF.";
const ACTIVE_CONTENT = "The exhibit contains active content, links, embedded files or encryption.";

function isHex(byte: number | undefined): boolean {
  return byte !== undefined && ((byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x46) || (byte >= 0x61 && byte <= 0x66));
}

function isCompletePdf(body: Buffer): boolean {
  return body.subarray(0, 5).toString("latin1") === "%PDF-" && body.subarray(Math.max(0, body.length - 1024)).includes("%%EOF", 0, "latin1");
}

function containsForbiddenName(body: Buffer): boolean {
  let index = 0;
  while (index < body.length) {
    if (body[index] !== SLASH) {
      index += 1;
      continue;
    }
    index += 1;
    let name = "";
    while (index < body.length) {
      const byte = body[index];
      if (byte === undefined || WHITESPACE.has(byte) || DELIMITERS.has(byte)) break;
      if (byte === HASH && isHex(body[index + 1]) && isHex(body[index + 2])) {
        name += String.fromCharCode(Number.parseInt(body.subarray(index + 1, index + 3).toString("latin1"), 16));
        index += 3;
      } else {
        name += String.fromCharCode(byte);
        index += 1;
      }
    }
    if (FORBIDDEN_NAMES.has(name)) return true;
  }
  return false;
}

/** The message for the `file` field when the body is refused, otherwise null. */
export function filingSafeRefusal(body: Buffer): string | null {
  if (!isCompletePdf(body)) return INCOMPLETE_PDF;
  return containsForbiddenName(body) ? ACTIVE_CONTENT : null;
}
