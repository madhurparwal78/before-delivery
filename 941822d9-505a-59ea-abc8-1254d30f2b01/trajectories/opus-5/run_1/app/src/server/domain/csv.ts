const FORMULA_STARTERS = ['=', '+', '-', '@', '\t', '\r'];

/** A cell a spreadsheet would read as a formula gets a single leading apostrophe. */
function neutralise(value: string): string {
  const first = value.slice(0, 1);
  return FORMULA_STARTERS.includes(first) ? `'${value}` : value;
}

function quoteIfNeeded(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function csvCell(value: string): string {
  return quoteIfNeeded(neutralise(value));
}

export function csvDocument(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [header.join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  return lines.map((line) => `${line}\n`).join('');
}
