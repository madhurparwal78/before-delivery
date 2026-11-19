const DANGEROUS_START = /^[=+\-@\t\r]/;

/** A cell of the materials list file: always quoted, inner quotes doubled, a dangerous start behind an apostrophe. */
function cell(value: string): string {
  const safe = DANGEROUS_START.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function csvFile(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => `${row.map(cell).join(",")}\r\n`).join("");
}
