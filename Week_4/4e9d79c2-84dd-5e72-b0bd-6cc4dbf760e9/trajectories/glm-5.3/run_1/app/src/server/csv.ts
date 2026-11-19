import { Buffer } from "node:buffer";

export function formatUkPostcode(raw: string): string | null {
  const t = (raw ?? "").toUpperCase().replace(/\s+/g, "");
  if (!t) return null;
  const m = /^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/.exec(t);
  if (!m) return raw || null;
  return `${m[1]} ${m[2]}`;
}

export function csvEscape(value: string | number | null | undefined): string {
  const v = value === null || value === undefined ? "" : String(value);
  const needs = /[",\r\n;]/.test(v);
  const body = v.replace(/^-/, "-");
  return needs ? '"' + v.replace(/"/g, '""') + '"' : body;
}

/** Neutralise risky cell starts with a straight apostrophe, per DP-35. */
export function csvCell(value: string | number | null | undefined): string {
  const v = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(v)) return "'" + v;
  return csvEscape(v);
}

/** Split one CSV line honouring double quotes; sep is , or ; */
export function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export interface ParsedCsv {
  header: string[];
  rows: string[][];
  rowNumbers: number[];
  delimiter: string;
}

export function parseCsv(text: string, expectedHeader: string[]): ParsedCsv | null {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r\n|\n/);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return null;
  const first = lines[0];
  const delim = [";", ","].find((d) => splitCsvLine(first, d).length >= 2) ?? ",";
  const header = splitCsvLine(first, delim).map((h) => h.trim().toLowerCase());
  const want = expectedHeader.map((h) => h.toLowerCase());
  const sameSet =
    header.length === want.length &&
    want.every((h) => header.includes(h)) &&
    header.every((h) => want.includes(h));
  if (!sameSet) return null;
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === "") continue;
    const cells = splitCsvLine(raw, delim);
    while (cells.length < header.length) cells.push("");
    rows.push(cells);
    rowNumbers.push(i + 1);
  }
  return { header, rows, rowNumbers, delimiter: delim };
}

/** csvCell for every cell, then join; headers go through csvEscape only. */
export function csvBody(header: string[], rows: (string | number | null)[][]): string {
  const h = header.map((x) => csvEscape(x)).join(",");
  const b = rows.map((r) => r.map((c) => csvCell(c)).join(",")).join("\r\n");
  const body = rows.length ? h + "\r\n" + b : h;
  return "\uFEFF" + body + "\r\n";
}

/** Build a filename header pair handling non-ASCII names via filename*. */
export function fileHeaders(baseName: string, ext: string): Record<string, string> {
  const asciiFallback = baseName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const full = `${baseName}.${ext}`;
  const ascii = `${asciiFallback}.${ext}`;
  const hdr = `attachment; filename="${ascii.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(full)}`;
  return { "Content-Disposition": hdr };
}

export const BOM = "\uFEFF";

export function bufStartsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}
