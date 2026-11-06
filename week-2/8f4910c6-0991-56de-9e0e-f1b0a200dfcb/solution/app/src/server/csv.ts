// CSV: every field quoted with inner quotes doubled, CRLF after every row, text cells that start with a
// formula trigger get a leading apostrophe. Number cells are written as-is.

const FORMULA = /^[=+\-@\t\r]/;

export type Cell = { text: string } | { number: string };

export const text = (value: string | null | undefined): Cell => ({ text: value ?? "" });
export const number = (value: string | number | null | undefined): Cell => ({ number: value === null || value === undefined ? "" : String(value) });

function field(cell: Cell): string {
  const raw = "text" in cell ? (FORMULA.test(cell.text) ? `'${cell.text}` : cell.text) : cell.number;
  return `"${raw.replace(/"/g, '""')}"`;
}

export function csv(header: string[], body: Cell[][]): string {
  return [header.map((name) => field(text(name))), ...body.map((row) => row.map(field))]
    .map((row) => `${row.join(",")}\r\n`)
    .join("");
}

/** RFC 4180 reader for imports: quoted fields, doubled quotes, CRLF or LF rows. */
export function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        value += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}
