// Import checks and mapping (Business rules · Import mapping and checks). The checks run in the brief's
// order, and everything but the content limits runs before any sheet content is read.
import { randomUUID } from "node:crypto";
import { type StoredCell, type WorkbookContent } from "../../shared/engine.js";
import { shiftFormula } from "../../shared/formula/lexer.js";
import { LIMITS } from "../../shared/limits.js";
import { cellName } from "../../shared/refs.js";
import { MAX_SHEET_NAME } from "../../shared/sheets.js";
import { type CellFormat, type NumberFormat, DEFAULT_FORMAT, dateTextOfSerial, formatForInput, textInput } from "../../shared/values.js";
import { ApiError } from "../errors.js";
import { type XmlElement, child, children, deepText, parseXml } from "./xml.js";
import { LOCAL_SIGNATURE, type ZipEntry, ZipFormatError, centralDirectory, readEntry } from "./zip.js";

const n = (v: number): string => v.toLocaleString("en-US");

const unsupportedFile = (): ApiError => new ApiError(415, "unsupported_file", "That file isn't a real .xlsx or .csv workbook.");

const tooManyCells = (): ApiError =>
  new ApiError(422, "too_many_cells", `That file has more than ${n(LIMITS.maxImportCells)} filled cells or goes past column Z or row ${LIMITS.maxRows}.`, {
    limit: LIMITS.maxImportCells,
  });

type ImportKind = "xlsx" | "csv";

interface ImportedWorkbook {
  kind: ImportKind;
  content: WorkbookContent;
}

/** Content type by content, not extension. */
function sniff(data: Buffer): { kind: "xlsx"; entries: ZipEntry[] } | { kind: "csv"; text: string } {
  if (data.subarray(0, 4).equals(LOCAL_SIGNATURE)) {
    let entries: ZipEntry[];
    try {
      entries = centralDirectory(data);
    } catch {
      throw unsupportedFile();
    }
    if (!entries.some((e) => e.name === "xl/workbook.xml")) throw unsupportedFile();
    return { kind: "xlsx", entries };
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(data);
  } catch {
    throw unsupportedFile();
  }
  if (text.includes("\0")) throw unsupportedFile();
  return { kind: "csv", text };
}

/** Archive checks, from the central directory only. */
function checkArchive(entries: ZipEntry[]): void {
  const total = entries.reduce((sum, e) => sum + e.uncompressedSize, 0);
  if (total > LIMITS.maxImportExpandedBytes) {
    throw new ApiError(422, "archive_too_large", `That file expands past ${n(LIMITS.maxImportExpandedBytes)} bytes, so it wasn't opened.`, {
      limit: LIMITS.maxImportExpandedBytes,
    });
  }
  if (entries.some((e) => e.uncompressedSize > LIMITS.maxCompressionRatio * e.compressedSize)) {
    throw new ApiError(422, "archive_too_compressed", `That file is compressed more than ${LIMITS.maxCompressionRatio} to 1, so it wasn't opened.`, {
      limit: LIMITS.maxCompressionRatio,
    });
  }
  if (entries.some((e) => e.name.includes("..") || e.name.startsWith("/") || e.name.startsWith("\\") || /^[A-Za-z]:/.test(e.name))) {
    throw new ApiError(422, "unsafe_archive", "That file contains unsafe paths and was rejected.");
  }
}

function sheetName(raw: string, taken: Set<string>): string {
  const base = raw.replace(/['![\]:*?/\\]/g, "-").slice(0, MAX_SHEET_NAME) || "Sheet";
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base.slice(0, MAX_SHEET_NAME - String(i).length - 1)}-${i}`;
  taken.add(name.toLowerCase());
  return name;
}

class CellBudget {
  private count = 0;

  /** Counts a filled cell; reading stops at the first cell past column Z, row 500 or the cell limit. */
  take(row: number, col: number): void {
    if (row < 1 || row > LIMITS.maxRows || col < 1 || col > LIMITS.maxColumns) throw tooManyCells();
    if (++this.count > LIMITS.maxImportCells) throw tooManyCells();
  }
}

// ---- xlsx ----

const BUILTIN_FORMATS: Record<number, NumberFormat> = {
  1: "0", 2: "0.00", 3: "0", 4: "0.00", 9: "0.0%", 10: "0.0%", 37: "0", 38: "0", 39: "0.00", 40: "0.00",
  14: "date", 15: "date", 16: "date", 17: "date", 18: "date", 19: "date", 20: "date", 21: "date", 22: "date",
};

/** The nearest Furrowbook number format for an xlsx format code. */
function nearestFormat(code: string): NumberFormat {
  const plain = code.split(";")[0].replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  if (/[yYdD]/.test(plain) || /m/i.test(plain.replace(/[#0.,%]/g, ""))) return "date";
  if (plain.includes("%")) return "0.0%";
  const decimals = /[0#]\.(0+)/.exec(plain)?.[1].length;
  if (decimals === undefined) return /[0#]/.test(plain) ? "0" : "general";
  return decimals === 1 ? "0.0" : decimals === 2 ? "0.00" : "0.000";
}

interface Styles {
  formats: CellFormat[];
}

function readStyles(xml: XmlElement | undefined): Styles {
  const sheet = child(xml, "styleSheet");
  const codes = new Map<number, string>();
  for (const f of children(child(sheet, "numFmts"), "numFmt")) codes.set(Number(f.attrs.numFmtId), f.attrs.formatCode ?? "");
  const bolds = children(child(sheet, "fonts"), "font").map((font) => {
    const b = child(font, "b");
    return b !== undefined && b.attrs.val !== "0" && b.attrs.val !== "false";
  });
  const formats = children(child(sheet, "cellXfs"), "xf").map((xf) => {
    const id = Number(xf.attrs.numFmtId ?? 0);
    const numberFormat = codes.has(id) ? nearestFormat(codes.get(id) as string) : (BUILTIN_FORMATS[id] ?? "general");
    return { numberFormat, bold: bolds[Number(xf.attrs.fontId ?? 0)] ?? false };
  });
  return { formats };
}

function xlsxPath(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `xl/${target}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== ".") out.push(p);
  }
  return out.join("/");
}

function readXlsx(data: Buffer, entries: ZipEntry[]): WorkbookContent {
  const byName = new Map(entries.map((e) => [e.name, e]));
  const part = (name: string): XmlElement | undefined => {
    const entry = byName.get(name);
    if (!entry) return undefined;
    try {
      return parseXml(readEntry(data, entry).toString("utf8"));
    } catch (error) {
      if (error instanceof ZipFormatError) throw unsupportedFile();
      throw error;
    }
  };
  const book = child(part("xl/workbook.xml"), "workbook");
  const listed = children(child(book, "sheets"), "sheet");
  if (listed.length > LIMITS.maxSheets) {
    throw new ApiError(422, "too_many_sheets", `That file has more than ${LIMITS.maxSheets} sheets.`, { limit: LIMITS.maxSheets });
  }
  const rels = new Map(children(child(part("xl/_rels/workbook.xml.rels"), "Relationships"), "Relationship").map((r) => [r.attrs.Id, r.attrs.Target ?? ""]));
  const shared = children(child(part("xl/sharedStrings.xml"), "sst"), "si").map(deepText);
  const styles = readStyles(part("xl/styles.xml"));
  const budget = new CellBudget();
  const taken = new Set<string>();
  const sheets: WorkbookContent["sheets"] = [];
  for (const entry of listed) {
    const target = rels.get(entry.attrs.id ?? "");
    const ws = target ? child(part(xlsxPath(target)), "worksheet") : undefined;
    const cells: Record<string, StoredCell> = {};
    const masters = new Map<string, { formula: string; row: number; col: number }>();
    let rowNumber = 0;
    for (const row of children(child(ws, "sheetData"), "row")) {
      rowNumber = row.attrs.r ? Number(row.attrs.r) : rowNumber + 1;
      let colNumber = 0;
      for (const c of children(row, "c")) {
        const at = /^([A-Z]+)(\d+)$/.exec(c.attrs.r ?? "");
        colNumber = at ? [...at[1]].reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0) : colNumber + 1;
        const pos = { row: at ? Number(at[2]) : rowNumber, col: colNumber };
        const f = child(c, "f");
        const v = child(c, "v")?.text;
        const inline = child(c, "is");
        if (f === undefined && v === undefined && inline === undefined) continue;
        budget.take(pos.row, pos.col);
        const format = styles.formats[Number(c.attrs.s ?? 0)] ?? DEFAULT_FORMAT;
        let input: string;
        if (f !== undefined && (f.text.trim() !== "" || f.attrs.t === "shared")) {
          let formula = f.text.trim();
          if (f.attrs.t === "shared" && f.attrs.si !== undefined) {
            const master = masters.get(f.attrs.si);
            if (formula !== "") masters.set(f.attrs.si, { formula, row: pos.row, col: pos.col });
            else if (master) formula = shiftFormula(master.formula, pos.row - master.row, pos.col - master.col);
          }
          input = formula === "" ? "" : `=${formula}`;
        } else if (c.attrs.t === "s") input = textInput(shared[Number(v)] ?? "");
        else if (c.attrs.t === "inlineStr") input = textInput(inline ? deepText(inline) : "");
        else if (c.attrs.t === "str" || c.attrs.t === "e") input = textInput(v ?? "");
        else if (c.attrs.t === "b") input = v === "1" ? "TRUE" : "FALSE";
        else if (format.numberFormat === "date" && v !== undefined && Number.isFinite(Number(v))) input = dateTextOfSerial(Number(v));
        else input = v !== undefined && Number.isFinite(Number(v)) ? String(Number(v)) : textInput(v ?? "");
        if (input !== "") cells[cellName(pos.row, pos.col)] = { input, format: formatForInput(input, format) };
      }
    }
    sheets.push({ id: randomUUID(), name: sheetName(entry.attrs.name ?? "Sheet", taken), cells });
  }
  return { sheets, charts: [] };
}

// ---- csv ----

function csvRecords(text: string): string[][] {
  const body = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && body[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readCsv(text: string, stem: string): WorkbookContent {
  const budget = new CellBudget();
  const cells: Record<string, StoredCell> = {};
  csvRecords(text).forEach((record, r) => {
    record.forEach((field, c) => {
      if (field === "") return;
      budget.take(r + 1, c + 1);
      const input = field.startsWith("=") ? `'${field}` : field;
      cells[cellName(r + 1, c + 1)] = { input, format: formatForInput(input, DEFAULT_FORMAT) };
    });
  });
  return { sheets: [{ id: randomUUID(), name: sheetName(stem, new Set()), cells }], charts: [] };
}

/** Runs every check in order and maps the file. Throws the brief's errors. */
export function readImport(data: Buffer, stem: string): ImportedWorkbook {
  const sniffed = sniff(data);
  if (sniffed.kind === "csv") return { kind: "csv", content: readCsv(sniffed.text, stem) };
  checkArchive(sniffed.entries);
  return { kind: "xlsx", content: readXlsx(data, sniffed.entries) };
}
