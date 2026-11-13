import { PdfWriter } from "./writer.js";
import { array, dict, name, ref } from "./objects.js";
import { escapeText } from "./objects.js";

type SampleName = "letter-1" | "letter-3" | "a4-12";

const SAMPLES: Record<SampleName, { pages: number; width: number; height: number }> = {
  "letter-1": { pages: 1, width: 612, height: 792 },
  "letter-3": { pages: 3, width: 612, height: 792 },
  "a4-12": { pages: 12, width: 595, height: 842 },
};

export function isSampleName(value: string): value is SampleName {
  return value in SAMPLES;
}

const PARAGRAPHS = [
  "This sample agreement is made between Larkspur Mill and Quillon Press.",
  "Supplies for the studio are ordered on the first working day of each month.",
  "Either party may end this arrangement with thirty days of written notice.",
  "Invoices are settled within fourteen days of the date printed on them.",
];

function pageContent(page: number, count: number, width: number, height: number): string {
  const lines: string[] = [];
  lines.push("0.86 0.80 0.70 RG 0.75 w");
  lines.push(`48 ${height - 60} m ${width - 48} ${height - 60} l S`);
  lines.push("0.09 0.13 0.20 rg");
  lines.push(`BT /F1 11 Tf 48 ${height - 46} Td (Wickmoor sample document) Tj ET`);
  lines.push(`BT /F1 34 Tf 48 ${height - 130} Td (${escapeText(`Sample page ${page} of ${count}`)}) Tj ET`);
  PARAGRAPHS.forEach((paragraph, index) => {
    lines.push(`BT /F1 12 Tf 48 ${height - 190 - index * 22} Td (${escapeText(paragraph)}) Tj ET`);
  });
  lines.push(`48 ${height - 420} m ${width - 48} ${height - 420} l S`);
  lines.push(`BT /F1 10 Tf 48 ${height - 436} Td (Signed by) Tj ET`);
  lines.push(`BT /F1 9 Tf ${width / 2 - 20} 28 Td (${page}) Tj ET`);
  return lines.join("\n");
}

export function buildSample(sample: SampleName): Buffer {
  const { pages, width, height } = SAMPLES[sample];
  const writer = new PdfWriter();
  const catalog = writer.allocate();
  const tree = writer.allocate();
  const font = writer.add(dict({ Type: name("Font"), Subtype: name("Type1"), BaseFont: name("Helvetica") }));
  const kids: number[] = [];
  for (let page = 1; page <= pages; page += 1) {
    const content = writer.add({
      kind: "stream",
      dict: dict({}),
      raw: Buffer.from(pageContent(page, pages, width, height), "latin1"),
    });
    kids.push(
      writer.add(
        dict({
          Type: name("Page"),
          Parent: ref(tree),
          MediaBox: array([0, 0, width, height]),
          Resources: dict({ Font: dict({ F1: ref(font) }) }),
          Contents: ref(content),
        }),
      ),
    );
  }
  writer.set(tree, dict({ Type: name("Pages"), Kids: array(kids.map(ref)), Count: pages }));
  writer.set(catalog, dict({ Type: name("Catalog"), Pages: ref(tree) }));
  return writer.build(catalog);
}
