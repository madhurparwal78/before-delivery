import pako from 'pako';
import {
  OpError,
  asText,
  base64Alphabet,
  concatBytes,
  decodeBase64Chars,
  decodeText,
  encodeBase64,
  encodeText,
  fromText,
  joinLines,
  renderErrorChar,
  splitLines,
  type TextEncodingName,
} from './bytes.js';
import { crc32, md5, sha1, sha256 } from './hash.js';
import { parseCsv, csvField } from './csv.js';
import { jsonFieldToCsvText, parseJson, writeJson, type JsonValue } from './json.js';

export type OpFamily = 'Encoding' | 'Text' | 'Data formats' | 'Checksums' | 'Compression' | 'Flow';

export const opFamilies: readonly OpFamily[] = [
  'Encoding',
  'Text',
  'Data formats',
  'Checksums',
  'Compression',
  'Flow',
];

export type ArgSpec =
  | { kind: 'option'; label: string; key: string; options: readonly string[]; value: string }
  | { kind: 'toggle'; label: string; key: string; value: boolean }
  | { kind: 'int'; label: string; key: string; min: number; max: number; value: number }
  | { kind: 'text'; label: string; key: string; value: string }
  | { kind: 'flags'; label: string; key: string; value: string };

export type ArgValue = string | boolean | number;
export type Args = Record<string, ArgValue>;

export interface OpDef {
  readonly name: string;
  readonly family: OpFamily;
  readonly args: readonly ArgSpec[];
  readonly control?: 'fork' | 'merge';
  readonly regex?: true;
  readonly run?: (input: Uint8Array, args: Args) => Uint8Array;
}

export const FLAG_LETTERS = ['g', 'i', 'm', 's'] as const;

export const flagLabels: Record<string, string> = {
  g: 'Global (g)',
  i: 'Ignore case (i)',
  m: 'Multiline (m)',
  s: 'Dot matches newline (s)',
};

const option = (label: string, key: string, options: readonly string[]): ArgSpec => ({
  kind: 'option',
  label,
  key,
  options,
  value: options[0]!,
});
const toggle = (label: string, key: string, value: boolean): ArgSpec => ({ kind: 'toggle', label, key, value });
const int = (label: string, key: string, min: number, max: number, value: number): ArgSpec => ({
  kind: 'int',
  label,
  key,
  min,
  max,
  value,
});
const text = (label: string, key: string, value: string): ArgSpec => ({ kind: 'text', label, key, value });
const flags = (value: string): ArgSpec => ({ kind: 'flags', label: 'Flags', key: 'flags', value });

const str = (args: Args, key: string): string => String(args[key]);
const bool = (args: Args, key: string): boolean => args[key] === true;
const num = (args: Args, key: string): number => Number(args[key]);

/** Escapes understood inside Split delimiter, Joiner and the CSV delimiter. */
export function unescapeTextArg(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '\\') {
      const next = value[i + 1];
      if (next === 'n') {
        out += '\n';
        i += 1;
        continue;
      }
      if (next === 'r') {
        out += '\r';
        i += 1;
        continue;
      }
      if (next === 't') {
        out += '\t';
        i += 1;
        continue;
      }
      if (next === '\\') {
        out += '\\';
        i += 1;
        continue;
      }
    }
    out += value[i];
  }
  return out;
}

const DELIMITER_TEXT: Record<string, string> = {
  Space: ' ',
  None: '',
  Comma: ',',
  Colon: ':',
  'Line feed': '\n',
};

/** The byte length a delimiter label contributes between two groups. */
export function delimiterLength(label: string): number {
  return DELIMITER_TEXT[label]!.length;
}

const SPLIT_PATTERN = /[ ,:\t\r\n]+/;

function base64Decode(input: Uint8Array, urlSafe: boolean, strict: boolean): Uint8Array {
  const alphabet = base64Alphabet(urlSafe);
  const valid = new Set<number>();
  for (const ch of alphabet) valid.add(ch.charCodeAt(0));
  let chars = '';
  let padSeen = 0;
  let padFirst = -1;
  for (let i = 0; i < input.length; i += 1) {
    const byte = input[i]!;
    if (byte === 0x3d) {
      padSeen += 1;
      if (padSeen === 1) padFirst = i;
      if (padSeen === 3) {
        throw new OpError(`Invalid Base64 character '=' at position ${i}`);
      }
      continue;
    }
    const whitespace = byte === 0x20 || byte === 0x09 || byte === 0x0d || byte === 0x0a;
    if (whitespace && !strict) continue;
    if (!valid.has(byte)) {
      throw new OpError(`Invalid Base64 character '${renderErrorChar(byte)}' at position ${i}`);
    }
    if (padSeen > 0) {
      throw new OpError(`Invalid Base64 character '=' at position ${padFirst}`);
    }
    chars += String.fromCharCode(byte);
  }
  if (chars.length % 4 === 1) throw new OpError('Base64 length is invalid');
  if (strict && (chars.length + padSeen) % 4 !== 0) throw new OpError('Base64 padding is missing');
  return decodeBase64Chars(chars, urlSafe);
}

function hexDecode(input: Uint8Array): Uint8Array {
  const digits: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const byte = input[i]!;
    if (byte === 0x20 || byte === 0x2c || byte === 0x3a || byte === 0x09 || byte === 0x0d || byte === 0x0a) continue;
    const value = hexDigit(byte);
    if (value < 0) throw new OpError(`Invalid hex digit '${renderErrorChar(byte)}' at position ${i}`);
    digits.push(value);
  }
  if (digits.length % 2 !== 0) throw new OpError('Odd number of hex digits');
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = (digits[i * 2]! << 4) | digits[i * 2 + 1]!;
  return out;
}

function hexDigit(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  return -1;
}

const HEXDUMP_LINE = /^([0-9a-fA-F]{8})  ((?:[0-9a-fA-F]{2}(?: [0-9a-fA-F]{2})*)?)( *)\|.*\|$/;

function hexdumpDecode(input: Uint8Array): Uint8Array {
  const lines = asText(input).split('\n');
  const parts: Uint8Array[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.trim() === '') continue;
    const match = HEXDUMP_LINE.exec(line);
    if (!match) throw new OpError(`Invalid hexdump line ${i + 1}`);
    const pairs = match[2]!.length === 0 ? [] : match[2]!.split(' ');
    const bytes = new Uint8Array(pairs.length);
    for (let p = 0; p < pairs.length; p += 1) bytes[p] = Number.parseInt(pairs[p]!, 16);
    parts.push(bytes);
  }
  return concatBytes(parts);
}

const URL_UNRESERVED = /[A-Za-z0-9\-_.~]/;
const URL_EXTRA_KEPT = "!*'();:@&=+$,/?#[]";

function urlEncode(input: Uint8Array, allReserved: boolean): Uint8Array {
  let out = '';
  for (const byte of input) {
    const ch = String.fromCharCode(byte);
    if (URL_UNRESERVED.test(ch) || (!allReserved && URL_EXTRA_KEPT.includes(ch))) out += ch;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return fromText(out);
}

function urlDecode(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    if (input[i] === 0x25) {
      const high = hexDigit(input[i + 1] ?? -1);
      const low = hexDigit(input[i + 2] ?? -1);
      if (high < 0 || low < 0) throw new OpError(`Invalid percent sequence at position ${i}`);
      out.push((high << 4) | low);
      i += 2;
      continue;
    }
    out.push(input[i]!);
  }
  return new Uint8Array(out);
}

function binaryDecode(input: Uint8Array): Uint8Array {
  let bits = '';
  for (let i = 0; i < input.length; i += 1) {
    const byte = input[i]!;
    if (byte === 0x20 || byte === 0x2c || byte === 0x09 || byte === 0x0d || byte === 0x0a) continue;
    if (byte !== 0x30 && byte !== 0x31) {
      throw new OpError(`Invalid binary digit '${renderErrorChar(byte)}' at position ${i}`);
    }
    bits += String.fromCharCode(byte);
  }
  if (bits.length % 8 !== 0) throw new OpError('Bit count is not a multiple of 8');
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

function decimalDecode(input: Uint8Array): Uint8Array {
  const tokens = asText(input).split(SPLIT_PATTERN).filter((token) => token.length > 0);
  const out = new Uint8Array(tokens.length);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (!/^\d+$/.test(token) || Number(token) > 255) throw new OpError(`Value ${token} is not a byte`);
    out[i] = Number(token);
  }
  return out;
}

function hexdumpEncode(input: Uint8Array, width: number): Uint8Array {
  const lines: string[] = [];
  for (let offset = 0; offset < input.length; offset += width) {
    const chunk = input.subarray(offset, offset + width);
    const hex: string[] = [];
    for (const byte of chunk) hex.push(byte.toString(16).padStart(2, '0'));
    const hexField = hex.join(' ').padEnd(width * 3 - 1, ' ');
    let ascii = '';
    for (const byte of chunk) ascii += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.';
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hexField}  |${ascii}|`);
  }
  return fromText(lines.join('\n'));
}

export function buildRegExp(pattern: string, flagString: string): RegExp {
  try {
    return new RegExp(pattern, flagString);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const described = message.replace(/^Invalid regular expression: [^:]*: /, '');
    throw new OpError(`Invalid regular expression: ${described}`);
  }
}

function sortLines(input: Uint8Array, args: Args): Uint8Array {
  const order = str(args, 'order');
  const { lines, trailing } = splitLines(asText(input));
  const ignoreCase = order === 'Alphabetical, ignore case';
  const numericOf = (line: string): number | null =>
    /^[+-]?\d+(\.\d+)?$/.test(line) ? Number(line) : null;
  const indexed = lines.map((line, index) => ({ line, index }));
  if (order === 'Numeric') {
    indexed.sort((a, b) => {
      const left = numericOf(a.line);
      const right = numericOf(b.line);
      if (left === null && right === null) return a.index - b.index;
      if (left === null) return 1;
      if (right === null) return -1;
      if (left === right) return a.index - b.index;
      return left - right;
    });
  } else {
    indexed.sort((a, b) => {
      const left = ignoreCase ? a.line.toLowerCase() : a.line;
      const right = ignoreCase ? b.line.toLowerCase() : b.line;
      if (left === right) return a.index - b.index;
      return left < right ? -1 : 1;
    });
  }
  let result = indexed.map((entry) => entry.line);
  if (bool(args, 'unique')) {
    const seen = new Set<string>();
    result = result.filter((line) => {
      const key = ignoreCase ? line.toLowerCase() : line;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (bool(args, 'reverse')) result.reverse();
  return fromText(joinLines(result, trailing));
}

function csvToJson(input: Uint8Array, args: Args): Uint8Array {
  if (input.length === 0) return fromText('[]');
  const delimiter = unescapeTextArg(str(args, 'delimiter'));
  const header = bool(args, 'firstRowIsHeader');
  const records = parseCsv(asText(input), delimiter);
  if (records.length === 0) return fromText('[]');
  const names = records[0]!;
  if (header) {
    const seen = new Set<string>();
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i]!;
      if (seen.has(name)) throw new OpError(`Duplicate header '${name}' at column ${i + 1}`);
      seen.add(name);
    }
  }
  const expected = names.length;
  for (let i = 0; i < records.length; i += 1) {
    const count = records[i]!.length;
    if (count !== expected) {
      throw new OpError(`Row ${i + 1} has ${count} fields; expected ${expected}`);
    }
  }
  if (!header) {
    return fromText(writeJson(records.map((record) => record.slice() as JsonValue[]), '  '));
  }
  if (records.length === 1) return fromText('[]');
  const rows = records.slice(1).map((record) => {
    const map = new Map<string, JsonValue>();
    for (let i = 0; i < names.length; i += 1) map.set(names[i]!, record[i] ?? '');
    return map as JsonValue;
  });
  return fromText(writeJson(rows, '  '));
}

function jsonToCsv(input: Uint8Array): Uint8Array {
  const value = parseJson(asText(input));
  if (!Array.isArray(value) || value.some((item) => !(item instanceof Map))) {
    throw new OpError('JSON to CSV needs an array of objects');
  }
  const rows = value as Map<string, JsonValue>[];
  const first = rows[0];
  if (first === undefined) return new Uint8Array();
  const header = [...first.keys()];
  const lines = [header.map(csvField).join(',')];
  for (const row of rows) {
    lines.push(header.map((key) => csvField(jsonFieldToCsvText(row.get(key) ?? null))).join(','));
  }
  return fromText(lines.join('\n'));
}

function normalizeLineEndings(input: Uint8Array, to: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    const byte = input[i]!;
    if (byte === 0x0d) {
      if (input[i + 1] === 0x0a) i += 1;
      out.push(0x0a);
      continue;
    }
    out.push(byte);
  }
  if (to === 'LF') return new Uint8Array(out);
  const crlf: number[] = [];
  for (const byte of out) {
    if (byte === 0x0a) crlf.push(0x0d);
    crlf.push(byte);
  }
  return new Uint8Array(crlf);
}

function removeWhitespace(input: Uint8Array, args: Args): Uint8Array {
  const spaces = bool(args, 'spaces');
  const tabs = bool(args, 'tabs');
  const breaks = bool(args, 'lineBreaks');
  const out: number[] = [];
  for (const byte of input) {
    if (spaces && byte === 0x20) continue;
    if (tabs && byte === 0x09) continue;
    if (breaks && (byte === 0x0a || byte === 0x0d)) continue;
    out.push(byte);
  }
  return new Uint8Array(out);
}

function joinWithDelimiter(parts: readonly string[], label: string): Uint8Array {
  return fromText(parts.join(DELIMITER_TEXT[label] ?? ' '));
}

export const operations: readonly OpDef[] = [
  {
    name: 'To Base64',
    family: 'Encoding',
    args: [option('Alphabet', 'alphabet', ['Standard', 'URL-safe'])],
    run: (input, args) => fromText(encodeBase64(input, str(args, 'alphabet') === 'URL-safe')),
  },
  {
    name: 'From Base64',
    family: 'Encoding',
    args: [option('Alphabet', 'alphabet', ['Standard', 'URL-safe']), toggle('Strict', 'strict', false)],
    run: (input, args) => base64Decode(input, str(args, 'alphabet') === 'URL-safe', bool(args, 'strict')),
  },
  {
    name: 'To Hex',
    family: 'Encoding',
    args: [option('Delimiter', 'delimiter', ['Space', 'None', 'Comma', 'Colon', 'Line feed'])],
    run: (input, args) => {
      const parts: string[] = [];
      for (const byte of input) parts.push(byte.toString(16).padStart(2, '0'));
      return joinWithDelimiter(parts, str(args, 'delimiter'));
    },
  },
  {
    name: 'From Hex',
    family: 'Encoding',
    args: [option('Delimiter', 'delimiter', ['Auto'])],
    run: (input) => hexDecode(input),
  },
  {
    name: 'To Hexdump',
    family: 'Encoding',
    args: [int('Width', 'width', 1, 64, 16)],
    run: (input, args) => hexdumpEncode(input, num(args, 'width')),
  },
  {
    name: 'From Hexdump',
    family: 'Encoding',
    args: [],
    run: (input) => hexdumpDecode(input),
  },
  {
    name: 'URL Encode',
    family: 'Encoding',
    args: [toggle('Encode all reserved', 'encodeAllReserved', true)],
    run: (input, args) => urlEncode(input, bool(args, 'encodeAllReserved')),
  },
  {
    name: 'URL Decode',
    family: 'Encoding',
    args: [],
    run: (input) => urlDecode(input),
  },
  {
    name: 'To Binary',
    family: 'Encoding',
    args: [option('Delimiter', 'delimiter', ['Space', 'None', 'Comma', 'Line feed'])],
    run: (input, args) => {
      const parts: string[] = [];
      for (const byte of input) parts.push(byte.toString(2).padStart(8, '0'));
      return joinWithDelimiter(parts, str(args, 'delimiter'));
    },
  },
  {
    name: 'From Binary',
    family: 'Encoding',
    args: [option('Delimiter', 'delimiter', ['Auto'])],
    run: (input) => binaryDecode(input),
  },
  {
    name: 'To Decimal',
    family: 'Encoding',
    args: [option('Delimiter', 'delimiter', ['Space', 'Comma', 'Line feed'])],
    run: (input, args) => {
      const parts: string[] = [];
      for (const byte of input) parts.push(String(byte));
      return joinWithDelimiter(parts, str(args, 'delimiter'));
    },
  },
  {
    name: 'From Decimal',
    family: 'Encoding',
    args: [option('Delimiter', 'delimiter', ['Auto'])],
    run: (input) => decimalDecode(input),
  },
  {
    name: 'Encode Text',
    family: 'Text',
    args: [option('Encoding', 'encoding', ['UTF-8', 'UTF-16LE', 'ISO-8859-1'])],
    run: (input, args) => encodeText(asText(input), str(args, 'encoding') as TextEncodingName),
  },
  {
    name: 'Decode Text',
    family: 'Text',
    args: [option('Encoding', 'encoding', ['UTF-8', 'UTF-16LE', 'ISO-8859-1'])],
    run: (input, args) => fromText(decodeText(input, str(args, 'encoding') as TextEncodingName)),
  },
  {
    name: 'Change Case',
    family: 'Text',
    args: [option('Case', 'case', ['Upper', 'Lower'])],
    run: (input, args) => {
      const value = asText(input);
      return fromText(str(args, 'case') === 'Upper' ? value.toUpperCase() : value.toLowerCase());
    },
  },
  {
    name: 'Reverse',
    family: 'Text',
    args: [option('By', 'by', ['Character', 'Line'])],
    run: (input, args) => {
      const value = asText(input);
      if (str(args, 'by') === 'Character') return fromText([...value].reverse().join(''));
      const { lines, trailing } = splitLines(value);
      return fromText(joinLines([...lines].reverse(), trailing));
    },
  },
  {
    name: 'Remove Whitespace',
    family: 'Text',
    args: [
      toggle('Spaces', 'spaces', true),
      toggle('Tabs', 'tabs', true),
      toggle('Line breaks', 'lineBreaks', true),
    ],
    run: (input, args) => removeWhitespace(input, args),
  },
  {
    name: 'Normalize Line Endings',
    family: 'Text',
    args: [option('To', 'to', ['LF', 'CRLF'])],
    run: (input, args) => normalizeLineEndings(input, str(args, 'to')),
  },
  {
    name: 'Find and Replace',
    family: 'Text',
    args: [text('Find', 'find', ''), text('Replace', 'replace', ''), flags('g')],
    regex: true,
    run: (input, args) => {
      const find = str(args, 'find');
      if (find === '') return input;
      const pattern = buildRegExp(find, str(args, 'flags'));
      return fromText(asText(input).replace(pattern, str(args, 'replace')));
    },
  },
  {
    name: 'Extract Matches',
    family: 'Text',
    args: [text('Find', 'find', ''), flags('g')],
    regex: true,
    run: (input, args) => {
      const find = str(args, 'find');
      const flagString = str(args, 'flags');
      const value = asText(input);
      const pattern = buildRegExp(find, flagString);
      const found: string[] = [];
      if (flagString.includes('g')) {
        for (const match of value.matchAll(pattern)) {
          if (match[0].length > 0) found.push(match[0]);
        }
      } else {
        const match = pattern.exec(value);
        if (match !== null && match[0].length > 0) found.push(match[0]);
      }
      return fromText(found.join('\n'));
    },
  },
  {
    name: 'Sort Lines',
    family: 'Text',
    args: [
      option('Order', 'order', ['Alphabetical', 'Alphabetical, ignore case', 'Numeric']),
      toggle('Reverse', 'reverse', false),
      toggle('Unique', 'unique', false),
    ],
    run: (input, args) => sortLines(input, args),
  },
  {
    name: 'Unique Lines',
    family: 'Text',
    args: [],
    run: (input) => {
      const { lines, trailing } = splitLines(asText(input));
      const seen = new Set<string>();
      const kept = lines.filter((line) => {
        if (seen.has(line)) return false;
        seen.add(line);
        return true;
      });
      return fromText(joinLines(kept, trailing));
    },
  },
  {
    name: 'JSON Beautify',
    family: 'Data formats',
    args: [option('Indent', 'indent', ['2', '4', 'Tab'])],
    run: (input, args) => {
      const indent = str(args, 'indent');
      const pad = indent === 'Tab' ? '\t' : ' '.repeat(Number(indent));
      return fromText(writeJson(parseJson(asText(input)), pad));
    },
  },
  {
    name: 'JSON Minify',
    family: 'Data formats',
    args: [],
    run: (input) => fromText(writeJson(parseJson(asText(input)), '')),
  },
  {
    name: 'CSV to JSON',
    family: 'Data formats',
    args: [text('Delimiter', 'delimiter', ','), toggle('First row is header', 'firstRowIsHeader', true)],
    run: (input, args) => csvToJson(input, args),
  },
  {
    name: 'JSON to CSV',
    family: 'Data formats',
    args: [],
    run: (input) => jsonToCsv(input),
  },
  { name: 'MD5', family: 'Checksums', args: [], run: (input) => fromText(md5(input)) },
  { name: 'SHA-1', family: 'Checksums', args: [], run: (input) => fromText(sha1(input)) },
  { name: 'SHA-256', family: 'Checksums', args: [], run: (input) => fromText(sha256(input)) },
  { name: 'CRC32', family: 'Checksums', args: [], run: (input) => fromText(crc32(input)) },
  {
    name: 'Gzip',
    family: 'Compression',
    args: [int('Level', 'level', 1, 9, 6)],
    run: (input, args) => pako.gzip(input, { level: num(args, 'level') as pako.DeflateFunctionOptions['level'] }),
  },
  {
    name: 'Gunzip',
    family: 'Compression',
    args: [],
    run: (input) => {
      if (input.length < 2 || input[0] !== 0x1f || input[1] !== 0x8b) throw new OpError('Not gzip data');
      try {
        return pako.ungzip(input);
      } catch {
        throw new OpError('Gzip data is damaged');
      }
    },
  },
  {
    name: 'Fork',
    family: 'Flow',
    args: [text('Split delimiter', 'splitDelimiter', '\\n')],
    control: 'fork',
  },
  {
    name: 'Merge',
    family: 'Flow',
    args: [text('Joiner', 'joiner', '\\n')],
    control: 'merge',
  },
];

const byName = new Map<string, OpDef>(operations.map((op) => [op.name, op]));

export function findOperation(name: string): OpDef | undefined {
  return byName.get(name);
}

export function operationsOfFamily(family: OpFamily): OpDef[] {
  return operations.filter((op) => op.family === family);
}

export function defaultArgs(op: OpDef): Args {
  const args: Args = {};
  for (const spec of op.args) args[spec.key] = spec.value;
  return args;
}

/** Fills in missing arguments with their defaults, keeping catalogue order. */
export function normalizeArgs(op: OpDef, given: Args | undefined): Args {
  const args: Args = {};
  for (const spec of op.args) {
    const value = given?.[spec.key];
    args[spec.key] = value === undefined ? spec.value : value;
  }
  return args;
}

/** Validates one argument value against its specification, returning a message when invalid. */
export function validateArg(spec: ArgSpec, value: ArgValue): string | null {
  switch (spec.kind) {
    case 'option':
      if (typeof value !== 'string' || !spec.options.includes(value)) {
        return `${spec.label} must be one of ${spec.options.join(', ')}.`;
      }
      return null;
    case 'toggle':
      return typeof value === 'boolean' ? null : `${spec.label} must be true or false.`;
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value) || value < spec.min || value > spec.max) {
        return `${spec.label} must be a whole number from ${spec.min} to ${spec.max}.`;
      }
      return null;
    case 'text':
      return typeof value === 'string' ? null : `${spec.label} must be text.`;
    case 'flags':
      if (typeof value !== 'string' || !/^g?i?m?s?$/.test(value)) {
        return `${spec.label} may only hold g, i, m and s, in that order.`;
      }
      return null;
  }
}

export function argLabel(op: OpDef, key: string): string {
  return op.args.find((spec) => spec.key === key)?.label ?? key;
}

/** Writes an argument value the way the compare lines show it. */
export function argValueText(value: ArgValue): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return String(value);
}
