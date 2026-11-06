/** Comma separated, double-quoted fields, LF or CRLF, with a byte order mark allowed. */
export function parseCsv(text: string): string[][] {
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < body.length) {
    const character = body[index] as string;
    if (quoted) {
      if (character === '"') {
        if (body[index + 1] === '"') {
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
      index += 1;
      continue;
    }
    if (character === ',') {
      endField();
      index += 1;
      continue;
    }
    if (character === '\r' && body[index + 1] === '\n') {
      endRow();
      index += 2;
      continue;
    }
    if (character === '\n') {
      endRow();
      index += 1;
      continue;
    }
    field += character;
    index += 1;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * Every field in double quotes, a double quote inside doubled, CRLF line ends,
 * and a leading =, +, -, @, tab or carriage return prefixed with an apostrophe.
 */
export function writeCsv(rows: readonly (readonly string[])[]): string {
  return `${rows.map((row) => row.map(quoteField).join(',')).join('\r\n')}\r\n`;
}

const LEADING_CHARACTERS = ['=', '+', '-', '@', '\t', '\r'];

function quoteField(value: string): string {
  const first = value.slice(0, 1);
  const guarded = LEADING_CHARACTERS.includes(first) ? `'${value}` : value;
  return `"${guarded.split('"').join('""')}"`;
}
