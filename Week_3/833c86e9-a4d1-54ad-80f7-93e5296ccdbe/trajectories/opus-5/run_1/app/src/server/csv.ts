/** Neutralises a formula-leading cell, then quotes it when it needs quoting. */
export function csvCell(value: string): string {
  let cell = value;
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  if (/[",\n\r]/.test(cell)) cell = `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

export function csvLine(cells: (string | number)[]): string {
  return `${cells.map((cell) => csvCell(String(cell))).join(',')}\n`;
}
