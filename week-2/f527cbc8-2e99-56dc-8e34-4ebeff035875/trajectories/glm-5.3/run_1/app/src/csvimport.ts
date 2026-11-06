import { ValidationError, ImportInvalidError } from './errors.js';

/** Standard CSV client import parser and validator (DP-56, DP-57). */
const HEADER = ['owner_name', 'owner_email', 'owner_phone', 'horse_name', 'barn_name', 'stall', 'cycle_weeks'];

export interface ImportRow {
  line: number;
  owner_name: string;
  owner_email: string;
  owner_phone: string;
  horse_name: string;
  barn_name: string;
  stall: string;
  cycle_weeks: string;
}

export interface ImportParse {
  rows: ImportRow[];
  errors: Array<{ line: number; column: string; code: string }>;
}

/** RFC4180-style CSV parse counting physical lines (Client import). */
export function parseCsv(raw: Buffer): ImportParse {
  const errors: Array<{ line: number; column: string; code: string }> = [];
  let text = raw.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const records: Array<{ rec: string[]; line: number }> = [];
  let field = '';
  let record: string[] = [];
  let line = 1;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i++;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          i++;
          break;
        }
        if (text[i] === '\n') line++;
        field += text[i];
        i++;
      }
      continue;
    }
    if (ch === ',') { record.push(field); field = ''; i++; continue; }
    if (ch === '\r' && text[i + 1] === '\n') { record.push(field); records.push({ rec: record, line }); record = []; field = ''; line++; i += 2; continue; }
    if (ch === '\n') { record.push(field); records.push({ rec: record, line }); record = []; field = ''; line++; i++; continue; }
    if (ch === '\r') { record.push(field); records.push({ rec: record, line }); record = []; field = ''; line++; i++; continue; }
    field += ch;
    i++;
  }
  if (field.length > 0 || record.length > 0) { record.push(field); records.push({ rec: record, line }); }

  if (records.length === 0) {
    errors.push({ line: 1, column: 'header', code: 'bad_header' });
    return { rows: [], errors };
  }
  const header = records[0].rec;
  if (header.join(',') !== HEADER.join(',')) {
    errors.push({ line: 1, column: 'header', code: 'bad_header' });
    return { rows: [], errors };
  }
  const dataRecords = records.slice(1);
  if (dataRecords.length > 5000) {
    errors.push({ line: 1, column: 'header', code: 'too_many_rows' });
    return { rows: [], errors };
  }
  const rows: ImportRow[] = [];
  for (const { rec, line: lineNo } of dataRecords) {
    const values = HEADER.map((_, idx) => rec[idx] ?? '');
    rows.push({
      line: lineNo,
      owner_name: values[0],
      owner_email: values[1],
      owner_phone: values[2],
      horse_name: values[3],
      barn_name: values[4],
      stall: values[5],
      cycle_weeks: values[6]
    });
  }
  return { rows, errors };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Per-row validation against the database, under import serialisation. */
export async function validateImport(
  q: (sql: string, p?: unknown[]) => Promise<import('./db.js').Row[]>,
  rows: ImportRow[]
): Promise<Array<{ line: number; column: string; code: string }>> {
  const errors: Array<{ line: number; column: string; code: string }> = [];
  const seenEmail = new Map<string, string>();
  const seenOwnerHorse = new Set<string>();
  const seenStalls = new Set<string>();
  const barns = await q(`select id, lower(name) as lname from barns`);
  const barnByName = new Map<string, string>();
  for (const b of barns) barnByName.set(b.lname, b.id);
  const dbOwners = await q(`select lower(email) as lemail, name from users where role='owner'`);
  const dbOwnerByName = new Map<string, string>();
  for (const o of dbOwners) dbOwnerByName.set(o.lemail, o.name);
  const dbHorses = await q(`select lower(h.name) as lhname, lower(u.email) as lemail from horses h join users u on u.id = h.owner_id`);
  for (const h of dbHorses) seenOwnerHorse.add(`${h.lemail}|${h.lhname}`);
  const dbStalls = await q(`select barn_id, stall from horses`);
  for (const s of dbStalls) seenStalls.add(`${s.barn_id}|${String(s.stall).toLowerCase()}`);

  for (const r of rows) {
    const cols: Array<[string, string]> = [
      ['owner_name', r.owner_name], ['owner_email', r.owner_email], ['owner_phone', r.owner_phone],
      ['horse_name', r.horse_name], ['barn_name', r.barn_name], ['stall', r.stall], ['cycle_weeks', r.cycle_weeks]
    ];
    for (const [col, v] of cols) {
      if (v.trim() === '') errors.push({ line: r.line, column: col, code: 'missing_value' });
    }
    const barnId = barnByName.get(r.barn_name.toLowerCase());
    if (r.barn_name.trim() !== '' && !barnId) errors.push({ line: r.line, column: 'barn_name', code: 'unknown_barn' });
    const cycle = Number(r.cycle_weeks);
    if (r.cycle_weeks.trim() !== '' && (!Number.isInteger(cycle) || cycle < 5 || cycle > 8)) {
      errors.push({ line: r.line, column: 'cycle_weeks', code: 'cycle_out_of_range' });
    }
    const email = r.owner_email.toLowerCase();
    if (r.owner_email.trim() !== '' && !EMAIL_RE.test(r.owner_email)) {
      errors.push({ line: r.line, column: 'owner_email', code: 'invalid_email' });
    }
    if (r.owner_email.trim() !== '') {
      const knownName = seenEmail.get(email) ?? dbOwnerByName.get(email);
      if (knownName && knownName !== r.owner_name) {
        errors.push({ line: r.line, column: 'owner_name', code: 'owner_name_mismatch' });
      }
      seenEmail.set(email, r.owner_name);
    }
    if (r.horse_name.trim() !== '' && r.owner_email.trim() !== '') {
      const key = `${email}|${r.horse_name.toLowerCase()}`;
      if (seenOwnerHorse.has(key)) {
        errors.push({ line: r.line, column: 'horse_name', code: 'duplicate_row' });
      }
      seenOwnerHorse.add(key);
    }
    if (r.stall.trim() !== '' && barnId) {
      const skey = `${barnId}|${r.stall.toLowerCase()}`;
      if (seenStalls.has(skey)) {
        errors.push({ line: r.line, column: 'stall', code: 'stall_taken' });
      }
      seenStalls.add(skey);
    }
  }
  const order = HEADER;
  errors.sort((a, b) => a.line - b.line || order.indexOf(a.column) - order.indexOf(b.column));
  return errors;
}
