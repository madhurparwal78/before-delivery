import { decodeUtf8Lenient, describeByte, latin1String, utf8Bytes } from "../bytes";
import { OperationError } from "./types";

const SPACE = 0x20;
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const COMMA = 0x2c;
const COLON = 0x3a;
const PERCENT = 0x25;
const EQUALS = 0x3d;

const HEX_DIGITS = utf8Bytes("0123456789abcdef");
const UPPER_HEX_DIGITS = utf8Bytes("0123456789ABCDEF");

const DELIMITERS: Record<string, string> = {
  Space: " ",
  None: "",
  Comma: ",",
  Colon: ":",
  "Line feed": "\n",
};

function delimiterBytes(label: string): Uint8Array {
  return utf8Bytes(DELIMITERS[label] ?? " ");
}

function isWhitespace(byte: number): boolean {
  return byte === SPACE || byte === TAB || byte === LF || byte === CR;
}

function isListSeparator(byte: number): boolean {
  return isWhitespace(byte) || byte === COMMA;
}

/** The value of a hex digit in either case, or -1. */
function hexValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x57;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x37;
  return -1;
}

/** Writes each byte as a fixed-width token, with the delimiter between tokens. */
function tokensOf(input: Uint8Array, delimiter: Uint8Array, width: number, write: (out: Uint8Array, at: number, byte: number) => void): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);
  const stride = width + delimiter.length;
  const out = new Uint8Array(input.length * stride - delimiter.length);
  for (let i = 0; i < input.length; i++) {
    const at = i * stride;
    if (i > 0) out.set(delimiter, at - delimiter.length);
    write(out, at, input[i] as number);
  }
  return out;
}

function invalidCharacter(kind: string, byte: number, position: number): OperationError {
  return new OperationError(`Invalid ${kind} '${describeByte(byte)}' at position ${position}`);
}

const STANDARD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const URL_SAFE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function alphabetOf(label: string): string {
  return label === "URL-safe" ? URL_SAFE_ALPHABET : STANDARD_ALPHABET;
}

export function toBase64(input: Uint8Array, alphabet: string): Uint8Array {
  const symbols = utf8Bytes(alphabetOf(alphabet));
  const padded = alphabet !== "URL-safe";
  const whole = Math.floor(input.length / 3) * 3;
  const rest = input.length - whole;
  const tail = rest === 0 ? 0 : padded ? 4 : rest + 1;
  const out = new Uint8Array((whole / 3) * 4 + tail);
  let at = 0;
  for (let i = 0; i < whole; i += 3) {
    const triple = ((input[i] as number) << 16) | ((input[i + 1] as number) << 8) | (input[i + 2] as number);
    out[at++] = symbols[triple >> 18] as number;
    out[at++] = symbols[(triple >> 12) & 63] as number;
    out[at++] = symbols[(triple >> 6) & 63] as number;
    out[at++] = symbols[triple & 63] as number;
  }
  if (rest > 0) {
    const triple = ((input[whole] as number) << 16) | (rest === 2 ? (input[whole + 1] as number) << 8 : 0);
    out[at++] = symbols[triple >> 18] as number;
    out[at++] = symbols[(triple >> 12) & 63] as number;
    if (rest === 2) out[at++] = symbols[(triple >> 6) & 63] as number;
    else if (padded) out[at++] = EQUALS;
    if (padded) out[at] = EQUALS;
  }
  return out;
}

export function fromBase64(input: Uint8Array, alphabet: string, strict: boolean): Uint8Array {
  const values = new Int8Array(256).fill(-1);
  const symbols = alphabetOf(alphabet);
  for (let i = 0; i < symbols.length; i++) values[symbols.charCodeAt(i)] = i;

  const sextets = new Uint8Array(input.length);
  let count = 0;
  let padding = 0;
  let firstPad = -1;
  for (let i = 0; i < input.length; i++) {
    const byte = input[i] as number;
    if (byte === EQUALS) {
      if (padding === 0) firstPad = i;
      padding++;
      if (padding === 3) throw invalidCharacter("Base64 character", byte, i);
    } else if (isWhitespace(byte)) {
      if (strict) throw invalidCharacter("Base64 character", byte, i);
    } else {
      const value = values[byte] as number;
      if (padding > 0) throw invalidCharacter("Base64 character", EQUALS, firstPad);
      if (value < 0) throw invalidCharacter("Base64 character", byte, i);
      sextets[count++] = value;
    }
  }
  if (count % 4 === 1) throw new OperationError("Base64 length is invalid");
  if (strict) {
    const needed = (4 - (count % 4)) % 4;
    if (padding < needed) throw new OperationError("Base64 padding is missing");
    if (padding > needed) throw invalidCharacter("Base64 character", EQUALS, firstPad + needed);
  }

  const out = new Uint8Array(Math.floor((count * 6) / 8));
  let at = 0;
  let i = 0;
  for (; i + 4 <= count; i += 4) {
    const quad = ((sextets[i] as number) << 18) | ((sextets[i + 1] as number) << 12) | ((sextets[i + 2] as number) << 6) | (sextets[i + 3] as number);
    out[at++] = quad >> 16;
    out[at++] = (quad >> 8) & 0xff;
    out[at++] = quad & 0xff;
  }
  if (i < count) {
    const quad = ((sextets[i] as number) << 18) | ((sextets[i + 1] as number) << 12) | (i + 2 < count ? (sextets[i + 2] as number) << 6 : 0);
    out[at++] = quad >> 16;
    if (i + 2 < count) out[at] = (quad >> 8) & 0xff;
  }
  return out;
}

export function toHex(input: Uint8Array, delimiter: string): Uint8Array {
  return tokensOf(input, delimiterBytes(delimiter), 2, (out, at, byte) => {
    out[at] = HEX_DIGITS[byte >> 4] as number;
    out[at + 1] = HEX_DIGITS[byte & 15] as number;
  });
}

export function fromHex(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length >> 1);
  let digits = 0;
  let high = 0;
  for (let i = 0; i < input.length; i++) {
    const byte = input[i] as number;
    if (isListSeparator(byte) || byte === COLON) continue;
    const value = hexValue(byte);
    if (value < 0) throw invalidCharacter("hex digit", byte, i);
    if (digits % 2 === 0) high = value;
    else out[digits >> 1] = (high << 4) | value;
    digits++;
  }
  if (digits % 2 !== 0) throw new OperationError("Odd number of hex digits");
  return out.slice(0, digits >> 1);
}

function printable(byte: number): string {
  return byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
}

export function toHexdump(input: Uint8Array, width: number): Uint8Array {
  const lines: string[] = [];
  const hexWidth = width * 3 - 1;
  for (let offset = 0; offset < input.length; offset += width) {
    const row = input.subarray(offset, offset + width);
    const pairs: string[] = [];
    let ascii = "";
    for (const byte of row) {
      pairs.push(byte.toString(16).padStart(2, "0"));
      ascii += printable(byte);
    }
    lines.push(`${offset.toString(16).padStart(8, "0")}  ${pairs.join(" ").padEnd(hexWidth)}  |${ascii}|`);
  }
  return utf8Bytes(lines.join("\n"));
}

const HEXDUMP_LINE = /^[0-9a-fA-F]{8} {2}((?:[0-9a-fA-F]{2}(?: [0-9a-fA-F]{2})*)?) *\|[^]*\|$/;

export function fromHexdump(input: Uint8Array): Uint8Array {
  const lines = latin1String(input).split("\n");
  const chunks: Uint8Array[] = [];
  lines.forEach((raw, index) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim() === "") return;
    const match = HEXDUMP_LINE.exec(line);
    if (match === null) throw new OperationError(`Invalid hexdump line ${index + 1}`);
    chunks.push(fromHex(utf8Bytes(match[1] as string)));
  });
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

const UNRESERVED = new Set(utf8Bytes("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~"));
const RESERVED = new Set(utf8Bytes("!*'();:@&=+$,/?#[]"));

export function urlEncode(input: Uint8Array, encodeAllReserved: boolean): Uint8Array {
  const out = new Uint8Array(input.length * 3);
  let at = 0;
  for (const byte of input) {
    if (UNRESERVED.has(byte) || (!encodeAllReserved && RESERVED.has(byte))) {
      out[at++] = byte;
    } else {
      out[at++] = PERCENT;
      out[at++] = UPPER_HEX_DIGITS[byte >> 4] as number;
      out[at++] = UPPER_HEX_DIGITS[byte & 15] as number;
    }
  }
  return out.slice(0, at);
}

export function urlDecode(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  let at = 0;
  for (let i = 0; i < input.length; i++) {
    const byte = input[i] as number;
    if (byte !== PERCENT) {
      out[at++] = byte;
      continue;
    }
    const high = i + 1 < input.length ? hexValue(input[i + 1] as number) : -1;
    const low = i + 2 < input.length ? hexValue(input[i + 2] as number) : -1;
    if (high < 0 || low < 0) throw new OperationError(`Invalid percent sequence at position ${i}`);
    out[at++] = (high << 4) | low;
    i += 2;
  }
  return out.slice(0, at);
}

export function toBinary(input: Uint8Array, delimiter: string): Uint8Array {
  return tokensOf(input, delimiterBytes(delimiter), 8, (out, at, byte) => {
    for (let bit = 0; bit < 8; bit++) out[at + bit] = 0x30 + ((byte >> (7 - bit)) & 1);
  });
}

export function fromBinary(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length >> 3);
  let bits = 0;
  let current = 0;
  for (let i = 0; i < input.length; i++) {
    const byte = input[i] as number;
    if (isListSeparator(byte)) continue;
    if (byte !== 0x30 && byte !== 0x31) throw invalidCharacter("binary digit", byte, i);
    current = (current << 1) | (byte - 0x30);
    bits++;
    if (bits % 8 === 0) {
      out[(bits >> 3) - 1] = current;
      current = 0;
    }
  }
  if (bits % 8 !== 0) throw new OperationError("Bit count is not a multiple of 8");
  return out.slice(0, bits >> 3);
}

export function toDecimal(input: Uint8Array, delimiter: string): Uint8Array {
  const parts: string[] = [];
  for (const byte of input) parts.push(String(byte));
  return utf8Bytes(parts.join(DELIMITERS[delimiter] ?? " "));
}

export function fromDecimal(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  let count = 0;
  let start = -1;
  for (let i = 0; i <= input.length; i++) {
    if (i < input.length && !isListSeparator(input[i] as number)) {
      if (start < 0) start = i;
      continue;
    }
    if (start < 0) continue;
    const token = decodeUtf8Lenient(input.subarray(start, i));
    const value = /^\d+$/.test(token) ? Number(token) : Number.NaN;
    if (!(value <= 255)) throw new OperationError(`Value ${token} is not a byte`);
    out[count++] = value;
    start = -1;
  }
  return out.slice(0, count);
}
