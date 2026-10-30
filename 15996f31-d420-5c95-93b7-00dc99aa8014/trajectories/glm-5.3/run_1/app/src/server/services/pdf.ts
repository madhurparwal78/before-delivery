/**
 * A minimal, dependency-free PDF writer for the signed inspection report. It
 * lays out plain text lines across as many pages as needed, using the standard
 * PDF base-14 fonts with WinAnsi encoding.
 */

interface Line {
  text: string;
  size: number;
  font: "serif" | "sans" | "mono";
  leading: number;
}

export interface ReportBlock {
  name: string;
  samples: readonly { colony_label: string; frames_text: string }[];
  average_text: string | null;
  tier_label: string;
  payable_text: string;
}

function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function buildReportPdf(input: {
  orchardName: string;
  county: string;
  ref: string;
  blocks: readonly ReportBlock[];
  payableText: string;
  inspectorName: string;
  signedAtText: string;
}): Buffer {
  const lines: Line[] = [
    { text: `Inspection report - ${input.orchardName} - ${input.ref}`, size: 16, font: "serif", leading: 26 },
    { text: `${input.county} County - Swarmline Bloom Desk`, size: 10, font: "sans", leading: 18 },
    { text: "", size: 10, font: "sans", leading: 12 },
  ];
  for (const block of input.blocks) {
    lines.push({ text: `${block.name} - ${block.tier_label} - ${block.average_text ?? "no samples"} frames`, size: 13, font: "serif", leading: 24 });
    for (const sample of block.samples) {
      lines.push({ text: `  Colony ${sample.colony_label}: ${sample.frames_text} frames of bees`, size: 10, font: "mono", leading: 15 });
    }
    if (block.samples.length === 0) {
      lines.push({ text: "  No samples recorded", size: 10, font: "mono", leading: 15 });
    }
    lines.push({ text: `  Average: ${block.average_text ?? "-"} frames - Tier: ${block.tier_label} - Payable: ${block.payable_text}`, size: 10, font: "sans", leading: 18 });
    lines.push({ text: "", size: 10, font: "sans", leading: 10 });
  }
  lines.push({ text: `Orchard payable: ${input.payableText}`, size: 13, font: "serif", leading: 24 });
  lines.push({ text: `Inspector: ${input.inspectorName}`, size: 10, font: "sans", leading: 16 });
  lines.push({ text: `Signed ${input.signedAtText} Pacific`, size: 10, font: "sans", leading: 16 });

  const top = 720;
  const bottom = 72;
  const pages: Line[][] = [];
  let current: Line[] = [];
  let y = top;
  for (const line of lines) {
    if (current.length > 0 && y - line.leading < bottom) {
      pages.push(current);
      current = [];
      y = top;
    }
    current.push(line);
    y -= line.leading;
  }
  if (current.length > 0) pages.push(current);

  const contentIds: number[] = [];
  const pageIds: number[] = [];
  let nextId = 3;
  for (const _ of pages) {
    contentIds.push(nextId);
    pageIds.push(nextId + 1);
    nextId += 2;
  }
  const serifId = nextId;
  const sansId = nextId + 1;
  const monoId = nextId + 2;

  const parts: Buffer[] = [];
  let offset = 0;
  const push = (data: string | Buffer) => {
    const buffer = typeof data === "string" ? Buffer.from(data, "latin1") : data;
    parts.push(buffer);
    offset += buffer.length;
  };
  const offsets: number[] = [];
  push("%PDF-1.4\n");
  const addAtOffset = (id: number, body: string | Buffer): void => {
    offsets[id - 1] = offset;
    push(`${id} 0 obj\n`);
    push(body);
    push("\nendobj\n");
  };

  addAtOffset(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addAtOffset(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);

  pages.forEach((pageLines, index) => {
    let cursor = top;
    const commands: string[] = [];
    for (const line of pageLines) {
      const fontId = line.font === "serif" ? serifId : line.font === "mono" ? monoId : sansId;
      commands.push(`BT /F${fontId} ${line.size} Tf 72 ${cursor - line.size} Td (${escapeText(line.text)}) Tj ET`);
      cursor -= line.leading;
    }
    const content = Buffer.from(commands.join("\n"), "latin1");
    const contentId = contentIds[index]!;
    const pageId = pageIds[index]!;
    offsets[contentId - 1] = offset;
    push(`${contentId} 0 obj\n<< /Length ${content.length} >>\nstream\n`);
    push(content);
    push("\nendstream\nendobj\n");
    offsets[pageId - 1] = offset;
    push(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F${serifId} ${serifId} 0 R /F${sansId} ${sansId} 0 R /F${monoId} ${monoId} 0 R >> >> >>\nendobj\n`);
  });

  const fontObject = (name: string) =>
    `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
  addAtOffset(serifId, fontObject("Times-Roman"));
  addAtOffset(sansId, fontObject("Helvetica"));
  addAtOffset(monoId, fontObject("Courier"));

  const total = monoId + 1;
  const xrefOffset = offset;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let id = 1; id < total; id += 1) {
    xref += `${(offsets[id - 1] ?? 0).toString().padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(parts);
}
