import { Buffer } from "node:buffer";
import { parseCsv, type CsvError, type ColumnMeta } from "./csv.js";

export interface CsvUpload {
  ok: boolean;
  columns: ColumnMeta[];
  records: (string | null)[][];
  errors: CsvError[];
  rowCount: number;
}

/**
 * The published upload errors. A file with any error stores nothing. Size and
 * emptiness are checked first, then the parse errors in line order, then the
 * row limit.
 */
export function uploadCsv(bytes: Buffer, csvMaxBytes: number, rowMax: number): CsvUpload {
  if (bytes.length > csvMaxBytes) {
    return {
      ok: false,
      columns: [],
      records: [],
      rowCount: 0,
      errors: [{ line: null, message: `File is ${bytes.length} bytes. The limit is ${csvMaxBytes}.` }],
    };
  }
  const parsed = parseCsv(bytes, { rowMax });
  if (parsed.rowCount === 0) {
    return {
      ok: false,
      columns: parsed.columns,
      records: [],
      rowCount: 0,
      errors: [{ line: null, message: "File is empty." }],
    };
  }
  const ok = parsed.errors.length === 0;
  return {
    ok,
    columns: parsed.columns,
    records: parsed.records,
    errors: parsed.errors,
    rowCount: parsed.rowCount,
  };
}
