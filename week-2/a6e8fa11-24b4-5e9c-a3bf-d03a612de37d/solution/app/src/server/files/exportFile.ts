// Export files (Business rules · Exports). CSV quoting and neutralisation are adapted from kit/modules/csv_safe.
import { type WorkbookEngine } from "../../shared/engine.js";
import { parseCell } from "../../shared/refs.js";
import { type CellFormat, type NumberFormat, isError } from "../../shared/values.js";
import { escapeXml } from "./xml.js";
import { writeZip } from "./zip.js";

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const CSV_TYPE = "text/csv; charset=utf-8";

const SPREADSHEET_START = /^[=+\-@]/;

/** One csv field: a text value whose display starts with = + - or @ gets a leading apostrophe; then RFC 4180 quoting. */
function csvField(display: string, isText: boolean): string {
  const safe = isText && SPREADSHEET_START.test(display) ? `'${display}` : display;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function extent(engine: WorkbookEngine, sheetId: string): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  for (const [cell, stored] of engine.sheetById(sheetId)?.cells ?? []) {
    if (stored.input === "") continue;
    const at = parseCell(cell) as { row: number; col: number };
    rows = Math.max(rows, at.row);
    cols = Math.max(cols, at.col);
  }
  return { rows, cols };
}

/** Rows 1 to the last filled row, columns A to the last filled column, UTF-8 without BOM, CRLF. */
export function sheetCsv(engine: WorkbookEngine, sheetId: string): Buffer {
  const { rows, cols } = extent(engine, sheetId);
  let out = "";
  for (let row = 1; row <= rows; row++) {
    const fields: string[] = [];
    for (let col = 1; col <= cols; col++) {
      const cell = `${String.fromCharCode(64 + col)}${row}`;
      const { value, display } = engine.result(sheetId, cell);
      fields.push(csvField(display, typeof value === "string"));
    }
    out += `${fields.join(",")}\r\n`;
  }
  return Buffer.from(out, "utf8");
}

const BUILTIN: Partial<Record<NumberFormat, number>> = { general: 0, "0": 1, "0.00": 2 };
const CUSTOM: Partial<Record<NumberFormat, { id: number; code: string }>> = {
  date: { id: 164, code: "yyyy-mm-dd" },
  "0.0": { id: 165, code: "0.0" },
  "0.000": { id: 166, code: "0.000" },
  "0.0%": { id: 167, code: "0.0%" },
};
const EXCEL_ERRORS = new Set(["#VALUE!", "#DIV/0!", "#REF!", "#NAME?"]);

// SpreadsheetML (ECMA-376) namespaces and content types, all under one schema root.
const SCHEMA_ROOT = "http://schemas.openxmlformats.org";
const NS = {
  main: `${SCHEMA_ROOT}/spreadsheetml/2006/main`,
  relationships: `${SCHEMA_ROOT}/officeDocument/2006/relationships`,
  packageRelationships: `${SCHEMA_ROOT}/package/2006/relationships`,
  contentTypes: `${SCHEMA_ROOT}/package/2006/content-types`,
};
const PACKAGE_TYPE = "application/vnd.openxmlformats-package";
const OFFICE_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml";

/** One package part: the XML declaration, then the root element with its namespace attributes around the body. */
function xmlPart(root: string, attrs: Record<string, string>, body: string): string {
  const attrText = Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${root}${attrText}>${body}</${root}>`;
}

function numFmtId(f: NumberFormat): number {
  return BUILTIN[f] ?? (CUSTOM[f] as { id: number }).id;
}

/** Every sheet in order: formulas with cached values, text as strings, numbers, dates, bold and number formats. */
export function workbookXlsx(engine: WorkbookEngine): Buffer {
  const styles: CellFormat[] = [{ numberFormat: "general", bold: false }];
  const styleOf = (f: CellFormat): number => {
    let i = styles.findIndex((s) => s.numberFormat === f.numberFormat && s.bold === f.bold);
    if (i < 0) i = styles.push({ ...f }) - 1;
    return i;
  };
  const sheetXml = engine.sheets.map((sheet) => {
    const rows = new Map<number, string[]>();
    const ordered = [...sheet.cells].map(([cell, stored]) => ({ cell, stored, at: parseCell(cell) as { row: number; col: number } }));
    ordered.sort((a, b) => a.at.row - b.at.row || a.at.col - b.at.col);
    for (const { cell, stored, at } of ordered) {
      const s = styleOf(stored.format);
      const sAttr = s ? ` s="${s}"` : "";
      const { value } = engine.result(sheet.id, cell);
      let xml: string;
      if (stored.input === "") xml = `<c r="${cell}"${sAttr}/>`;
      else if (stored.input.startsWith("=")) {
        const f = `<f>${escapeXml(stored.input.slice(1))}</f>`;
        if (isError(value)) {
          xml = EXCEL_ERRORS.has(value.error)
            ? `<c r="${cell}"${sAttr} t="e">${f}<v>${value.error}</v></c>`
            : `<c r="${cell}"${sAttr} t="str">${f}<v>${value.error}</v></c>`;
        } else if (typeof value === "number") xml = `<c r="${cell}"${sAttr}>${f}<v>${value}</v></c>`;
        else if (typeof value === "boolean") xml = `<c r="${cell}"${sAttr} t="b">${f}<v>${value ? 1 : 0}</v></c>`;
        else xml = `<c r="${cell}"${sAttr} t="str">${f}<v>${escapeXml(value ?? "")}</v></c>`;
      } else if (typeof value === "number") xml = `<c r="${cell}"${sAttr}><v>${value}</v></c>`;
      else if (typeof value === "boolean") xml = `<c r="${cell}"${sAttr} t="b"><v>${value ? 1 : 0}</v></c>`;
      else xml = `<c r="${cell}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value ?? ""))}</t></is></c>`;
      const list = rows.get(at.row) ?? [];
      list.push(xml);
      rows.set(at.row, list);
    }
    const body = [...rows].map(([r, cells]) => `<row r="${r}">${cells.join("")}</row>`).join("");
    return xmlPart("worksheet", { xmlns: NS.main }, `<sheetData>${body}</sheetData>`);
  });
  const sheets = engine.sheets;
  const numFmts = Object.values(CUSTOM).map((c) => `<numFmt numFmtId="${c?.id}" formatCode="${c?.code}"/>`).join("");
  const xfs = styles.map((s) => `<xf numFmtId="${numFmtId(s.numberFormat)}" fontId="${s.bold ? 1 : 0}" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>`).join("");
  const override = (part: string, kind: string): string => `<Override PartName="${part}" ContentType="${OFFICE_TYPE}.${kind}+xml"/>`;
  const relationship = (id: number, kind: string, target: string): string => `<Relationship Id="rId${id}" Type="${NS.relationships}/${kind}" Target="${target}"/>`;
  const files = [
    {
      name: "[Content_Types].xml",
      data: xmlPart(
        "Types",
        { xmlns: NS.contentTypes },
        `<Default Extension="rels" ContentType="${PACKAGE_TYPE}.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
          override("/xl/workbook.xml", "sheet.main") +
          override("/xl/styles.xml", "styles") +
          sheets.map((_s, i) => override(`/xl/worksheets/sheet${i + 1}.xml`, "worksheet")).join(""),
      ),
    },
    {
      name: "_rels/.rels",
      data: xmlPart("Relationships", { xmlns: NS.packageRelationships }, relationship(1, "officeDocument", "xl/workbook.xml")),
    },
    {
      name: "xl/workbook.xml",
      data: xmlPart(
        "workbook",
        { xmlns: NS.main, "xmlns:r": NS.relationships },
        `<sheets>${sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: xmlPart(
        "Relationships",
        { xmlns: NS.packageRelationships },
        sheets.map((_s, i) => relationship(i + 1, "worksheet", `worksheets/sheet${i + 1}.xml`)).join("") +
          relationship(sheets.length + 1, "styles", "styles.xml"),
      ),
    },
    {
      name: "xl/styles.xml",
      data: xmlPart(
        "styleSheet",
        { xmlns: NS.main },
        `<numFmts count="${Object.keys(CUSTOM).length}">${numFmts}</numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${styles.length}">${xfs}</cellXfs>`,
      ),
    },
    ...sheetXml.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml })),
  ];
  return writeZip(files.map((f) => ({ name: f.name, data: Buffer.from(f.data, "utf8") })));
}
