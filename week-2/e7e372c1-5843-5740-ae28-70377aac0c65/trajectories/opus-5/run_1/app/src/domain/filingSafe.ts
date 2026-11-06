/**
 * The filing-safe exhibit check. Decided from the request body alone, before
 * the filing vault is ever contacted.
 */
const FORBIDDEN_NAMES: ReadonlySet<string> = new Set([
  '/JavaScript',
  '/JS',
  '/Launch',
  '/EmbeddedFile',
  '/Encrypt',
  '/URI',
  '/SubmitForm',
]);

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set('()<>[]{}/%'.split('').map((character) => character.charCodeAt(0)));

export type FilingSafeFailure = 'incomplete_pdf' | 'forbidden_name';

export const FILING_SAFE_MESSAGES: Readonly<Record<FilingSafeFailure, string>> = {
  incomplete_pdf: 'The exhibit is not a complete PDF.',
  forbidden_name: 'The exhibit contains active content, links, embedded files or encryption.',
};

function isNameTerminator(byte: number): boolean {
  return WHITESPACE.has(byte) || DELIMITERS.has(byte);
}

function hexValue(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}

/** Reads the PDF name starting at `start`, decoding every `#xx` hex escape. */
function readName(body: Buffer, start: number): { name: string; next: number } {
  let index = start + 1;
  let decoded = '/';
  while (index < body.length) {
    const byte = body[index] as number;
    if (isNameTerminator(byte)) break;
    if (byte === 0x23 && index + 2 < body.length) {
      const high = hexValue(body[index + 1] as number);
      const low = hexValue(body[index + 2] as number);
      if (high >= 0 && low >= 0) {
        decoded += String.fromCharCode(high * 16 + low);
        index += 3;
        continue;
      }
    }
    decoded += String.fromCharCode(byte);
    index += 1;
  }
  return { name: decoded, next: index };
}

export function checkFilingSafe(body: Buffer): FilingSafeFailure | null {
  if (body.length < 5 || body.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return 'incomplete_pdf';
  }
  const tailStart = Math.max(0, body.length - 1024);
  if (!body.subarray(tailStart).includes('%%EOF')) {
    return 'incomplete_pdf';
  }
  let index = 0;
  while (index < body.length) {
    if (body[index] === 0x2f) {
      const { name, next } = readName(body, index);
      if (FORBIDDEN_NAMES.has(name)) return 'forbidden_name';
      index = next > index ? next : index + 1;
      continue;
    }
    index += 1;
  }
  return null;
}
