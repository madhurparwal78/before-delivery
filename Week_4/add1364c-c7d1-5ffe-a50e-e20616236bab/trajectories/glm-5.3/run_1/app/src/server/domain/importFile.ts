/**
 * Reading an import file, in the published order:
 * base64 -> UTF-8 check -> BOM drop -> record/field split -> header check.
 */
export interface ParsedRecord {
  fields: string[];
}

export const IMPORT_HEADER = ['Vault', 'Login for', 'Website', 'Username', 'Password', 'Who knows it', 'Last changed'];

export type ImportDecodeFailure = 'not_base64' | 'not_utf8' | 'nul_byte' | 'wrong_header';

export interface ImportFile {
  headerOk: true;
  records: ParsedRecord[];
}

export function decodeImportFile(base64: string): { failure: ImportDecodeFailure } | { records: ParsedRecord[] } {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    return { failure: 'not_base64' };
  }
  const buffer = Buffer.from(base64, 'base64');
  const text = buffer.toString('utf8');
  // Strict UTF-8 check: re-encode and compare. Invalid sequences become U+FFFD.
  const reencoded = Buffer.from(text, 'utf8');
  if (buffer.includes(0)) {
    return { failure: 'nul_byte' };
  }
  if (!buffersEqual(buffer, reencoded)) {
    return { failure: 'not_utf8' };
  }
  let body = text;
  if (body.charCodeAt(0) === 0xfeff) {
    body = body.slice(1);
  }
  const records = splitRecords(body);
  if (records.length === 0 || !headerMatches(records[0].fields)) {
    return { failure: 'wrong_header' };
  }
  return { records: records.slice(1) };
}

function buffersEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function headerMatches(fields: string[]): boolean {
  if (fields.length !== IMPORT_HEADER.length) return false;
  return IMPORT_HEADER.every((expected, index) => fields[index] === expected);
}

/**
 * Split CSV records. A record ends at LF or CRLF outside quotes; the last record
 * may have no line end. Quoted fields may contain commas and line breaks; `""` is
 * one double quote.
 */
export function splitRecords(text: string): ParsedRecord[] {
  const records: ParsedRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;
  let i = 0;
  const pushField = () => {
    fields.push(field);
    field = '';
    fieldStarted = false;
  };
  const pushRecord = () => {
    pushField();
    records.push({ fields });
    fields = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === '\r' && text[i + 1] === '\n') {
        field += '\r\n';
        i += 2;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r' && text[i + 1] === '\n') {
      pushRecord();
      i += 2;
      continue;
    }
    if (ch === '\n') {
      pushRecord();
      i += 1;
      continue;
    }
    field += ch;
    fieldStarted = true;
    i += 1;
  }
  if (field !== '' || fields.length > 0 || fieldStarted) {
    pushRecord();
  }
  return records;
}

/** Skip blank records: an empty line, or a record whose fields are all empty. */
export function isBlankRecord(record: ParsedRecord): boolean {
  return record.fields.every((field) => field === '');
}

/**
 * The published filename rule: cut to the part after the last `/` or `\`, remove
 * control characters, and require 1 to 120 characters.
 */
export function cutFilename(raw: string): string | null {
  const afterSlash = raw.split(/[/\\]/).pop() ?? '';
  const stripped = Array.from(afterSlash).filter((ch) => ch.codePointAt(0)! >= 32).join('');
  if (stripped.length < 1 || stripped.length > 120) return null;
  return stripped;
}

/** The published import row checks, in order; the first failure rejects the row. */
export function checkImportRow(fields: string[], vaultNamesLower: Set<string>): string | null {
  const value = (index: number): string => (fields.length > index ? fields[index] ?? '' : '');
  if (!vaultNamesLower.has(value(0).trim().toLowerCase())) return 'Unknown vault';
  if (fields.length !== 7) return 'Wrong number of columns';
  const password = value(4);
  if (password.length < 1 || password.length > 128) return 'Password must be 1 to 128 characters';
  const loginFor = value(1);
  if (loginFor.length < 1 || loginFor.length > 60) return 'Login for must be 1 to 60 characters';
  const website = value(2);
  if (readHost(website) === null) return 'Website must be a domain or URL';
  const username = value(3);
  if (username.length < 1 || username.length > 120) return 'Username must be 1 to 120 characters';
  const lastChanged = value(6);
  if (lastChanged === '') return null; // empty is allowed: last_turned_on becomes office today
  if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(lastChanged.trim())) return 'Last changed must be M/D/YYYY';
  return null;
}

/** Read a host name from a domain or URL, lowercased, without a leading `www.` */
export function readHost(website: string): string | null {
  const trimmed = website.trim();
  if (trimmed === '') return null;
  let host = trimmed.toLowerCase();
  const urlMatch = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/.exec(host);
  if (urlMatch) {
    host = urlMatch[1];
  } else if (host.includes('/')) {
    host = host.split('/')[0] ?? '';
  }
  host = host.split(':')[0] ?? '';
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return null;
  if (host.startsWith('www.')) host = host.slice(4);
  return host;
}

/** Names in `Who knows it` are separated by `;` or `/`; a comma inside quotes is part of a name. */
export function splitWhoKnows(raw: string): string[] {
  return raw
    .split(/[;/]/)
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

/** The published name comparison: trim, ignore case and repeated spaces. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Words of a full name, ignoring punctuation, for `no_match` candidates. */
export function nameWords(name: string): string[] {
  return name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word !== '');
}
