import { OpError } from './bytes.js';

/** Parses RFC 4180 text into records of fields. CRLF and LF end a record; a final break is ignored. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let at = 0;
  let line = 1;
  let atFieldStart = true;

  const pushField = (): void => {
    fields.push(field);
    field = '';
    atFieldStart = true;
  };
  const pushRecord = (): void => {
    pushField();
    records.push(fields);
    fields = [];
  };

  while (at < text.length) {
    const ch = text[at]!;
    if (atFieldStart && ch === '"') {
      const quoteLine = line;
      at += 1;
      atFieldStart = false;
      let closed = false;
      while (at < text.length) {
        const inner = text[at]!;
        if (inner === '"') {
          if (text[at + 1] === '"') {
            field += '"';
            at += 2;
            continue;
          }
          at += 1;
          closed = true;
          break;
        }
        if (inner === '\n') line += 1;
        field += inner;
        at += 1;
      }
      if (!closed) throw new OpError(`Unclosed quote at line ${quoteLine}`);
      continue;
    }
    atFieldStart = false;
    if (delimiter.length > 0 && text.startsWith(delimiter, at)) {
      pushField();
      at += delimiter.length;
      continue;
    }
    if (ch === '\r' && text[at + 1] === '\n') {
      pushRecord();
      at += 2;
      line += 1;
      continue;
    }
    if (ch === '\n') {
      pushRecord();
      at += 1;
      line += 1;
      continue;
    }
    field += ch;
    at += 1;
  }
  if (field !== '' || fields.length > 0) pushRecord();
  return records;
}

export function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}
