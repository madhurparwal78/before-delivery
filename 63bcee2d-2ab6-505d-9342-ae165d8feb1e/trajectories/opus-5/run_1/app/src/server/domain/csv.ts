/**
 * CSV writing: UTF-8, comma separated, RFC 4180 quoting, with every text cell
 * that begins with a formula character neutralised by a leading apostrophe.
 */

const FORMULA_STARTS = ['=', '+', '-', '@', '\t', '\r'];

export function neutraliseTextCell(value: string): string {
  return FORMULA_STARTS.some((start) => value.startsWith(start)) ? `'${value}` : value;
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export type CsvCell = { text: string } | { raw: string };

export const text = (value: string): CsvCell => ({ text: value });
export const raw = (value: string): CsvCell => ({ raw: value });

function render(cell: CsvCell): string {
  return 'text' in cell ? quote(neutraliseTextCell(cell.text)) : quote(cell.raw);
}

export function csvDocument(header: readonly string[], bodyRows: readonly CsvCell[][]): string {
  const lines = [header.map((name) => quote(name)).join(',')];
  for (const row of bodyRows) lines.push(row.map(render).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** Splits CSV text into rows of cells, honouring RFC 4180 quoting. */
export function parseCsv(input: string): string[][] {
  const withoutBom = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const result: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let index = 0;
  while (index < withoutBom.length) {
    const character = withoutBom[index] as string;
    if (quoted) {
      if (character === '"') {
        if (withoutBom[index + 1] === '"') {
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
    if (character === '"' && cell === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (character === ',') {
      row.push(cell);
      cell = '';
      index += 1;
      continue;
    }
    if (character === '\r' || character === '\n') {
      row.push(cell);
      result.push(row);
      row = [];
      cell = '';
      index += character === '\r' && withoutBom[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += character;
    index += 1;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    result.push(row);
  }
  return result;
}
