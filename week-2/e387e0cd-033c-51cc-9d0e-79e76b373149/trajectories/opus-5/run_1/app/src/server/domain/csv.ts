/** CSV reading for the spreadsheet import and writing for the regulator's file. */

/** RFC 4180 reader: UTF-8 with or without a byte order mark, LF or CRLF. */
export function readCsv(text: string): string[][] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let index = 0;
  let touched = false;
  while (index < body.length) {
    const character = body[index];
    if (quoted) {
      if (character === '"') {
        if (body[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      cell += character;
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = true;
      touched = true;
      index += 1;
      continue;
    }
    if (character === ',') {
      row.push(cell);
      cell = '';
      touched = true;
      index += 1;
      continue;
    }
    if (character === '\r' || character === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      touched = false;
      index += character === '\r' && body[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += character;
    touched = true;
    index += 1;
  }
  if (cell !== '' || touched || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const NEUTRALISE_FIRST = ['=', '+', '-', '@', '\t', '\r'];

function writeCell(value: string): string {
  const neutralised = NEUTRALISE_FIRST.includes(value.charAt(0)) ? `'${value}` : value;
  return `"${neutralised.split('"').join('""')}"`;
}

/** Every field quoted, CRLF lines, with the published neutralisation. */
export function writeCsv(rows: ReadonlyArray<readonly string[]>): string {
  return rows.map((row) => row.map(writeCell).join(',')).join('\r\n') + (rows.length > 0 ? '\r\n' : '');
}
