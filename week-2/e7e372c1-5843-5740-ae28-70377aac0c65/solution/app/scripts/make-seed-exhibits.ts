// Writes the four seeded exhibits: one-page, filing-safe PDFs, byte-for-byte reproducible.
// Run once with: node --experimental-strip-types scripts/make-seed-exhibits.ts

import { mkdirSync, writeFileSync } from "node:fs";

interface Exhibit {
  accession: string;
  weekEnding: string;
  monday: string;
  rows: Array<[string, string]>;
  note: string | null;
}

const EXHIBITS: Exhibit[] = [
  {
    accession: "0002093117-26-000041",
    weekEnding: "2026-10-11",
    monday: "2026-10-05",
    note: null,
    rows: [["Beginning ETH balance", "401,250"], ["ETH acquired", "6,120.5"], ["Staking rewards", "412.375"], ["Ending ETH balance", "407,782.875"], ["Cumulative staking rewards", "10,256.625"], ["Assumed diluted shares", "148,250,000"]],
  },
  {
    accession: "0002093117-26-000044",
    weekEnding: "2026-10-18",
    monday: "2026-10-12",
    note: "Share-count event: ATM settlement +2,400,000 effective 2026-10-14.",
    rows: [["Beginning ETH balance", "407,782.875"], ["ETH acquired", "4,980.25"], ["Staking rewards", "408.0625"], ["Ending ETH balance", "413,171.1875"], ["Cumulative staking rewards", "10,664.6875"], ["Assumed diluted shares", "150,650,000"]],
  },
  {
    accession: "0002093117-26-000046",
    weekEnding: "2026-10-18",
    monday: "2026-10-12",
    note: "Correction. Share-count event: ATM settlement +2,400,000 effective 2026-10-14.",
    rows: [["Beginning ETH balance", "407,782.875"], ["ETH acquired", "4,980.25"], ["Staking rewards", "418.0625"], ["Ending ETH balance", "413,181.1875"], ["Cumulative staking rewards", "10,674.6875"], ["Assumed diluted shares", "150,650,000"]],
  },
  {
    accession: "0002093117-26-000049",
    weekEnding: "2026-10-25",
    monday: "2026-10-19",
    note: "Share-count event: Buyback -500,000 effective 2026-10-22.",
    rows: [["Beginning ETH balance", "413,181.1875"], ["ETH acquired", "0"], ["Staking rewards", "421.5"], ["Ending ETH balance", "413,602.6875"], ["Cumulative staking rewards", "11,096.1875"], ["Assumed diluted shares", "150,150,000"]],
  },
];

function text(x: number, y: number, size: number, font: "F1" | "F2", value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  return `BT /${font} ${size} Tf ${x} ${y} Td (${escaped}) Tj ET\n`;
}

function rule(y: number, x1 = 72, x2 = 540, width = 0.5): string {
  return `${width} w ${x1} ${y} m ${x2} ${y} l S\n`;
}

function content(exhibit: Exhibit): string {
  let out = "";
  out += text(72, 720, 18, "F2", "Vellichor Holdings, Inc. (VLCH)");
  out += text(72, 698, 11, "F1", "Weekly holdings restatement - Form 8-K exhibit");
  out += text(72, 676, 11, "F1", `Accession ${exhibit.accession}   Page 1`);
  out += text(72, 660, 11, "F1", `Week ending ${exhibit.weekEnding} (Monday ${exhibit.monday} to Sunday ${exhibit.weekEnding})`);
  out += rule(646, 72, 540, 1.2);
  out += text(72, 630, 10, "F2", "Row");
  out += text(440, 630, 10, "F2", "Amount");
  out += rule(622);
  let y = 604;
  for (const [label, amount] of exhibit.rows) {
    out += text(72, y, 12, "F1", label);
    out += text(540 - amount.length * 6.7, y, 12, "F1", amount);
    out += rule(y - 8);
    y -= 28;
  }
  if (exhibit.note) out += text(72, y - 6, 10, "F1", exhibit.note);
  out += text(72, 72, 8, "F1", "Invented for the Tracewell rehearsal. Every person, filing, accession number and amount is fictional.");
  return out;
}

function build(exhibit: Exhibit): Buffer {
  const stream = content(exhibit);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

mkdirSync(new URL("../seed/exhibits/", import.meta.url), { recursive: true });
for (const exhibit of EXHIBITS) {
  writeFileSync(new URL(`../seed/exhibits/${exhibit.accession}.pdf`, import.meta.url), build(exhibit));
}
