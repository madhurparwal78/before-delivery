import { OperationError } from "./operations/types";

export const INPUT_ENCODINGS = ["UTF-8", "UTF-16LE", "ISO-8859-1"] as const;
export type InputEncoding = (typeof INPUT_ENCODINGS)[number];

const utf8Encoder = new TextEncoder();
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const lenientUtf8Decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

export function utf8Bytes(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}

/** Decodes UTF-8, or returns null when the bytes are not valid UTF-8. */
export function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    return strictUtf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

export function decodeUtf8Lenient(bytes: Uint8Array): string {
  return lenientUtf8Decoder.decode(bytes);
}

/** Decodes bytes as UTF-8 text for a text operation, or fails with the published error. */
export function textOf(bytes: Uint8Array): string {
  const text = decodeUtf8Strict(bytes);
  if (text === null) throw new OperationError("Input is not valid UTF-8 text");
  return text;
}

const CHUNK = 0x8000;

export function latin1String(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return parts.join("");
}

function utf16leString(bytes: Uint8Array): string {
  return new TextDecoder("utf-16le", { ignoreBOM: true }).decode(bytes);
}

/** Text the way an encoding shows these bytes; undecodable bytes become the replacement character. */
export function decodeBytes(bytes: Uint8Array, encoding: InputEncoding): string {
  if (encoding === "UTF-8") return decodeUtf8Lenient(bytes);
  if (encoding === "UTF-16LE") return utf16leString(bytes.subarray(0, bytes.length - (bytes.length % 2)));
  return latin1String(bytes);
}

function codePointLabel(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** The first character an encoding cannot hold, or null when every character fits. */
export function firstUnencodable(text: string, encoding: InputEncoding): number | null {
  if (encoding !== "ISO-8859-1") return null;
  for (const character of text) {
    const codePoint = character.codePointAt(0) as number;
    if (codePoint > 0xff) return codePoint;
  }
  return null;
}

/** Encodes text; the caller has already ruled out unencodable characters with `firstUnencodable`. */
export function encodeText(text: string, encoding: InputEncoding): Uint8Array {
  if (encoding === "UTF-8") return utf8Bytes(text);
  if (encoding === "ISO-8859-1") {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
    return out;
  }
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    out[i * 2] = unit & 0xff;
    out[i * 2 + 1] = unit >> 8;
  }
  return out;
}

/** The published error for a character the encoding cannot hold. */
export function unencodableMessage(codePoint: number, encoding: InputEncoding): string {
  return `Character ${codePointLabel(codePoint)} cannot be encoded in ${encoding}`;
}

/** Line count: 0 for no bytes, otherwise the number of LF bytes plus 1. */
export function countLines(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let lines = 1;
  for (let i = bytes.indexOf(10); i !== -1; i = bytes.indexOf(10, i + 1)) lines++;
  return lines;
}

/** `\n`, `\r`, `\t` and `\\` in a text argument stand for LF, CR, tab and backslash. */
export function unescapeText(text: string): string {
  return text.replace(/\\([nrt\\])/g, (_, c: string) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : "\\"));
}

/** A byte the way an error message shows it: whitespace as an escape, other non-printable bytes as \xHH. */
export function describeByte(byte: number): string {
  if (byte === 10) return "\\n";
  if (byte === 13) return "\\r";
  if (byte === 9) return "\\t";
  if (byte >= 0x20 && byte < 0x7f) return String.fromCharCode(byte);
  return `\\x${byte.toString(16).padStart(2, "0")}`;
}

export function hexText(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function isValidUtf8(bytes: Uint8Array): boolean {
  return decodeUtf8Strict(bytes) !== null;
}
