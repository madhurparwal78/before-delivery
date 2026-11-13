/**
 * CSV record reading. One decision for how an import file is read: UTF-8 with
 * an optional byte-order mark, comma separated, double-quote quoting with `""`
 * as one literal quote, LF or CRLF line ends, and physical lines with no
 * characters at all are not records.
 */

import { ImportFileError } from './importError.js';

/** The file is not valid UTF-8 or a quoted field is never closed. */
export class CsvUnreadableError extends ImportFileError {
  constructor() {
    super("This file isn't readable as CSV.");
  }
}

export interface CsvRecord {
  readonly fields: string[];
  /** 1-based record number; blank physical lines get none. */
  readonly record: number;
}

const QUOTE = 0x22;
const COMMA = 0x2c;
const CR = 0x0d;
const LF = 0x0a;

/**
 * Parses CSV bytes into records. Throws CsvUnreadableError when the bytes after
 * the optional byte-order mark are not valid UTF-8, or a quoted field is opened
 * and never closed.
 */
export function parseCsv(bytes: Uint8Array): CsvRecord[] {
  let start = 0;
  // Optional UTF-8 byte-order mark.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  const body = bytes.subarray(start);
  const text = decodeUtf8(body);
  return parseCsvText(text);
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CsvUnreadableError();
  }
}

/**
 * Splits decoded text into records. A record may span physical lines when a
 * quoted field encloses them. A physical line with no characters at all is
 * not a record.
 */
export function parseCsvText(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let pos = 0;
  let recordNumber = 0;
  const len = text.length;
  let atStartOfRecord = true;

  while (pos < len) {
    // Skip blank physical lines: a run of CR/LF with nothing between.
    if (text.charCodeAt(pos) === CR || text.charCodeAt(pos) === LF) {
      pos += 1;
      atStartOfRecord = true;
      continue;
    }
    recordNumber += 1;
    const { fields, next } = readRecord(text, pos);
    records.push({ fields, record: recordNumber });
    pos = next;
  }
  void atStartOfRecord;
  return records;
}

function readRecord(text: string, start: number): { fields: string[]; next: number } {
  const fields: string[] = [];
  let pos = start;
  const len = text.length;
  for (;;) {
    if (pos >= len || text.charCodeAt(pos) === CR || text.charCodeAt(pos) === LF) {
      fields.push('');
      return { fields, next: pos >= len ? len : skipLineEnd(text, pos) };
    }
    if (text.charCodeAt(pos) === QUOTE) {
      const { field, next } = readQuoted(text, pos + 1);
      fields.push(field);
      pos = next;
      // After a closing quote the field runs to the next comma or line end.
      while (pos < len && text.charCodeAt(pos) !== COMMA && text.charCodeAt(pos) !== CR && text.charCodeAt(pos) !== LF) pos += 1;
      if (pos < len && text.charCodeAt(pos) === COMMA) {
        pos += 1;
        continue;
      }
      return { fields, next: pos >= len ? len : skipLineEnd(text, pos) };
    }
    // Unquoted field: to the next comma or line end.
    let end = pos;
    while (end < len && text.charCodeAt(end) !== COMMA && text.charCodeAt(end) !== CR && text.charCodeAt(end) !== LF) end += 1;
    fields.push(text.slice(pos, end));
    if (end < len && text.charCodeAt(end) === COMMA) {
      pos = end + 1;
      continue;
    }
    return { fields, next: end >= len ? len : skipLineEnd(text, end) };
  }
}

function readQuoted(text: string, start: number): { field: string; next: number } {
  let pos = start;
  let out = '';
  const len = text.length;
  for (;;) {
    if (pos >= len) throw new CsvUnreadableError(); // unclosed quote
    const code = text.charCodeAt(pos);
    if (code === QUOTE) {
      if (pos + 1 < len && text.charCodeAt(pos + 1) === QUOTE) {
        out += '"';
        pos += 2;
        continue;
      }
      return { field: out, next: pos + 1 };
    }
    out += text[pos];
    pos += 1;
  }
}

function skipLineEnd(text: string, pos: number): number {
  if (text.charCodeAt(pos) === CR && pos + 1 < text.length && text.charCodeAt(pos + 1) === LF) return pos + 2;
  return pos + 1;
}
