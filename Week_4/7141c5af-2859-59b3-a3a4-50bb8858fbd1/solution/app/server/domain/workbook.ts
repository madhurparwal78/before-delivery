import { copy } from "./copy.ts";
import { isStampNumber } from "./luhn.ts";

const COLUMNS = ["client", "piece", "maker", "year", "stamp", "material", "notes"] as const;
type Column = (typeof COLUMNS)[number];

export interface WorkbookRow {
  row: number;
  status: "new" | "matched" | "refused";
  reason: string | null;
  fields: Record<Column, string>;
}

/** A file's records, split by the rules of the format: a quoted field may hold the separator, quotes and line breaks. */
function readRecords(text: string, separator: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let index = 0;
  const endField = (): void => {
    record.push(field);
    field = "";
  };
  const endRecord = (): void => {
    endField();
    records.push(record);
    record = [];
  };
  while (index < text.length) {
    const char = text[index];
    if (char === '"' && field === "") {
      index += 1;
      for (;;) {
        const close = text.indexOf('"', index);
        if (close < 0) {
          field += text.slice(index);
          index = text.length;
          break;
        }
        field += text.slice(index, close);
        index = close + 1;
        if (text[index] !== '"') break;
        field += '"';
        index += 1;
      }
    } else if (char === separator) {
      endField();
      index += 1;
    } else if (char === "\n" || (char === "\r" && text[index + 1] === "\n")) {
      endRecord();
      index += char === "\n" ? 1 : 2;
    } else {
      field += char;
      index += 1;
    }
  }
  if (field !== "" || record.length > 0) endRecord();
  return records;
}

function separatorOf(text: string): string {
  const lineEnd = text.search(/\r?\n/);
  return (lineEnd < 0 ? text : text.slice(0, lineEnd)).includes(";") ? ";" : ",";
}

function decode(file: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(file);
  } catch {
    return null;
  }
}

interface ParsedFile {
  records: { row: number; cells: string[] }[];
  header: string[];
}

/** Reads a file, or gives the copy that refuses it whole: not UTF-8, then an extra column, then a missing one. */
export function parseWorkbook(file: Buffer): ParsedFile | { refused: string } {
  const text = decode(file);
  if (text === null) return { refused: copy("F-83") };
  const [header = [], ...rest] = readRecords(text, separatorOf(text));
  const extra = header.find((name) => !(COLUMNS as readonly string[]).includes(name));
  if (extra !== undefined) return { refused: copy("F-80", { name: extra }) };
  const missing = COLUMNS.find((name) => !header.includes(name));
  if (missing !== undefined) return { refused: copy("F-81", { name: missing }) };
  return { header, records: rest.map((cells, index) => ({ row: index + 2, cells })) };
}

/** One decision per row: field count, stamp, title, material, then new or matched on the stamp within the desk. */
export function judgeRows(file: ParsedFile, stamps: ReadonlySet<string>, codes: ReadonlySet<string>): WorkbookRow[] {
  const seen = new Set(stamps);
  return file.records.map(({ row, cells }) => {
    const fields = Object.fromEntries(COLUMNS.map((name) => [name, cells[file.header.indexOf(name)] ?? ""])) as Record<Column, string>;
    const refusal = (): string | null => {
      if (cells.length !== COLUMNS.length) return copy("F-87", { n: row });
      if (!isStampNumber(fields.stamp)) return copy("F-84", { n: row });
      if (fields.piece.trim() === "") return copy("F-85", { n: row });
      if (fields.material !== "" && !codes.has(fields.material)) return copy("F-86", { n: row, code: fields.material });
      return null;
    };
    const reason = refusal();
    if (reason !== null) return { row, status: "refused", reason, fields };
    const status = seen.has(fields.stamp) ? "matched" : "new";
    seen.add(fields.stamp);
    return { row, status, reason: null, fields };
  });
}
