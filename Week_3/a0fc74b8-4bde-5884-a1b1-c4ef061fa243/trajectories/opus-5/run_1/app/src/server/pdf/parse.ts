import { inflateSync, unzipSync } from 'node:zlib';
import { asName, asNum, type PdfValue } from './model.ts';

const isWhite = (b: number): boolean =>
  b === 0x00 || b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20;

const isDelim = (b: number): boolean =>
  b === 0x28 ||
  b === 0x29 ||
  b === 0x3c ||
  b === 0x3e ||
  b === 0x5b ||
  b === 0x5d ||
  b === 0x7b ||
  b === 0x7d ||
  b === 0x2f ||
  b === 0x25;

const isRegular = (b: number): boolean => !isWhite(b) && !isDelim(b);

export class PdfSyntaxError extends Error {}

export class Lexer {
  readonly bytes: Buffer;
  pos: number;

  constructor(bytes: Buffer, pos = 0) {
    this.bytes = bytes;
    this.pos = pos;
  }

  private byte(at: number): number {
    return this.bytes[at] ?? -1;
  }

  skipWhite(): void {
    for (;;) {
      while (this.pos < this.bytes.length && isWhite(this.byte(this.pos))) this.pos += 1;
      if (this.byte(this.pos) !== 0x25) return;
      while (this.pos < this.bytes.length && this.byte(this.pos) !== 0x0a && this.byte(this.pos) !== 0x0d) {
        this.pos += 1;
      }
    }
  }

  readToken(): string {
    this.skipWhite();
    const start = this.pos;
    while (this.pos < this.bytes.length && isRegular(this.byte(this.pos))) this.pos += 1;
    if (this.pos === start) {
      this.pos += 1;
      return this.bytes.toString('latin1', start, this.pos);
    }
    return this.bytes.toString('latin1', start, this.pos);
  }

  expectKeyword(keyword: string): void {
    this.skipWhite();
    if (this.bytes.toString('latin1', this.pos, this.pos + keyword.length) !== keyword) {
      throw new PdfSyntaxError(`expected ${keyword} at ${this.pos}`);
    }
    this.pos += keyword.length;
  }

  private readName(): PdfValue {
    this.pos += 1;
    let name = '';
    while (this.pos < this.bytes.length && isRegular(this.byte(this.pos))) {
      const b = this.byte(this.pos);
      if (b === 0x23 && this.pos + 2 < this.bytes.length) {
        const hex = this.bytes.toString('latin1', this.pos + 1, this.pos + 3);
        const code = Number.parseInt(hex, 16);
        if (Number.isFinite(code)) {
          name += String.fromCharCode(code);
          this.pos += 3;
          continue;
        }
      }
      name += String.fromCharCode(b);
      this.pos += 1;
    }
    return { kind: 'name', name };
  }

  private readLiteralString(): PdfValue {
    this.pos += 1;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < this.bytes.length) {
      const b = this.byte(this.pos);
      this.pos += 1;
      if (b === 0x5c) {
        const next = this.byte(this.pos);
        this.pos += 1;
        switch (next) {
          case 0x6e: out.push(0x0a); break;
          case 0x72: out.push(0x0d); break;
          case 0x74: out.push(0x09); break;
          case 0x62: out.push(0x08); break;
          case 0x66: out.push(0x0c); break;
          case 0x0a: break;
          case 0x0d:
            if (this.byte(this.pos) === 0x0a) this.pos += 1;
            break;
          default:
            if (next >= 0x30 && next <= 0x37) {
              let octal = String.fromCharCode(next);
              for (let i = 0; i < 2; i += 1) {
                const digit = this.byte(this.pos);
                if (digit >= 0x30 && digit <= 0x37) {
                  octal += String.fromCharCode(digit);
                  this.pos += 1;
                } else break;
              }
              out.push(Number.parseInt(octal, 8) & 0xff);
            } else {
              out.push(next);
            }
        }
        continue;
      }
      if (b === 0x28) depth += 1;
      if (b === 0x29) {
        depth -= 1;
        if (depth === 0) break;
      }
      out.push(b);
    }
    return { kind: 'string', bytes: Uint8Array.from(out) };
  }

  private readHexString(): PdfValue {
    this.pos += 1;
    let hex = '';
    while (this.pos < this.bytes.length && this.byte(this.pos) !== 0x3e) {
      const c = String.fromCharCode(this.byte(this.pos));
      if (/[0-9a-fA-F]/.test(c)) hex += c;
      this.pos += 1;
    }
    this.pos += 1;
    if (hex.length % 2 === 1) hex += '0';
    return { kind: 'string', bytes: Uint8Array.from(Buffer.from(hex, 'hex')) };
  }

  parseValue(): PdfValue {
    this.skipWhite();
    const b = this.byte(this.pos);
    if (b === -1) throw new PdfSyntaxError('unexpected end of file');
    if (b === 0x2f) return this.readName();
    if (b === 0x28) return this.readLiteralString();
    if (b === 0x5b) {
      this.pos += 1;
      const items: PdfValue[] = [];
      for (;;) {
        this.skipWhite();
        if (this.byte(this.pos) === 0x5d) {
          this.pos += 1;
          return { kind: 'array', items };
        }
        items.push(this.parseValue());
      }
    }
    if (b === 0x3c) {
      if (this.byte(this.pos + 1) === 0x3c) {
        const parsed = this.parseDictOrStreamHeader();
        return { kind: 'dict', map: parsed.map };
      }
      return this.readHexString();
    }
    const token = this.readToken();
    if (token === 'true') return { kind: 'bool', value: true };
    if (token === 'false') return { kind: 'bool', value: false };
    if (token === 'null') return { kind: 'null' };
    if (/^[+-]?[0-9]*\.?[0-9][0-9.]*$/.test(token) || /^[+-]?\.?[0-9]+$/.test(token)) {
      const value = Number.parseFloat(token);
      if (/^[0-9]+$/.test(token)) {
        const saved = this.pos;
        const second = this.readToken();
        if (/^[0-9]+$/.test(second)) {
          const third = this.readToken();
          if (third === 'R') return { kind: 'ref', num: Number.parseInt(token, 10) };
        }
        this.pos = saved;
      }
      return { kind: 'num', value: Number.isFinite(value) ? value : 0 };
    }
    throw new PdfSyntaxError(`unexpected token "${token}" at ${this.pos}`);
  }

  parseDictOrStreamHeader(): DictOrStreamHeader {
    this.pos += 2;
    const map = new Map<string, PdfValue>();
    for (;;) {
      this.skipWhite();
      if (this.byte(this.pos) === 0x3e && this.byte(this.pos + 1) === 0x3e) {
        this.pos += 2;
        break;
      }
      if (this.byte(this.pos) !== 0x2f) throw new PdfSyntaxError(`bad dict key at ${this.pos}`);
      const key = this.readName();
      const value = this.parseValue();
      if (key.kind === 'name') map.set(key.name, value);
    }
    const saved = this.pos;
    this.skipWhite();
    if (this.bytes.toString('latin1', this.pos, this.pos + 6) === 'stream') {
      this.pos += 6;
      if (this.byte(this.pos) === 0x0d) this.pos += 1;
      if (this.byte(this.pos) === 0x0a) this.pos += 1;
      return { isStream: true, map, start: this.pos };
    }
    this.pos = saved;
    return { isStream: false, map };
  }

  /** Parses the body of an `N G obj` entry, where a stream header may appear. */
  parseIndirectBody(): PdfValue | StreamHeader {
    this.skipWhite();
    if (this.byte(this.pos) === 0x3c && this.byte(this.pos + 1) === 0x3c) {
      const parsed = this.parseDictOrStreamHeader();
      if (parsed.isStream) return parsed;
      return { kind: 'dict', map: parsed.map };
    }
    return this.parseValue();
  }
}

export interface StreamHeader {
  isStream: true;
  map: Map<string, PdfValue>;
  start: number;
}

export type DictOrStreamHeader = StreamHeader | { isStream: false; map: Map<string, PdfValue> };


const OBJ_PATTERN = /(\d{1,10})\s+(\d{1,5})\s+obj\b/g;

/** Decodes the filters that content and object streams use in practice. */
export const decodeStream = (map: Map<string, PdfValue>, raw: Uint8Array): Uint8Array => {
  const filterValue = map.get('Filter');
  const filters: string[] = [];
  if (filterValue?.kind === 'name') filters.push(filterValue.name);
  if (filterValue?.kind === 'array') {
    for (const item of filterValue.items) {
      const name = asName(item);
      if (name) filters.push(name);
    }
  }
  let data: Buffer<ArrayBufferLike> = Buffer.from(raw);
  for (const filter of filters) {
    switch (filter) {
      case 'FlateDecode':
        data = tryInflate(data);
        break;
      case 'ASCIIHexDecode': {
        const hex = data.toString('latin1').replace(/[^0-9a-fA-F]/g, '');
        data = Buffer.from(hex.length % 2 === 0 ? hex : `${hex}0`, 'hex');
        break;
      }
      case 'ASCII85Decode':
        data = ascii85Decode(data);
        break;
      case 'RunLengthDecode':
        data = runLengthDecode(data);
        break;
      default:
        return data;
    }
  }
  return applyPredictor(map, data);
};

const tryInflate = (data: Buffer): Buffer => {
  try {
    return inflateSync(data);
  } catch {
    try {
      return unzipSync(data);
    } catch {
      return Buffer.alloc(0);
    }
  }
};

const ascii85Decode = (data: Buffer): Buffer => {
  const text = data.toString('latin1').replace(/\s/g, '').replace(/^<~/, '');
  const end = text.indexOf('~>');
  const body = end === -1 ? text : text.slice(0, end);
  const out: number[] = [];
  let group: number[] = [];
  for (const char of body) {
    if (char === 'z' && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push(char.charCodeAt(0) - 33);
    if (group.length === 5) {
      let value = 0;
      for (const digit of group) value = value * 85 + digit;
      out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
      group = [];
    }
  }
  if (group.length > 0) {
    const missing = 5 - group.length;
    for (let i = 0; i < missing; i += 1) group.push(84);
    let value = 0;
    for (const digit of group) value = value * 85 + digit;
    const bytes = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    for (let i = 0; i < 4 - missing; i += 1) out.push(bytes[i] ?? 0);
  }
  return Buffer.from(out);
};

const runLengthDecode = (data: Buffer): Buffer => {
  const out: number[] = [];
  let at = 0;
  while (at < data.length) {
    const length = data[at] ?? 128;
    at += 1;
    if (length === 128) break;
    if (length < 128) {
      for (let i = 0; i <= length; i += 1) out.push(data[at + i] ?? 0);
      at += length + 1;
    } else {
      const byte = data[at] ?? 0;
      at += 1;
      for (let i = 0; i < 257 - length; i += 1) out.push(byte);
    }
  }
  return Buffer.from(out);
};

const applyPredictor = (map: Map<string, PdfValue>, data: Buffer): Buffer => {
  const parms = map.get('DecodeParms');
  const dict = parms?.kind === 'dict' ? parms.map : null;
  if (!dict) return data;
  const predictor = asNum(dict.get('Predictor')) ?? 1;
  if (predictor < 2) return data;
  const colors = asNum(dict.get('Colors')) ?? 1;
  const bpc = asNum(dict.get('BitsPerComponent')) ?? 8;
  const columns = asNum(dict.get('Columns')) ?? 1;
  const bpp = Math.ceil((colors * bpc) / 8);
  const rowLength = Math.ceil((colors * bpc * columns) / 8);
  if (predictor === 2) return data;
  const out: number[] = [];
  let previous = new Uint8Array(rowLength);
  let at = 0;
  while (at + 1 + rowLength <= data.length + rowLength && at < data.length) {
    const type = data[at] ?? 0;
    at += 1;
    const row = new Uint8Array(rowLength);
    for (let i = 0; i < rowLength; i += 1) row[i] = data[at + i] ?? 0;
    at += rowLength;
    for (let i = 0; i < rowLength; i += 1) {
      const raw = row[i] ?? 0;
      const left = i >= bpp ? (row[i - bpp] ?? 0) : 0;
      const up = previous[i] ?? 0;
      const upLeft = i >= bpp ? (previous[i - bpp] ?? 0) : 0;
      let value = raw;
      switch (type) {
        case 1: value = raw + left; break;
        case 2: value = raw + up; break;
        case 3: value = raw + Math.floor((left + up) / 2); break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default: value = raw;
      }
      row[i] = value & 0xff;
    }
    for (const byte of row) out.push(byte);
    previous = row;
  }
  return Buffer.from(out);
};

export interface ParsedFile {
  objects: Map<number, PdfValue>;
  trailerRoots: PdfValue[];
}

const findStreamEnd = (bytes: Buffer, start: number, declaredLength: number | null): number => {
  if (declaredLength !== null && declaredLength >= 0 && start + declaredLength <= bytes.length) {
    const after = bytes.toString('latin1', start + declaredLength, start + declaredLength + 20);
    if (/^\s*endstream/.test(after)) return start + declaredLength;
  }
  const index = bytes.indexOf('endstream', start, 'latin1');
  if (index === -1) return bytes.length;
  let end = index;
  if (bytes[end - 1] === 0x0a) end -= 1;
  if (bytes[end - 1] === 0x0d) end -= 1;
  return end;
};

/**
 * Builds the object index by scanning for `N G obj` markers rather than trusting
 * the cross-reference table, then expands any object streams it finds.
 */
export const parsePdf = (bytes: Buffer): ParsedFile => {
  const text = bytes.toString('latin1');
  const offsets = new Map<number, number>();
  OBJ_PATTERN.lastIndex = 0;
  for (;;) {
    const match = OBJ_PATTERN.exec(text);
    if (!match) break;
    offsets.set(Number.parseInt(match[1] ?? '0', 10), match.index);
  }

  const objects = new Map<number, PdfValue>();
  const pendingStreams: Array<{ num: number; map: Map<string, PdfValue>; start: number }> = [];

  for (const [num, offset] of offsets) {
    const lexer = new Lexer(bytes, offset);
    try {
      lexer.readToken();
      lexer.readToken();
      lexer.expectKeyword('obj');
      const value = lexer.parseIndirectBody();
      if ('isStream' in value) {
        pendingStreams.push({ num, map: value.map, start: value.start });
      } else {
        objects.set(num, value);
      }
    } catch {
      continue;
    }
  }

  const resolveLength = (value: PdfValue | undefined): number | null => {
    if (!value) return null;
    if (value.kind === 'num') return value.value;
    if (value.kind === 'ref') return asNum(objects.get(value.num));
    return null;
  };

  for (const pending of pendingStreams) {
    const end = findStreamEnd(bytes, pending.start, resolveLength(pending.map.get('Length')));
    objects.set(pending.num, {
      kind: 'stream',
      map: pending.map,
      raw: Uint8Array.prototype.slice.call(bytes, pending.start, end),
    });
  }

  for (const value of [...objects.values()]) {
    if (value.kind !== 'stream') continue;
    if (asName(value.map.get('Type')) !== 'ObjStm') continue;
    expandObjectStream(value, objects);
  }

  const trailerRoots: PdfValue[] = [];
  let searchAt = 0;
  for (;;) {
    const index = text.indexOf('trailer', searchAt);
    if (index === -1) break;
    searchAt = index + 7;
    try {
      const lexer = new Lexer(bytes, index + 7);
      const value = lexer.parseValue();
      if (value.kind === 'dict') {
        const root = value.map.get('Root');
        if (root) trailerRoots.push(root);
      }
    } catch {
      continue;
    }
  }
  for (const value of objects.values()) {
    if (value.kind !== 'stream') continue;
    if (asName(value.map.get('Type')) !== 'XRef') continue;
    const root = value.map.get('Root');
    if (root) trailerRoots.push(root);
  }

  return { objects, trailerRoots };
};

const expandObjectStream = (
  stream: Extract<PdfValue, { kind: 'stream' }>,
  objects: Map<number, PdfValue>,
): void => {
  const data = Buffer.from(decodeStream(stream.map, stream.raw));
  const count = asNum(stream.map.get('N')) ?? 0;
  const first = asNum(stream.map.get('First')) ?? 0;
  const header = new Lexer(data, 0);
  const pairs: Array<{ num: number; offset: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const num = Number.parseInt(header.readToken(), 10);
    const offset = Number.parseInt(header.readToken(), 10);
    if (!Number.isFinite(num) || !Number.isFinite(offset)) break;
    pairs.push({ num, offset });
  }
  for (const pair of pairs) {
    if (objects.has(pair.num)) continue;
    try {
      const lexer = new Lexer(data, first + pair.offset);
      objects.set(pair.num, lexer.parseValue());
    } catch {
      continue;
    }
  }
};
