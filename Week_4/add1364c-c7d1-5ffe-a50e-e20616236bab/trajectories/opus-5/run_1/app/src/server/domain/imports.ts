/** The one place where an import file is read, its rows checked and its names matched. */

import { copy } from '../copy.js';
import { invalid } from '../errors.js';
import { daysInMonth, type OfficeDate } from '../officeTime.js';
import type { PersonRow, VaultRow, VendorRow } from '../types.js';

export const HEADER_ROW = 'Vault,Login for,Website,Username,Password,Who knows it,Last changed';
export const MAX_ROWS = 2_000;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export type RowReason =
  | 'Unknown vault'
  | 'Wrong number of columns'
  | 'Password must be 1 to 128 characters'
  | 'Login for must be 1 to 60 characters'
  | 'Website must be a domain or URL'
  | 'Username must be 1 to 120 characters'
  | 'Last changed must be M/D/YYYY';

export function cutFilename(given: string): string {
  const lastSlash = Math.max(given.lastIndexOf('/'), given.lastIndexOf('\\'));
  const tail = lastSlash === -1 ? given : given.slice(lastSlash + 1);
  return [...tail].filter((character) => (character.codePointAt(0) ?? 0) >= 32 && character !== '\u007f').join('');
}

export function readUpload(fileBase64: string, filename: string): { records: string[][]; storedName: string } {
  const cut = cutFilename(filename);
  if (cut.length < 1 || cut.length > 120) throw invalid({ filename: copy.importBadFilename });
  if (fileBase64.length % 4 !== 0 || !BASE64.test(fileBase64)) {
    throw invalid({ file_base64: copy.importFileUnreadable });
  }
  const bytes = Buffer.from(fileBase64, 'base64');
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw invalid({ file_base64: copy.importNotUtf8 });
  }
  if (decoded.includes('\u0000')) throw invalid({ file_base64: copy.importNotUtf8 });
  const text = decoded.startsWith('\ufeff') ? decoded.slice(1) : decoded;
  const all = splitRecords(text);
  const header = all[0];
  if (header === undefined || header.join(',') !== HEADER_ROW) {
    throw invalid({ file_base64: copy.importBadHeader });
  }
  const records = all.slice(1).filter((record) => !isBlank(record));
  if (records.length > MAX_ROWS) throw invalid({ file_base64: copy.importTooManyRows });
  return { records, storedName: cut };
}

function isBlank(record: readonly string[]): boolean {
  return record.every((field) => field === '');
}

/** Comma-separated fields, LF or CRLF record ends outside quotes, `""` for one quote. */
function splitRecords(text: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;
  let started = false;
  while (index < text.length) {
    const character = text[index] as string;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }
    if (character === '"' && field === '') {
      quoted = true;
      started = true;
      index += 1;
      continue;
    }
    if (character === ',') {
      fields.push(field);
      field = '';
      started = true;
      index += 1;
      continue;
    }
    if (character === '\n' || (character === '\r' && text[index + 1] === '\n')) {
      fields.push(field);
      records.push(fields);
      fields = [];
      field = '';
      started = false;
      index += character === '\r' ? 2 : 1;
      continue;
    }
    field += character;
    started = true;
    index += 1;
  }
  if (started || field !== '' || fields.length > 0) {
    fields.push(field);
    records.push(fields);
  }
  return records;
}

export function readHost(website: string): string | null {
  const trimmed = website.trim();
  if (trimmed === '') return null;
  for (const candidate of [trimmed, `http://${trimmed}`]) {
    let host: string;
    try {
      host = new URL(candidate).hostname.toLowerCase();
    } catch {
      continue;
    }
    const bare = host.startsWith('www.') ? host.slice(4) : host;
    if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(bare)) return bare;
  }
  return null;
}

export function readLastChanged(value: string): OfficeDate | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (match === null) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export type RowCheck =
  | { ok: false; reason: RowReason }
  | {
      ok: true;
      vault: VaultRow;
      label: string;
      host: string;
      username: string;
      secret: string;
      names: string[];
      lastChanged: OfficeDate | null;
    };

export function checkRow(record: readonly string[], vaults: readonly VaultRow[]): RowCheck {
  const first = record[0] ?? '';
  const vault = vaults.find((entry) => entry.name.toLowerCase() === first.trim().toLowerCase());
  if (vault === undefined) return { ok: false, reason: 'Unknown vault' };
  if (record.length !== 7) return { ok: false, reason: 'Wrong number of columns' };
  const [, loginFor, website, username, secret, knows, lastChanged] = record as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (secret.length < 1 || secret.length > 128) return { ok: false, reason: 'Password must be 1 to 128 characters' };
  if (loginFor.length < 1 || loginFor.length > 60) return { ok: false, reason: 'Login for must be 1 to 60 characters' };
  const host = readHost(website);
  if (host === null) return { ok: false, reason: 'Website must be a domain or URL' };
  if (username.length < 1 || username.length > 120) return { ok: false, reason: 'Username must be 1 to 120 characters' };
  const changed = lastChanged.trim() === '' ? null : readLastChanged(lastChanged);
  if (lastChanged.trim() !== '' && changed === null) return { ok: false, reason: 'Last changed must be M/D/YYYY' };
  return {
    ok: true,
    vault,
    label: loginFor,
    host,
    username,
    secret,
    names: knows
      .split(/[;/]/)
      .map((name) => name.trim())
      .filter((name) => name !== ''),
    lastChanged: changed,
  };
}

export type NameMatch = {
  text: string;
  match: 'email' | 'full_name' | 'alias' | 'chosen' | 'not_on_record' | null;
  person_id: string | null;
  held: 'no_match' | 'ambiguous' | null;
  candidates: { person_id: string; full_name: string }[];
};

function normal(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function wordsOf(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word !== '');
}

/** Email, then exact full name, then unique alias. Import never creates people. */
export function matchName(text: string, people: readonly PersonRow[]): NameMatch {
  const wanted = normal(text);
  const byEmail = people.find((person) => normal(person.email) === wanted);
  if (byEmail !== undefined) {
    return { text, match: 'email', person_id: byEmail.id, held: null, candidates: [] };
  }
  const byName = people.find((person) => normal(person.full_name) === wanted);
  if (byName !== undefined) {
    return { text, match: 'full_name', person_id: byName.id, held: null, candidates: [] };
  }
  const byAlias = people.filter((person) => person.aliases.some((alias) => normal(alias) === wanted));
  const only = byAlias[0];
  if (byAlias.length === 1 && only !== undefined) {
    return { text, match: 'alias', person_id: only.id, held: null, candidates: [] };
  }
  if (byAlias.length > 1) {
    return {
      text,
      match: null,
      person_id: null,
      held: 'ambiguous',
      candidates: byAlias.map((person) => ({ person_id: person.id, full_name: person.full_name })),
    };
  }
  const shared = new Set(wordsOf(text));
  return {
    text,
    match: null,
    person_id: null,
    held: 'no_match',
    candidates: people
      .filter((person) => wordsOf(person.full_name).some((word) => shared.has(word)))
      .map((person) => ({ person_id: person.id, full_name: person.full_name })),
  };
}

export function vendorForHost(host: string, vendors: readonly VendorRow[]): VendorRow | undefined {
  return vendors.find((vendor) => vendor.domain.toLowerCase() === host);
}
