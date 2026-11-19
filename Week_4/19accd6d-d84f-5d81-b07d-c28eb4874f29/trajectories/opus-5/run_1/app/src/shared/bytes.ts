export type TextEncodingName = 'UTF-8' | 'UTF-16LE' | 'ISO-8859-1';

export const textEncodingNames: readonly TextEncodingName[] = ['UTF-8', 'UTF-16LE', 'ISO-8859-1'];

/** Thrown by an operation; the message is the catalogue error text. */
export class OpError extends Error {}

export const NOT_UTF8 = 'Input is not valid UTF-8 text';

const utf8Encoder = new TextEncoder();
const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const utf8Lossy = new TextDecoder('utf-8');

export function encodingErrorMessage(codePoint: number, encoding: TextEncodingName): string {
  const hex = codePoint.toString(16).toUpperCase().padStart(4, '0');
  return `Character U+${hex} cannot be encoded in ${encoding}`;
}

/** Encodes text in one of the three supported encodings. Throws OpError for an unencodable character. */
export function encodeText(text: string, encoding: TextEncodingName): Uint8Array {
  if (encoding === 'UTF-8') return utf8Encoder.encode(text);
  if (encoding === 'UTF-16LE') {
    const out = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i += 1) {
      const unit = text.charCodeAt(i);
      out[i * 2] = unit & 0xff;
      out[i * 2 + 1] = unit >>> 8;
    }
    return out;
  }
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit > 0xff) {
      throw new OpError(encodingErrorMessage(text.codePointAt(i) ?? unit, encoding));
    }
    out[i] = unit;
  }
  return out;
}

/** Decodes bytes in one of the three supported encodings. Throws OpError when the bytes do not fit. */
export function decodeText(bytes: Uint8Array, encoding: TextEncodingName): string {
  if (encoding === 'UTF-8') {
    try {
      return utf8Strict.decode(bytes);
    } catch {
      throw new OpError(NOT_UTF8);
    }
  }
  if (encoding === 'UTF-16LE') {
    if (bytes.length % 2 !== 0) throw new OpError('UTF-16LE input has an odd number of bytes');
    let text = '';
    for (let i = 0; i < bytes.length; i += 2) {
      text += String.fromCharCode(bytes[i]! | (bytes[i + 1]! << 8));
    }
    return text;
  }
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/** Decodes bytes as UTF-8 for a text operation. */
export function asText(bytes: Uint8Array): string {
  return decodeText(bytes, 'UTF-8');
}

export function fromText(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}

export function decodeLossy(bytes: Uint8Array): string {
  return utf8Lossy.decode(bytes);
}

/** Decodes bytes for display, showing undecodable bytes as the replacement character. */
export function decodeLossyIn(bytes: Uint8Array, encoding: TextEncodingName): string {
  if (encoding === 'UTF-8') return utf8Lossy.decode(bytes);
  if (encoding === 'ISO-8859-1') {
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return text;
  }
  let text = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    text += String.fromCharCode(bytes[i]! | (bytes[i + 1]! << 8));
  }
  if (bytes.length % 2 !== 0) text += '\uFFFD';
  return text;
}

export function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    utf8Strict.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Counts lines: 0 for empty bytes, otherwise the number of LF bytes plus 1. */
export function countLines(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  let lf = 0;
  for (const byte of bytes) if (byte === 0x0a) lf += 1;
  return lf + 1;
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export function toHexLower(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Renders one input byte for a positional error message. */
export function renderErrorChar(byte: number): string {
  if (byte === 0x0a) return '\\n';
  if (byte === 0x0d) return '\\r';
  if (byte === 0x09) return '\\t';
  if (byte < 0x20 || byte > 0x7e) return `\\x${byte.toString(16).padStart(2, '0')}`;
  return String.fromCharCode(byte);
}

const BASE64_STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64Alphabet(urlSafe: boolean): string {
  return urlSafe ? BASE64_URL : BASE64_STANDARD;
}

export function encodeBase64(bytes: Uint8Array, urlSafe: boolean): string {
  const alphabet = base64Alphabet(urlSafe);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += alphabet[b0 >>> 2]!;
    if (b1 === undefined) {
      out += alphabet[(b0 & 0x03) << 4]!;
      if (!urlSafe) out += '==';
      break;
    }
    out += alphabet[((b0 & 0x03) << 4) | (b1 >>> 4)]!;
    if (b2 === undefined) {
      out += alphabet[(b1 & 0x0f) << 2]!;
      if (!urlSafe) out += '=';
      break;
    }
    out += alphabet[((b1 & 0x0f) << 2) | (b2 >>> 6)]!;
    out += alphabet[b2 & 0x3f]!;
  }
  return out;
}

/** Decodes a base64 string whose characters are already known to be valid. */
export function decodeBase64Chars(chars: string, urlSafe: boolean): Uint8Array {
  const alphabet = base64Alphabet(urlSafe);
  const values = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i += 1) values[alphabet.charCodeAt(i)] = i;
  const full = Math.floor(chars.length / 4);
  const rest = chars.length % 4;
  const out = new Uint8Array(full * 3 + (rest === 0 ? 0 : rest - 1));
  let at = 0;
  let bits = 0;
  let acc = 0;
  for (let i = 0; i < chars.length; i += 1) {
    acc = (acc << 6) | values[chars.charCodeAt(i)]!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at] = (acc >>> bits) & 0xff;
      at += 1;
    }
  }
  return out;
}

export function base64urlEncode(bytes: Uint8Array): string {
  return encodeBase64(bytes, true);
}

/** Decodes unpadded base64url, returning null when the text is not base64url. */
export function base64urlDecode(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9\-_]*$/.test(text)) return null;
  if (text.length % 4 === 1) return null;
  return decodeBase64Chars(text, true);
}

/** Splits bytes on a byte sequence. */
export function splitBytes(bytes: Uint8Array, separator: Uint8Array): Uint8Array[] {
  if (separator.length === 0) return [bytes];
  const parts: Uint8Array[] = [];
  let start = 0;
  outer: for (let i = 0; i + separator.length <= bytes.length; ) {
    for (let j = 0; j < separator.length; j += 1) {
      if (bytes[i + j] !== separator[j]) {
        i += 1;
        continue outer;
      }
    }
    parts.push(bytes.subarray(start, i));
    i += separator.length;
    start = i;
  }
  parts.push(bytes.subarray(start));
  return parts;
}

/** Splits text into LF-separated lines, keeping a trailing line break aside. */
export function splitLines(text: string): { lines: string[]; trailing: boolean } {
  if (text.endsWith('\n')) {
    const body = text.slice(0, -1);
    return { lines: body.length === 0 ? [''] : body.split('\n'), trailing: true };
  }
  return { lines: text.split('\n'), trailing: false };
}

export function joinLines(lines: readonly string[], trailing: boolean): string {
  return lines.join('\n') + (trailing ? '\n' : '');
}
