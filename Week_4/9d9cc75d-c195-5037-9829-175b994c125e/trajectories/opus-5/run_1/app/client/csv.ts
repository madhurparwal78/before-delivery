/** Reads a stored table file so the Group dialog can list a field's members. */
export function parseCsvText(text: string): { header: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let i = 0;
  const endRow = (): void => {
    cells.push(cell);
    cell = '';
    rows.push(cells);
    cells = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i += 1;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        cell += text[i];
        i += 1;
      }
      continue;
    }
    if (ch === ',') {
      cells.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      endRow();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (cell !== '' || cells.length > 0) endRow();
  const header = rows.shift() ?? [];
  return { header, rows };
}

export function distinctValues(text: string, column: string): string[] {
  const { header, rows } = parseCsvText(text);
  const index = header.indexOf(column);
  if (index < 0) return [];
  const seen: string[] = [];
  for (const row of rows) {
    const value = row[index] ?? '';
    if (value === '' || seen.includes(value)) continue;
    seen.push(value);
  }
  return seen.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
