/** The one definition of CSV reading and writing, including formula neutralisation. */

const FORMULA_LEAD = new Set(['=', '+', '-', '@', '\t', '\r']);

export function neutraliseFormula(cell: string): string {
  return cell.length > 0 && FORMULA_LEAD.has(cell[0]) ? `'${cell}` : cell;
}

function quoteCell(cell: string): string {
  if (/[",\n\r]/u.test(cell)) return `"${cell.replace(/"/gu, '""')}"`;
  return cell;
}

export function writeCsv(rows: readonly string[][]): string {
  return rows.map((row) => row.map((cell) => quoteCell(neutraliseFormula(cell))).join(',')).join('\r\n') + '\r\n';
}

export interface CsvRecord {
  line: number;
  fields: string[];
}

/**
 * Reads a CSV body: an optional byte-order mark, LF or CRLF endings, standard
 * quoting with commas, doubled quotes and line breaks inside quoted fields.
 */
export function readCsv(input: string): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let line = 1;
  let recordLine = 1;
  let quoted = false;
  let started = false;
  let index = 0;

  const endField = (): void => {
    fields.push(field);
    field = '';
  };
  const endRecord = (): void => {
    endField();
    records.push({ line: recordLine, fields });
    fields = [];
    started = false;
  };

  while (index < text.length) {
    const character = text[index];
    if (!started) {
      recordLine = line;
      started = true;
    }
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
      if (character === '\r' && text[index + 1] === '\n') {
        // Records read the same whether the file uses LF or CRLF endings.
        field += '\n';
        line += 1;
        index += 2;
        continue;
      }
      if (character === '\n') line += 1;
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
    if (character === '\r' && text[index + 1] === '\n') {
      endRecord();
      line += 1;
      index += 2;
      continue;
    }
    if (character === '\n' || character === '\r') {
      endRecord();
      line += 1;
      index += 1;
      continue;
    }
    field += character;
    index += 1;
  }
  if (started || field !== '' || fields.length > 0) endRecord();
  return records;
}
