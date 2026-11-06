// Seed exhibit PDFs: minimal one-page filing-safe PDFs generated in-process,
// showing the week's six-row table under the accession number. No forbidden
// names appear anywhere in these bytes.

import type { RowKey } from "./types.js";
import { ROW_LABELS } from "./types.js";

export interface ExhibitSpec {
  accession: string;
  weekEnding: string;
  rows: Record<RowKey, string>;
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Builds a small, valid, filing-safe PDF for the given exhibit. */
export function buildSeedExhibitPdf(spec: ExhibitSpec): Buffer {
  const lines: { y: number; font: number; size: number; text: string }[] = [];
  const top = 700;
  lines.push({ y: top, font: 1, size: 16, text: `Vellichor Holdings, Inc. — Nasdaq: VLCH` });
  lines.push({ y: top - 24, font: 1, size: 12, text: `Weekly Holdings Restatement — Exhibit 99.1` });
  lines.push({ y: top - 44, font: 2, size: 11, text: `Accession ${spec.accession}` });
  lines.push({ y: top - 60, font: 2, size: 11, text: `Week ending ${spec.weekEnding}` });

  let y = top - 100;
  lines.push({ y, font: 1, size: 11, text: `Weekly holdings of the ETH treasury` });
  y -= 26;
  for (const key of Object.keys(ROW_LABELS) as RowKey[]) {
    lines.push({ y, font: 2, size: 11, text: `${ROW_LABELS[key]}: ${spec.rows[key]}` });
    y -= 18;
  }
  y -= 14;
  lines.push({ y, font: 2, size: 9, text: `Signed on behalf of Vellichor Holdings, Inc.` });

  const contentParts: string[] = ["BT"];
  for (const line of lines) {
    const resource = line.font === 1 ? "/F1" : "/F2";
    contentParts.push(`${resource} ${line.size} Tf`);
    contentParts.push(`1 0 0 1 72 ${line.y} Tm`);
    contentParts.push(`(${escapePdfText(line.text)}) Tj`);
  }
  contentParts.push("ET");
  const content = contentParts.join("\n");

  const objects: string[] = [];
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`);
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`);
  objects.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
