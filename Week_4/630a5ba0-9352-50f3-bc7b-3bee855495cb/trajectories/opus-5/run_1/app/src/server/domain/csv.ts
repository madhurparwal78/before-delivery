export interface CsvTable {
  header: string[];
  rows: { line: number; cells: string[] }[];
}

/** UTF-8 CSV with quoted fields; the header is line 1. */
export function parseCsv(text: string): CsvTable {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let cells: string[] = [];
  let value = '';
  let quoted = false;
  let index = 0;
  let sawContent = false;

  const endCell = (): void => {
    cells.push(value);
    value = '';
  };
  const endRecord = (): void => {
    endCell();
    records.push(cells);
    cells = [];
  };

  while (index < body.length) {
    const char = body[index]!;
    if (quoted) {
      if (char === '"') {
        if (body[index + 1] === '"') {
          value += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      value += char;
      index += 1;
      continue;
    }
    if (char === '"' && value === '') {
      quoted = true;
      sawContent = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      endCell();
      sawContent = true;
      index += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      if (sawContent || value !== '' || cells.length > 0) endRecord();
      sawContent = false;
      index += char === '\r' && body[index + 1] === '\n' ? 2 : 1;
      continue;
    }
    value += char;
    sawContent = true;
    index += 1;
  }
  if (sawContent || value !== '' || cells.length > 0) endRecord();

  const header = records.shift() ?? [];
  return {
    header: header.map((cell) => cell.trim().toLowerCase()),
    rows: records.map((row, offset) => ({ line: offset + 2, cells: row })),
  };
}
