// The e-ticket PDF: a one-page document with extractable text, rendered only from the snapshot taken at its event,
// so the same snapshot always gives the same bytes.
import type { TicketKind } from "../../shared/api.js";
import { formatInr } from "../../shared/format.js";

export interface TicketSnapshot {
  pnr: string;
  version: number;
  kind: TicketKind;
  createdAt: string;
  train: { number: string; name: string };
  runDate: string;
  from: { code: string; name: string };
  to: { code: string; name: string };
  cls: string;
  quota: string;
  totalPaise: number;
  passengers: { number: number; name: string; age: number; label: string }[];
}

const KIND_LABEL: Record<TicketKind, string> = { booked: "as booked", cancellation: "after cancellation", chart: "after chart" };

/** WinAnsi text for the PDF's standard fonts: characters outside Latin-1 (other than ₹) become "?". */
function pdfText(value: string): string {
  return value.replace(/[^\x20-\x7e\xa0-\xff]/g, "?").replace(/([\\()])/g, "\\$1");
}

/** The standard fonts have no ₹, so it is drawn by a one-glyph Type 3 font (/FR, code 1) whose ToUnicode map
 * extracts it as U+20B9, keeping money in the brief's money format. */
const RUPEE_GLYPH = [
  "556 0 0 -20 560 740 d1",
  "64 w 0 J 1 j",
  "70 690 m 490 690 l S",
  "70 530 m 490 530 l S",
  "150 690 m 350 690 410 620 405 545 c 400 460 330 405 120 405 c S",
  "120 405 m 430 0 l S",
].join("\n");

const RUPEE_TO_UNICODE = [
  "/CIDInit /ProcSet findresource begin",
  "12 dict begin",
  "begincmap",
  "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
  "/CMapName /Adobe-Identity-UCS def",
  "/CMapType 2 def",
  "1 begincodespacerange <00> <FF> endcodespacerange",
  "1 beginbfchar <01> <20B9> endbfchar",
  "endcmap",
  "CMapName currentdict /CMap defineresource pop",
  "end",
  "end",
].join("\n");

function streamObject(content: string): string {
  return `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
}

export function renderTicket(t: TicketSnapshot): Buffer {
  const ops: string[] = [];
  const text = (x: number, y: number, size: number, font: "F1" | "F2" | "F3", value: string): void => {
    const runs = value.split("₹").map((part, i) => `${i > 0 ? `/FR ${size} Tf <01> Tj /${font} ${size} Tf ` : ""}(${pdfText(part)}) Tj`);
    ops.push(`BT /${font} ${size} Tf ${x} ${y} Td ${runs.join(" ")} ET`);
  };
  const rule = (y: number, width = 0.8): void => {
    ops.push(`${width} w 48 ${y} m 547 ${y} l S`);
  };
  ops.push("0.14 0.11 0.08 RG 0.14 0.11 0.08 rg");
  text(48, 790, 22, "F2", "Pakka Rail");
  text(48, 770, 10, "F1", `E-ticket v${t.version} (${KIND_LABEL[t.kind]}), issued ${t.createdAt}`);
  rule(758, 1.4);
  text(48, 732, 16, "F3", `PNR ${t.pnr}`);
  text(48, 710, 12, "F2", `${t.train.number} ${t.train.name}`);
  text(48, 692, 11, "F1", `Run date ${t.runDate}`);
  text(48, 674, 11, "F1", `From ${t.from.code} ${t.from.name}   To ${t.to.code} ${t.to.name}`);
  text(48, 656, 11, "F1", `Class ${t.cls}   Quota ${t.quota}`);
  text(48, 638, 11, "F1", `Total fare ${formatInr(t.totalPaise)}`);
  rule(622);
  text(48, 604, 10, "F2", "No.");
  text(88, 604, 10, "F2", "Name");
  text(330, 604, 10, "F2", "Age");
  text(380, 604, 10, "F2", "Status");
  t.passengers.forEach((p, i) => {
    const y = 584 - i * 20;
    text(48, y, 11, "F3", String(p.number));
    text(88, y, 11, "F1", p.name.slice(0, 40));
    text(330, y, 11, "F3", String(p.age));
    text(380, y, 11, "F3", p.label);
  });
  rule(584 - t.passengers.length * 20 + 6);
  text(48, 60, 9, "F1", "Statuses are as recorded when this version was issued. Keep every version as evidence.");

  const stream = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R " +
      "/Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R /FR 8 0 R >> >> >>",
    streamObject(stream),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type3 /FontBBox [0 -20 560 740] /FontMatrix [0.001 0 0 0.001 0 0] " +
      "/CharProcs << /rupee 9 0 R >> /Encoding << /Type /Encoding /Differences [1 /rupee] >> " +
      "/FirstChar 1 /LastChar 1 /Widths [556] /Resources << >> /ToUnicode 10 0 R >>",
    streamObject(RUPEE_GLYPH),
    streamObject(RUPEE_TO_UNICODE),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
