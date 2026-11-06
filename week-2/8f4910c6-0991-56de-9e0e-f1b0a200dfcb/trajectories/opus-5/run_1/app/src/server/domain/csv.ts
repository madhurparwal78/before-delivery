const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/** Text cells that could be read as a formula are neutralised with an apostrophe. */
function neutraliseCell(value: string): string {
  return FORMULA_TRIGGERS.some((trigger) => value.startsWith(trigger)) ? `'${value}` : value;
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export type CsvColumnKind = 'text' | 'number';

/** Every field quoted, every row ended with CRLF, UTF-8 without a byte-order mark. */
export function buildCsv(header: string[], rows: string[][], kinds: CsvColumnKind[]): string {
  const lines = [header.map((cell) => quote(cell)).join(',')];
  for (const row of rows) {
    lines.push(
      row
        .map((cell, index) => quote(kinds[index] === 'text' ? neutraliseCell(cell) : cell))
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Reads a CSV with quoted fields, doubled quotes and either line ending. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let index = 0;
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  while (index < body.length) {
    const char = body[index];
    if (quoted) {
      if (char === '"') {
        if (body[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      cell += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && body[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      index += 1;
      continue;
    }
    cell += char;
    index += 1;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
