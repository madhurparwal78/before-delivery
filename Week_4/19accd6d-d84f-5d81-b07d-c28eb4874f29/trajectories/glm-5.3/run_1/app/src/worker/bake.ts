import type { Step } from '../../shared/catalogue.js';
import { operation } from '../../shared/catalogue.js';
import { unescapeArg } from '../../shared/text.js';

export type StepOutcome =
  | { ok: true; output: Uint8Array }
  | { ok: false; message: string };

const enc = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8');
const latin1Decoder = new TextDecoder('iso-8859-1');

function fromText(text: string): Uint8Array {
  return enc.encode(text);
}

export async function runStep(step: Step, input: Uint8Array): Promise<StepOutcome> {
  const spec = operation(step.op);
  if (!spec) return { ok: false, message: `Unknown operation '${step.op}'` };
  const args = step.args;
  switch (step.op) {
    case 'To Base64': return { ok: true, output: fromText(toBase64(input, args.alphabet === 'URL-safe')) };
    case 'From Base64': return fromBase64(input, args.alphabet === 'URL-safe', args.strict === true);
    case 'To Hex': return { ok: true, output: fromText(hexEncode(input, delimString(delimCode(String(args.delimiter)))) ) };
    case 'From Hex': return fromHex(input);
    case 'To Hexdump': return { ok: true, output: fromText(hexdump(input, Number(args.width))) };
    case 'From Hexdump': return fromHexdump(input);
    case 'URL Encode': return { ok: true, output: urlEncode(input, args.encodeAllReserved !== false) };
    case 'URL Decode': return urlDecode(input);
    case 'To Binary': return { ok: true, output: fromText(binaryEncode(input, delimString(delimCode(String(args.delimiter))))) };
    case 'From Binary': return fromBinary(input);
    case 'To Decimal': return { ok: true, output: fromText(decimalEncode(input, delimString(delimCode(String(args.delimiter))))) };
    case 'From Decimal': return fromDecimal(input);
    case 'Encode Text': return encodeTextOp(input, String(args.encoding));
    case 'Decode Text': return decodeTextOp(input, String(args.encoding));
    case 'Change Case': return { ok: true, output: fromText(args.case === 'Lower' ? utf8Decoder.decode(input).toLowerCase() : utf8Decoder.decode(input).toUpperCase()) };
    case 'Reverse': return reverseOp(input, String(args.by));
    case 'Remove Whitespace': return removeWhitespace(input, args.spaces !== false, args.tabs !== false, args.lineBreaks !== false);
    case 'Normalize Line Endings': return { ok: true, output: fromText(normalise(utf8Decoder.decode(input), String(args.to))) };
    case 'Find and Replace': return findReplace(input, String(args.find), String(args.replace), String(args.flags));
    case 'Extract Matches': return extractMatches(input, String(args.find), String(args.flags));
    case 'Sort Lines': return sortLines(input, String(args.order), args.reverse === true, args.unique === true);
    case 'Unique Lines': return uniqueLines(input);
    case 'JSON Beautify': return jsonBeautify(input, String(args.indent));
    case 'JSON Minify': return jsonMinify(input);
    case 'CSV to JSON': return csvToJson(input, unescapeArg(String(args.delimiter)), args.firstRowIsHeader !== false);
    case 'JSON to CSV': return jsonToCsv(input);
    case 'MD5': return { ok: true, output: fromText(md5(input)) };
    case 'SHA-1': return digestHex(input, 'SHA-1');
    case 'SHA-256': return digestHex(input, 'SHA-256');
    case 'CRC32': return { ok: true, output: fromText(crc32Hex(input)) };
    case 'Gzip': return gzipOp(input, Number(args.level));
    case 'Gunzip': return gunzipOp(input);
    case 'Fork':
    case 'Merge':
      return { ok: false, message: 'Flow operations are handled by the bake runner' };
    default: return { ok: false, message: `Unknown operation '${step.op}'` };
  }
}

function delimCode(label: string): number {
  if (label === 'None') return 0;
  if (label === 'Space') return 1;
  if (label === 'Comma') return 2;
  if (label === 'Colon') return 3;
  if (label === 'Line feed') return 4;
  return 1;
}

function delimString(code: number): string {
  return ['', ' ', ',', ':', '\n'][code] ?? ' ';
}

function toBase64(bytes: Uint8Array, urlSafe: boolean): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  const b64 = btoa(out);
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
}

const STD_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function fromBase64(bytes: Uint8Array, urlSafe: boolean, strict: boolean): StepOutcome {
  const alphabet = urlSafe ? URL_B64 : STD_B64;
  const values: number[] = [];
  let padding = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    const c = String.fromCharCode(b);
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) {
      if (strict) return { ok: false, message: `Invalid Base64 character '${wsChar(b)}' at position ${i}` };
      continue;
    }
    if (c === '=') {
      // A '=' is valid only as the last one or two characters.
      if (padding >= 2 || bytes.length - i > 2) return { ok: false, message: `Invalid Base64 character '=' at position ${i}` };
      if (strict) return { ok: false, message: `Invalid Base64 character '=' at position ${i}` };
      padding++;
      continue;
    }
    if (padding > 0) return { ok: false, message: `Invalid Base64 character '=' at position ${i - 1}` };
    const v = alphabet.indexOf(c);
    if (v === -1) return { ok: false, message: `Invalid Base64 character '${showByte(b)}' at position ${i}` };
    values.push(v);
  }
  if (padding === 3) {
    // The third '=' in a run is the one reported.
    const idx = bytes.length - 1;
    return { ok: false, message: `Invalid Base64 character '=' at position ${idx}` };
  }
  if (strict && padding === 0 && values.length % 4 !== 0) return { ok: false, message: 'Base64 padding is missing' };
  if (values.length % 4 === 1) return { ok: false, message: 'Base64 length is invalid' };
  const out: number[] = [];
  for (let i = 0; i + 1 < values.length; i += 4) {
    const a = values[i];
    const b = values[i + 1];
    const c = i + 2 < values.length ? values[i + 2] : 0;
    const d = i + 3 < values.length ? values[i + 3] : 0;
    out.push((a << 2) | (b >> 4));
    if (i + 2 < values.length) out.push(((b & 0xf) << 4) | (c >> 2));
    if (i + 3 < values.length) out.push(((c & 0x3) << 6) | d);
  }
  return { ok: true, output: new Uint8Array(out) };
}

function wsChar(b: number): string {
  if (b === 0x0a) return '\\n';
  if (b === 0x0d) return '\\r';
  if (b === 0x09) return '\\t';
  return ' ';
}

function showByte(b: number): string {
  if (b >= 0x20 && b <= 0x7e) {
    const c = String.fromCharCode(b);
    return c === "'" || c === '\\' ? c : c;
  }
  return `\\x${b.toString(16).padStart(2, '0')}`;
}

function hexEncode(bytes: Uint8Array, sep: string): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(sep);
}

function fromHex(bytes: Uint8Array): StepOutcome {
  const nibbles: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x20 || b === 0x2c || b === 0x3a || b === 0x09 || b === 0x0a || b === 0x0d) continue;
    const v = hexVal(b);
    if (v === -1) return { ok: false, message: `Invalid hex digit '${showByte(b)}' at position ${i}` };
    nibbles.push(v);
  }
  if (nibbles.length % 2 !== 0) return { ok: false, message: 'Odd number of hex digits' };
  const out: number[] = [];
  for (let i = 0; i < nibbles.length; i += 2) out.push((nibbles[i] << 4) | nibbles[i + 1]);
  return { ok: true, output: new Uint8Array(out) };
}

function hexVal(b: number): number {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  if (b >= 0x41 && b <= 0x46) return b - 0x37;
  if (b >= 0x61 && b <= 0x66) return b - 0x57;
  return -1;
}

function hexdump(bytes: Uint8Array, width: number): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += width) {
    const slice = bytes.subarray(offset, Math.min(offset + width, bytes.length));
    const hexParts: string[] = [];
    for (const b of slice) hexParts.push(b.toString(16).padStart(2, '0'));
    let hexCol = hexParts.join(' ');
    const padCount = width - slice.length;
    if (padCount > 0) hexCol += ' '.repeat(padCount * 3);
    let ascii = '';
    for (const b of slice) ascii += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hexCol}  |${ascii}|`);
  }
  return lines.join('\n');
}

function fromHexdump(bytes: Uint8Array): StepOutcome {
  const text = utf8Decoder.decode(bytes);
  const physicalLines = text.split('\n');
  const out: number[] = [];
  for (let i = 0; i < physicalLines.length; i++) {
    let line = physicalLines[i];
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line === '') continue;
    const m = /^([0-9a-fA-F]{8})  ((?:[0-9a-fA-F]{2} ?)*) *\|.*\|$/.exec(line);
    if (!m) return { ok: false, message: `Invalid hexdump line ${i + 1}` };
    const hexPart = m[2].trim();
    if (hexPart !== '') {
      for (const pair of hexPart.split(' ')) {
        const v = parseInt(pair, 16);
        if (Number.isNaN(v)) return { ok: false, message: `Invalid hexdump line ${i + 1}` };
        out.push(v);
      }
    }
  }
  return { ok: true, output: new Uint8Array(out) };
}

function urlEncode(bytes: Uint8Array, allReserved: boolean): Uint8Array {
  const unreserved = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~'.split('').map((c) => c.charCodeAt(0)));
  const extra = new Set("!*'();:@&=+$,/?#[]".split('').map((c) => c.charCodeAt(0)));
  let out = '';
  for (const b of bytes) {
    if (unreserved.has(b) || (!allReserved && extra.has(b))) out += String.fromCharCode(b);
    else out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return fromText(out);
}

function urlDecode(bytes: Uint8Array): StepOutcome {
  const text = utf8Decoder.decode(bytes);
  const byteOut: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '%') {
      if (i + 2 >= text.length) return { ok: false, message: `Invalid percent sequence at position ${i}` };
      const h1 = hexVal(text.charCodeAt(i + 1));
      const h2 = hexVal(text.charCodeAt(i + 2));
      if (h1 === -1 || h2 === -1) return { ok: false, message: `Invalid percent sequence at position ${i}` };
      byteOut.push((h1 << 4) | h2);
      i += 2;
      continue;
    }
    byteOut.push(text.charCodeAt(i) & 0xff);
  }
  return { ok: true, output: new Uint8Array(byteOut) };
}

function binaryEncode(bytes: Uint8Array, sep: string): string {
  return [...bytes].map((b) => b.toString(2).padStart(8, '0')).join(sep);
}

function fromBinary(bytes: Uint8Array): StepOutcome {
  const text = utf8Decoder.decode(bytes);
  let bits = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === ' ' || c === ',' || c === '\t' || c === '\n' || c === '\r') continue;
    if (c !== '0' && c !== '1') return { ok: false, message: `Invalid binary digit '${c}' at position ${i}` };
    bits++;
  }
  if (bits % 8 !== 0) return { ok: false, message: 'Bit count is not a multiple of 8' };
  const out: number[] = [];
  let acc = 0;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== '0' && c !== '1') continue;
    acc = (acc << 1) | Number(c);
    count++;
    if (count === 8) {
      out.push(acc);
      acc = 0;
      count = 0;
    }
  }
  return { ok: true, output: new Uint8Array(out) };
}

function decimalEncode(bytes: Uint8Array, sep: string): string {
  return [...bytes].map(String).join(sep);
}

function fromDecimal(bytes: Uint8Array): StepOutcome {
  const text = utf8Decoder.decode(bytes);
  const tokens = text.split(/[ ,\t\n\r]+/).filter((t) => t !== '');
  const out: number[] = [];
  for (const t of tokens) {
    if (!/^[0-9]+$/.test(t)) return { ok: false, message: `Value ${t} is not a byte` };
    const n = Number(t);
    if (n > 255) return { ok: false, message: `Value ${n} is not a byte` };
    out.push(n);
  }
  return { ok: true, output: new Uint8Array(out) };
}

function encodeTextOp(input: Uint8Array, encoding: string): StepOutcome {
  const text = utf8Decoder.decode(input);
  if (encoding === 'UTF-8') return { ok: true, output: fromText(text) };
  if (encoding === 'UTF-16LE') {
    const out = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      const cp = text.charCodeAt(i);
      out[i * 2] = cp & 0xff;
      out[i * 2 + 1] = cp >> 8;
    }
    return { ok: true, output: out };
  }
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xff) return { ok: false, message: `Character U+${cp.toString(16).toUpperCase().padStart(4, '0')} cannot be encoded in ISO-8859-1` };
    out.push(cp);
  }
  return { ok: true, output: new Uint8Array(out) };
}

function decodeTextOp(input: Uint8Array, encoding: string): StepOutcome {
  if (encoding === 'ISO-8859-1') return { ok: true, output: fromText(latin1Decoder.decode(input)) };
  if (encoding === 'UTF-16LE') {
    if (input.length % 2 !== 0) return { ok: false, message: 'UTF-16LE input has an odd number of bytes' };
    let text = '';
    for (let i = 0; i < input.length; i += 2) text += String.fromCharCode(input[i] | (input[i + 1] << 8));
    return { ok: true, output: fromText(text) };
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(input);
    return { ok: true, output: fromText(text) };
  } catch {
    return { ok: false, message: 'Input is not valid UTF-8 text' };
  }
}

function reverseOp(input: Uint8Array, by: string): StepOutcome {
  const text = utf8Decoder.decode(input);
  if (by === 'Line') {
    const trailing = text.endsWith('\n');
    const lines = text.split('\n');
    const body = trailing ? lines.slice(0, -1) : lines;
    body.reverse();
    return { ok: true, output: fromText(body.join('\n') + (trailing ? '\n' : '')) };
  }
  return { ok: true, output: fromText([...text].reverse().join('')) };
}

function removeWhitespace(input: Uint8Array, spaces: boolean, tabs: boolean, breaks: boolean): StepOutcome {
  const keep: number[] = [];
  for (const b of input) {
    if (spaces && b === 0x20) continue;
    if (tabs && b === 0x09) continue;
    if (breaks && (b === 0x0a || b === 0x0d)) continue;
    keep.push(b);
  }
  return { ok: true, output: new Uint8Array(keep) };
}

function normalise(text: string, to: string): string {
  const lf = text.replace(/\r\n?/g, '\n');
  return to === 'CRLF' ? lf.replace(/\n/g, '\r\n') : lf;
}

function regexMessage(message: string): string {
  return message.replace(/^Invalid regular expression: /, '');
}

function findReplace(input: Uint8Array, find: string, replace: string, flags: string): StepOutcome {
  const text = utf8Decoder.decode(input);
  if (find === '') return { ok: true, output: input };
  let re: RegExp;
  try {
    re = new RegExp(find, flags);
  } catch (e) {
    return { ok: false, message: `Invalid regular expression: ${regexMessage((e as Error).message)}` };
  }
  try {
    return { ok: true, output: fromText(text.replace(re, replace)) };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

function extractMatches(input: Uint8Array, find: string, flags: string): StepOutcome {
  const text = utf8Decoder.decode(input);
  if (find === '') return { ok: true, output: new Uint8Array(0) };
  let re: RegExp;
  try {
    re = new RegExp(find, flags);
  } catch (e) {
    return { ok: false, message: `Invalid regular expression: ${regexMessage((e as Error).message)}` };
  }
  const matches: string[] = [];
  if (re.global) {
    for (const m of text.matchAll(re)) if (m[0] !== '') matches.push(m[0]);
  } else {
    const m = re.exec(text);
    if (m && m[0] !== '') matches.push(m[0]);
  }
  return { ok: true, output: fromText(matches.join('\n')) };
}

function sortLines(input: Uint8Array, order: string, reverse: boolean, unique: boolean): StepOutcome {
  const text = utf8Decoder.decode(input);
  const trailing = text.endsWith('\n');
  const lines = text.split('\n');
  const body = trailing ? lines.slice(0, -1) : lines;
  let sorted: string[];
  if (order === 'Numeric') {
    const numberRe = /^[+-]?[0-9]+(\.[0-9]+)?$/;
    const nums = body.filter((l) => numberRe.test(l));
    const rest = body.filter((l) => !numberRe.test(l));
    nums.sort((a, b) => Number(a) - Number(b));
    sorted = [...nums, ...rest];
  } else if (order === 'Alphabetical, ignore case') {
    const keyed = body.map((l, i) => ({ l, i, k: l.toLowerCase() }));
    keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i));
    sorted = keyed.map((x) => x.l);
  } else {
    const keyed = body.map((l, i) => ({ l, i }));
    keyed.sort((a, b) => (a.l < b.l ? -1 : a.l > b.l ? 1 : a.i - b.i));
    sorted = keyed.map((x) => x.l);
  }
  if (unique) {
    const ignoreCase = order === 'Alphabetical, ignore case';
    const seen = new Set<string>();
    sorted = sorted.filter((l) => {
      const k = ignoreCase ? l.toLowerCase() : l;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  if (reverse) sorted.reverse();
  return { ok: true, output: fromText(sorted.join('\n') + (trailing ? '\n' : '')) };
}

function uniqueLines(input: Uint8Array): StepOutcome {
  const text = utf8Decoder.decode(input);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (!seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return { ok: true, output: fromText(out.join('\n')) };
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

function jsonParse(text: string, bytes: Uint8Array): { ok: true; value: Json } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(text) as Json };
  } catch (e) {
    const msg = (e as Error).message;
    const m = /position ([0-9]+)/.exec(msg);
    const lineCol = m ? offsetToLineCol(bytes, Number(m[1])) : offsetToLineCol(bytes, text.length);
    return { ok: false, message: `Invalid JSON at line ${lineCol.line} column ${lineCol.col}` };
  }
}

function offsetToLineCol(bytes: Uint8Array, offset: number): { line: number; col: number } {
  const text = utf8Decoder.decode(bytes.subarray(0, Math.min(offset, bytes.length)));
  const lines = text.split('\n');
  return { line: lines.length, col: (lines[lines.length - 1] ?? '').length + 1 };
}

function jsonBeautify(input: Uint8Array, indent: string): StepOutcome {
  const text = utf8Decoder.decode(input);
  const parsed = jsonParse(text, input);
  if (!parsed.ok) return parsed;
  const pad = indent === 'Tab' ? '\t' : ' '.repeat(Number(indent) || 2);
  return { ok: true, output: fromText(JSON.stringify(parsed.value, null, pad)) };
}

function jsonMinify(input: Uint8Array): StepOutcome {
  const text = utf8Decoder.decode(input);
  const parsed = jsonParse(text, input);
  if (!parsed.ok) return parsed;
  return { ok: true, output: fromText(JSON.stringify(parsed.value)) };
}

function csvToJson(input: Uint8Array, delimiter: string, firstRowIsHeader: boolean): StepOutcome {
  if (input.length === 0) return { ok: true, output: fromText('[]') };
  const text = utf8Decoder.decode(input);
  const parsed = parseCsv(text, delimiter === '' ? ',' : delimiter[0]);
  if ('error' in parsed) return { ok: false, message: parsed.error };
  const rows = parsed.rows;
  if (rows.length === 0) return { ok: true, output: fromText('[]') };
  if (firstRowIsHeader) {
    const header = rows[0];
    const seen = new Map<string, number>();
    for (let i = 0; i < header.length; i++) {
      if (seen.has(header[i])) {
        return { ok: false, message: `Duplicate header '${header[i]}' at column ${seen.get(header[i])! + 1}` };
      }
      seen.set(header[i], i);
    }
    if (rows.length === 1) return { ok: true, output: fromText('[]') };
    for (let r = 1; r < rows.length; r++) {
      if (rows[r].length !== header.length) {
        return { ok: false, message: `Row ${r + 1} has ${rows[r].length} fields; expected ${header.length}` };
      }
    }
    const objects = rows.slice(1).map((row) => {
      const obj: Record<string, Json> = {};
      header.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
    return { ok: true, output: fromText(JSON.stringify(objects, null, '  ')) };
  }
  const expected = rows[0].length;
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length !== expected) {
      return { ok: false, message: `Row ${r + 1} has ${rows[r].length} fields; expected ${expected}` };
    }
  }
  return { ok: true, output: fromText(JSON.stringify(rows, null, '  ')) };
}

function parseCsv(text: string, delimiter: string): { rows: string[][] } | { error: string } {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let quoteLine = 1;
  let physicalLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        if (c === '\n') physicalLine++;
        field += c;
      }
      continue;
    }
    if (c === '"' && field === '') {
      inQuotes = true;
      quoteLine = physicalLine;
      continue;
    }
    if (c === delimiter) {
      row.push(field);
      field = '';
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      physicalLine++;
      if (field === '' && row.length === 0 && i === text.length - 1) break;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += c;
  }
  if (inQuotes) return { error: `Unclosed quote at line ${quoteLine}` };
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows };
}

function jsonToCsv(input: Uint8Array): StepOutcome {
  const text = utf8Decoder.decode(input);
  const parsed = jsonParse(text, input);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (!Array.isArray(value) || value.length === 0 || typeof value[0] !== 'object' || value[0] === null || Array.isArray(value[0])) {
    return { ok: false, message: 'JSON to CSV needs an array of objects' };
  }
  const objects = value as Record<string, Json>[];
  const header: string[] = [];
  for (const key of Object.keys(objects[0])) if (!header.includes(key)) header.push(key);
  const escape = (v: Json | undefined): string => {
    let s: string;
    if (v === null || v === undefined) s = '';
    else if (typeof v === 'object') s = JSON.stringify(v);
    else s = String(v);
    if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(',')];
  for (const obj of objects) lines.push(header.map((h) => escape(obj[h])).join(','));
  return { ok: true, output: fromText(lines.join('\n')) };
}

async function digestHex(input: Uint8Array, algo: 'SHA-1' | 'SHA-256'): Promise<StepOutcome> {
  const hash = await crypto.subtle.digest(algo, input.slice().buffer as ArrayBuffer);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { ok: true, output: fromText(hex) };
}

function md5(msg: Uint8Array): string {
  const s = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const ml = msg.length * 8;
  const padded = new Uint8Array(Math.ceil((msg.length + 9) / 64) * 64);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, ml >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(ml / 2 ** 32), true);
  for (let off = 0; off < padded.length; off += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  out.setUint32(0, a0 >>> 0, true);
  out.setUint32(4, b0 >>> 0, true);
  out.setUint32(8, c0 >>> 0, true);
  out.setUint32(12, d0 >>> 0, true);
  return [...new Uint8Array(out.buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function crc32Hex(input: Uint8Array): string {
  let crc = 0xffffffff;
  for (const b of input) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b) & 0xff];
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

async function gzipOp(input: Uint8Array, level: number): Promise<StepOutcome> {
  const { gzipSync } = await import('fflate');
  const lvl = Math.min(9, Math.max(1, level)) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  return { ok: true, output: gzipSync(input, { level: lvl }) };
}

async function gunzipOp(input: Uint8Array): Promise<StepOutcome> {
  if (input.length < 2 || input[0] !== 0x1f || input[1] !== 0x8b) return { ok: false, message: 'Not gzip data' };
  const { gunzipSync } = await import('fflate');
  try {
    return { ok: true, output: gunzipSync(input) };
  } catch {
    return { ok: false, message: 'Gzip data is damaged' };
  }
}
