import type { SerializedView } from "../routes/exports.js";
import { displayNumber } from "../../shared/display.js";
import { twinLines } from "./pdf.js";

export interface CsvSheet {
  name: string;
  view: SerializedView;
  shape: unknown;
}

/**
 * The crosstab export: UTF-8 without a byte order mark, with CRLF line ends.
 * The header is followed by the rows exactly as the twin shows them, with
 * display numbers written without thousands separators. A text cell that
 * looks like a formula is neutralised with a leading apostrophe.
 */
export function renderCrosstab(sheets: CsvSheet[], targetName: string): Buffer {
  const blocks: string[] = [];
  for (const s of sheets) {
    const lines = [s.name, ...twinLines({ name: s.name, view: s.view, shape: s.shape as never })];
    blocks.push(lines.map((l) => csvLine(l)).join("\r\n"));
  }
  const body = blocks.join("\r\n\r\n") + "\r\n";
  return Buffer.from(body, "utf8");
}

function csvLine(line: string): string {
  return line
    .split(" | ")
    .map((cell) => csvCell(cell))
    .join(",");
}

function csvCell(cell: string): string {
  // Display numbers are written without thousands separators.
  const stripped = cell.replace(/,/g, "");
  if (isNumeric(stripped) && cell !== "" && !cell.startsWith("=") && !cell.startsWith("+") && !cell.startsWith("-") && !cell.startsWith("@")) {
    return stripped;
  }
  // A text cell beginning with =, +, -, @, a tab or a carriage return gets a
  // leading apostrophe.
  let out = cell;
  if (cell.startsWith("=") || cell.startsWith("+") || cell.startsWith("-") || cell.startsWith("@") || cell.startsWith("\t") || cell.startsWith("\r")) {
    if (!isNumeric(cell)) out = `'${cell}`;
  }
  if (out.includes(",") || out.includes('"') || out.includes("\r") || out.includes("\n")) {
    return `"${out.replace(/"/g, '""')}"`;
  }
  return out;
}

function isNumeric(s: string): boolean {
  if (s === "" || s === "(null)" || s === "n/a") return false;
  return /^-?\d+(\.\d+)?$/.test(s.replace(/,/g, ""));
}

export { displayNumber };
