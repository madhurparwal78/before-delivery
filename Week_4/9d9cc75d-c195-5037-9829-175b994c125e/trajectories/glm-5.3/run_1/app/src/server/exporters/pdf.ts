import { PDFDocument, StandardFonts } from "pdf-lib";
import type { SerializedView } from "../routes/exports.js";
import { displayNumber } from "../../shared/display.js";
import { formatCell } from "./format.js";

export interface PdfSheet {
  name: string;
  view: SerializedView;
  shape: { rows: unknown[]; columns: unknown[] };
}

/**
 * The PDF export: real text, line by line. 1. the name; 2. one line per
 * filter; 3. for each sheet its name, then its twin's header and rows.
 */
export async function renderPdf(sheets: PdfSheet[], targetName: string, filtersText: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let page = doc.addPage([595.28, 841.89]);
  const size = 11;
  const lineHeight = 16;
  let y = 800;
  const lines: string[] = [targetName, ...filtersText];
  for (const s of sheets) {
    lines.push(s.name);
    lines.push(...twinLines(s));
  }
  for (const line of lines) {
    page.drawText(line, { x: 48, y, size, font });
    y -= lineHeight;
    if (y < 40) {
      page = doc.addPage([595.28, 841.89]);
      y = 800;
    }
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/** The twin's header and rows, one row per line with cells joined by ' | '. */
export function twinLines(s: PdfSheet): string[] {
  const v = s.view;
  const header = [...v.dims.map((d) => d.field), ...v.measures.map((m) => m.caption)].join(" | ");
  const lines: string[] = [header];
  for (const m of v.marks) {
    const cells = [
      ...m.dimValues.map((d, i) => formatCell(v.dims[i]?.type ?? "text", d)),
      ...m.values.map((val, i) => (v.measures[i]?.share ? formatShare(val) : formatNum(val))),
    ];
    lines.push(cells.join(" | "));
  }
  if (v.total.length > 0) {
    const cells = [
      "Grand total",
      ...v.total.map((t, i) => (v.measures[i]?.share ? "n/a" : formatNum(t))),
    ];
    lines.push(cells.join(" | "));
  }
  return lines;
}

function formatNum(v: number | null): string {
  if (v === null) return "(null)";
  if (Number.isNaN(v)) return "n/a";
  return displayNumber(v);
}

function formatShare(v: number | null): string {
  if (v === null) return "(null)";
  if (Number.isNaN(v)) return "n/a";
  const pct = Math.round(v * 100 * 10) / 10;
  return `${pct}%`;
}
