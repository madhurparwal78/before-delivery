/** Minimal in-process PDF writer: one A3 landscape page of vector paths and text. */
export interface PdfPoint {
  x: number;
  y: number;
}

export interface PdfPath {
  points: Array<[number, number]>;
  closed: boolean;
  width: number;
  grey: string;
}

export interface PdfText {
  x: number;
  y: number;
  text: string;
  size: number;
  grey: string;
}

export interface PdfPage {
  width: number;
  height: number;
  paths: PdfPath[];
  texts: PdfText[];
}

export interface PlotScale {
  /** millimetres of model per point of page */
  scale: number;
  originX: number;
  originY: number;
}

export function greyFor(colour: string, plotStyle: string): string {
  if (plotStyle === "Monochrome") return "0 0 0";
  if (plotStyle === "Grayscale") {
    const map: Record<string, string> = {
      Red: "0.5 0.1 0.1",
      Yellow: "0.4 0.4 0.1",
      Green: "0.1 0.5 0.1",
      Cyan: "0.1 0.4 0.4",
      Blue: "0.1 0.1 0.5",
      Magenta: "0.4 0.1 0.4",
      White: "0 0 0",
    };
    return map[colour] ?? "0 0 0";
  }
  const map: Record<string, string> = {
    Red: "0.8 0.15 0.15",
    Yellow: "0.75 0.65 0.1",
    Green: "0.2 0.6 0.2",
    Cyan: "0.15 0.55 0.6",
    Blue: "0.2 0.3 0.7",
    Magenta: "0.6 0.2 0.6",
    White: "0 0 0",
  };
  return map[colour] ?? "0 0 0";
}

function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/** Helvetica metrics: approximate widths in 1/1000 em for the glyphs we emit. */
function textWidth(text: string, size: number): number {
  let units = 0;
  for (const ch of text) {
    if (ch === " ") units += 278;
    else if (ch === "." || ch === ",") units += 278;
    else if (ch === ":") units += 278;
    else if (ch === "-") units += 333;
    else if (ch >= "0" && ch <= "9") units += 556;
    else if (ch >= "A" && ch <= "Z") units += 667;
    else if (ch >= "a" && ch <= "z") units += 556;
    else if (ch === "/") units += 278;
    else if (ch === "°") units += 400;
    else units += 556;
  }
  return (units / 1000) * size;
}

export function buildPdf(page: PdfPage): Uint8Array {
  const objects: string[] = [];
  // Catalog, Pages, Page, Contents, Font, plus the Font descriptor pieces.
  const content: string[] = [];
  content.push("1 0 0 1 0 0 cm");
  for (const path of page.paths) {
    if (path.points.length === 0) continue;
    const [sx, sy] = path.points[0];
    content.push(`${path.grey} RG ${path.width} w ${sx.toFixed(2)} ${sy.toFixed(2)} m`);
    for (let i = 1; i < path.points.length; i++) {
      const [x, y] = path.points[i];
      content.push(`${x.toFixed(2)} ${y.toFixed(2)} l`);
    }
    if (path.closed) content.push("h");
    content.push("S");
  }
  for (const t of page.texts) {
    content.push(`BT /F1 ${t.size.toFixed(2)} Tf ${t.grey} rg 1 0 0 1 ${t.x.toFixed(2)} ${t.y.toFixed(2)} Tm (${escapeText(t.text)}) Tj ET`);
  }
  const stream = content.join("\n");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objects[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width.toFixed(2)} ${page.height.toFixed(2)}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`;
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[5] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  const encoder = new TextEncoder();
  let position = encoder.encode("%PDF-1.4\n").length;
  for (let i = 1; i <= 5; i++) {
    offsets[i] = position;
    const chunk = `${i} 0 obj\n${objects[i]}\nendobj\n`;
    pdf += chunk;
    position += encoder.encode(chunk).length;
  }
  const xrefStart = position;
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return encoder.encode(pdf);
}

export function textWidthOf(text: string, size: number): number {
  return textWidth(text, size);
}
