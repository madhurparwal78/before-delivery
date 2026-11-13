export interface SampleSpec {
  id: "letter-1" | "letter-3" | "a4-12";
  pages: number;
  width: number;  // points
  height: number; // points
}

export const SAMPLES: SampleSpec[] = [
  { id: "letter-1", pages: 1, width: 612, height: 792 },
  { id: "letter-3", pages: 3, width: 612, height: 792 },
  { id: "a4-12", pages: 12, width: 595.28, height: 841.89 },
];

/** Builds one of the three invented sample PDFs (uncompressed content streams). */
export function buildSample(spec: SampleSpec): Buffer {
  const objects: string[] = [];
  const pageObjIds: number[] = [];
  // 1: catalog, 2: pages tree, 3: font, then per page: page obj + content obj
  const firstPage = 4;
  for (let p = 0; p < spec.pages; p++) {
    pageObjIds.push(firstPage + p * 2);
  }
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Count ${spec.pages} /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  for (let p = 0; p < spec.pages; p++) {
    const pageId = firstPage + p * 2;
    const contentId = pageId + 1;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${spec.width} ${spec.height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    const n = p + 1;
    const cx = spec.width / 2;
    const line = `Sample page ${n} of ${spec.pages}`;
    const content = [
      "BT",
      "/F1 36 Tf",
      `1 0 0 1 ${cx - 180} ${spec.height - 120} Tm`,
      `(${escapePdfText(line)}) Tj`,
      "ET",
    ].join("\n");
    objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  }
  return assemblePdf(objects, spec.pages + 1 === pageObjIds.length ? pageObjIds[pageObjIds.length - 1] + 1 : firstPage + spec.pages * 2);
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function assemblePdf(objects: string[], maxId: number): Buffer {
  const parts: string[] = [];
  parts.push("%PDF-1.4\n");
  const offsets: number[] = [];
  let pos = parts[0].length;
  for (let id = 1; id < objects.length; id++) {
    if (!objects[id]) continue;
    const body = `${id} 0 obj\n${objects[id]}\nendobj\n`;
    offsets[id] = pos;
    parts.push(body);
    pos += body.length;
  }
  const startxref = pos;
  let xref = `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id++) {
    const off = offsets[id] ?? 0;
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  parts.push(xref);
  parts.push(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);
  return Buffer.from(parts.join(""), "latin1");
}

export function sampleBytes(id: string): Buffer | null {
  const spec = SAMPLES.find((s) => s.id === id);
  if (!spec) return null;
  return buildSample(spec);
}
