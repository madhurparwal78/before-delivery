// .spurpack format: encoding, records, canonical order.

export function escField(value: string): string {
  if (value === '-') return '\\-';
  return value.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n');
}

export function unescapeField(value: string): string {
  let out = '';
  let i = 0;
  while (i < value.length) {
    if (value[i] === '\\') {
      const c = value[i + 1];
      if (c === 't') { out += '\t'; i += 2; continue; }
      if (c === 'n') { out += '\n'; i += 2; continue; }
      if (c === '\\') { out += '\\'; i += 2; continue; }
      if (c === '-') { out += '-'; i += 2; continue; }
      if (c === ',') { out += ','; i += 2; continue; }
      out += value[i];
      i++;
      continue;
    }
    out += value[i];
    i++;
  }
  return out;
}

export function escListItem(item: string): string {
  return escField(item).replace(/,/g, '\\,');
}

export function unescapeList(value: string): string[] {
  const items: string[] = [];
  let cur = '';
  let i = 0;
  while (i < value.length) {
    if (value[i] === '\\') {
      const c = value[i + 1];
      if (c === ',') { cur += ','; i += 2; continue; }
      if (c === 't') { cur += '\t'; i += 2; continue; }
      if (c === 'n') { cur += '\n'; i += 2; continue; }
      if (c === '\\') { cur += '\\'; i += 2; continue; }
      if (c === '-') { cur += '-'; i += 2; continue; }
      cur += value[i];
      i++;
      continue;
    }
    if (value[i] === ',') {
      items.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += value[i];
    i++;
  }
  if (cur !== '' || items.length > 0) items.push(cur);
  return items;
}

export interface PackRecord {
  name: string;
  fields: string[];
}

export function recordLine(name: string, fields: string[]): string {
  return [name, ...fields].map(escField).join('\t');
}

export function parsePackLine(line: string): { name: string; fields: string[] } | null {
  const parts: string[] = [];
  let cur = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] === '\\') {
      const c = line[i + 1];
      if (c === 't') { cur += '\t'; i += 2; continue; }
      if (c === 'n') { cur += '\n'; i += 2; continue; }
      if (c === '\\') { cur += '\\'; i += 2; continue; }
      if (c === '-') { cur += '-'; i += 2; continue; }
      cur += line[i];
      i++;
      continue;
    }
    if (line[i] === '\t') {
      parts.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += line[i];
    i++;
  }
  parts.push(cur);
  if (parts.length === 0) return null;
  return { name: unescapeField(parts[0]), fields: parts.slice(1).map(unescapeField) };
}

export const RECORD_FIELD_COUNTS: Record<string, number> = {
  user: 2,
  file: 3,
  commit: 6,
  ref: 4,
  label: 3,
  milestone: 6,
  issue: 10,
  request: 8,
  thread: 7,
  wikipage: 6,
  config: 3,
};

export function encodeBool(v: boolean): string {
  return v ? 'true' : 'false';
}

export function encodeList(items: string[]): string {
  if (items.length === 0) return '-';
  return items.map(escListItem).join(',');
}

export function decodeList(value: string): string[] {
  if (value === '-') return [];
  return unescapeList(value);
}

export function encodeOptional(value: string | null): string {
  if (value === null || value === '') return '-';
  return value;
}

export function encodeOptionalInt(value: number | null): string {
  if (value === null) return '-';
  return String(value);
}
