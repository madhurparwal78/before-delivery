/**
 * Sheet import: UTF-8 CSV with optional BOM, LF or CRLF, standard double-quote
 * quoting. The stored bytes are the evidence; parsing applies to working rows only.
 */

export interface ParsedSheet {
  header: Map<string, number>;
  rows: Array<{ code: string; description: string; newMrp: string; oldGst: string; newGst: string }>;
  error: { code: string; message: string } | null;
}

export type SheetRefusalCode =
  | 'sheet_too_large'
  | 'sheet_is_archive'
  | 'sheet_has_nul'
  | 'sheet_not_utf8'
  | 'sheet_bad_quoting'
  | 'sheet_too_many_rows'
  | 'sheet_bad_header'
  | 'sheet_empty';

export interface SheetRefusal {
  code: SheetRefusalCode;
  status: number;
}

export const REFUSAL_MESSAGES: Record<SheetRefusal['code'], string> = {
  sheet_too_large: 'This sheet is over the 2,000,000 byte limit.',
  sheet_is_archive: "This is a workbook or archive, not a text price sheet. Save it as CSV first.",
  sheet_has_nul: "This sheet contains NUL bytes and can't be read as text.",
  sheet_not_utf8: "This sheet isn't UTF-8 text.",
  sheet_bad_quoting: 'This sheet has a broken quoted field.',
  sheet_too_many_rows: 'This sheet has more than 5,000 rows.',
  sheet_bad_header: 'This sheet needs description and new_mrp columns.',
  sheet_empty: 'This sheet has no rows.',
};

export const MAX_SHEET_BYTES = 2000000;
export const MAX_SHEET_ROWS = 5000;

/** Checks judged by content, in the published order. */
export function refuseSheet(bytes: Buffer): SheetRefusal | null {
  if (bytes.length > MAX_SHEET_BYTES) return { code: 'sheet_too_large', status: 413 };
  const zipSignatures = [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.from([0x50, 0x4b, 0x07, 0x08]),
  ];
  for (const sig of zipSignatures) {
    if (bytes.length >= sig.length && bytes.subarray(0, sig.length).equals(sig)) return { code: 'sheet_is_archive', status: 415 };
  }
  if (bytes.includes(0)) return { code: 'sheet_has_nul', status: 422 };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { code: 'sheet_not_utf8', status: 422 };
  }
  const parsed = parseCsv(text);
  if (parsed.error) return { code: parsed.error.code, status: 422 };
  if (parsed.rows.length > MAX_SHEET_ROWS) return { code: 'sheet_too_many_rows', status: 422 };
  if (!parsed.header.has('description') || !parsed.header.has('new_mrp')) return { code: 'sheet_bad_header', status: 422 };
  if (parsed.rows.length === 0) return { code: 'sheet_empty', status: 422 };
  return null;
}

/** Parse with strict quoting rules: a quoted multi-line cell counts as one row. */
export function parseCsv(text: string): { header: Map<string, number>; rows: ParsedSheet['rows']; error: SheetRefusal | null } {
  const rows: string[][] = [];
  let i = 0;
  const n = text.length;
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let started = false;

  const pushField = (): void => {
    record.push(field);
    field = '';
  };
  const pushRecord = (): void => {
    rows.push(record);
    record = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (i + 1 < n && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '' && !started) {
      inQuotes = true;
      started = true;
      i++;
      continue;
    }
    if (c === '"' && field === '' && started) {
      // a second opening quote right after a closing one
      return { header: new Map(), rows: [], error: { code: 'sheet_bad_quoting', status: 422 } };
    }
    if (c === '"') {
      // a double quote inside an unquoted field
      return { header: new Map(), rows: [], error: { code: 'sheet_bad_quoting', status: 422 } };
    }
    if (c === ',') {
      pushField();
      started = false;
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && i + 1 < n && text[i + 1] === '\n') i++;
      if (field !== '' || record.length > 0 || started) {
        pushField();
        pushRecord();
      }
      started = false;
      i++;
      continue;
    }
    field += c;
    started = true;
    i++;
  }
  if (inQuotes) return { header: new Map(), rows: [], error: { code: 'sheet_bad_quoting', status: 422 } };
  if (field !== '' || record.length > 0) {
    pushField();
    pushRecord();
  }

  // BOM on the first header cell
  if (rows.length > 0 && rows[0].length > 0 && rows[0][0].startsWith('﻿')) {
    rows[0][0] = rows[0][0].slice(1);
  }

  const header = new Map<string, number>();
  if (rows.length === 0) return { header, rows: [], error: null };
  rows[0].forEach((h, idx) => {
    const name = h.trim().toLowerCase();
    if (name && !header.has(name)) header.set(name, idx);
  });

  const dataRows: ParsedSheet['rows'] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => c.trim() === '')) continue; // blank lines ignored
    const get = (name: string): string => {
      const idx = header.get(name);
      return idx === undefined ? '' : (cells[idx] ?? '');
    };
    dataRows.push({
      code: get('code').trim(),
      description: get('description'),
      newMrp: get('new_mrp').trim(),
      oldGst: get('old_gst').trim(),
      newGst: get('new_gst').trim(),
    });
  }
  return { header, rows: dataRows, error: null };
}

/** `Rs`, `Rs.`, rupee sign, comma grouping, two decimals, `/-` ending. */
export function parseMrp(s: string): number | null {
  let t = s.trim().replace(/\u00a0/g, ' ');
  if (!t) return null;
  t = t.replace(/^rs\.?\s*/i, '').replace(/^₹\s*/, '').replace(/\/-$/, '').trim();
  if (!/^\d{1,3}(,\d{2,3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(t)) return null;
  const noCommas = t.replace(/,/g, '');
  const dot = noCommas.indexOf('.');
  if (dot === -1) return Number(noCommas) * 100;
  const whole = noCommas.slice(0, dot);
  const frac = noCommas.slice(dot + 1);
  if (frac.length === 1) return Number(whole) * 100 + Number(frac) * 10;
  if (frac.length === 2) return Number(whole) * 100 + Number(frac);
  return null;
}

export function parseRate(s: string): number | null {
  let t = s.trim().replace(/\u00a0/g, ' ');
  if (!t) return null;
  if (t.endsWith('%')) t = t.slice(0, -1).trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const v = Number(t);
  if (v < 0 || v > 100) return null;
  return v;
}
