// A small PDF writer: A4 pages, the standard 14 fonts with one shared encoding (WinAnsi plus the te reo
// Māori macron vowels) and a ToUnicode map so text extracts as written. Output is deterministic.
import { deflateSync } from "node:zlib";

type FontName = "sans" | "sansBold" | "mono" | "serif";
export type Rgb = readonly [number, number, number];

const FONTS: Record<FontName, { resource: string; base: string }> = {
  sans: { resource: "F1", base: "Helvetica" },
  sansBold: { resource: "F2", base: "Helvetica-Bold" },
  mono: { resource: "F3", base: "Courier" },
  serif: { resource: "F4", base: "Times-Roman" },
};

/** Characters above ASCII the encoding carries: byte code → [unicode, glyph name]. */
const EXTRA: [number, string, string][] = [
  [0x80, "Ō", "Omacron"],
  [0x81, "ō", "omacron"],
  [0x8d, "ā", "amacron"],
  [0x8f, "ē", "emacron"],
  [0x90, "ū", "umacron"],
  [0x9d, "ī", "imacron"],
  [0x96, "–", "endash"],
  [0x97, "—", "emdash"],
  [0x92, "’", "quoteright"],
  [0xb0, "°", "degree"],
  [0xb7, "·", "periodcentered"],
  [0xd7, "×", "multiply"],
  [0xe9, "é", "eacute"],
];

const TO_BYTE = new Map<string, number>(EXTRA.map(([code, char]) => [char, code]));

function encodeText(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    const byte = code >= 0x20 && code <= 0x7e ? code : (TO_BYTE.get(char) ?? 0x3f);
    const ch = String.fromCharCode(byte);
    out += ch === "(" || ch === ")" || ch === "\\" ? `\\${ch}` : ch;
  }
  return out;
}

const n = (value: number) => (Math.round(value * 100) / 100).toString();
const colour = ([r, g, b]: Rgb) => `${n(r / 255)} ${n(g / 255)} ${n(b / 255)}`;

export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;

/** Width of `text` in the monospaced face (Courier advances are 600/1000 em). */
function monoWidth(text: string, size: number): number {
  return [...text].length * size * 0.6;
}

export class Page {
  private readonly ops: string[] = [];

  text(x: number, y: number, text: string, options: { font?: FontName; size?: number; color?: Rgb } = {}): this {
    const font = FONTS[options.font ?? "sans"];
    this.ops.push(
      `BT /${font.resource} ${n(options.size ?? 10)} Tf ${colour(options.color ?? [20, 24, 33])} rg ${n(x)} ${n(y)} Td (${encodeText(text)}) Tj ET`,
    );
    return this;
  }

  /** Monospaced text ending at `right`, so figures line up on their decimal points. */
  textRight(right: number, y: number, text: string, options: { size?: number; color?: Rgb } = {}): this {
    const size = options.size ?? 10;
    return this.text(right - monoWidth(text, size), y, text, { ...options, font: "mono", size });
  }

  line(x1: number, y1: number, x2: number, y2: number, options: { width?: number; color?: Rgb } = {}): this {
    this.ops.push(
      `${colour(options.color ?? [201, 194, 180])} RG ${n(options.width ?? 0.5)} w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`,
    );
    return this;
  }

  polygon(points: [number, number][], fill: Rgb): this {
    const [first, ...rest] = points;
    if (!first) return this;
    this.ops.push(
      `${colour(fill)} rg ${n(first[0])} ${n(first[1])} m ${rest.map(([x, y]) => `${n(x)} ${n(y)} l`).join(" ")} h f`,
    );
    return this;
  }

  rect(x: number, y: number, width: number, height: number, fill: Rgb): this {
    this.ops.push(`${colour(fill)} rg ${n(x)} ${n(y)} ${n(width)} ${n(height)} re f`);
    return this;
  }

  content(): string {
    return this.ops.join("\n");
  }
}

function toUnicodeCMap(): string {
  const entries: string[] = [];
  for (let code = 0x20; code <= 0x7e; code++) {
    entries.push(`<${code.toString(16).padStart(2, "0")}> <${code.toString(16).padStart(4, "0")}>`);
  }
  for (const [code, char] of EXTRA) {
    entries.push(`<${code.toString(16)}> <${char.charCodeAt(0).toString(16).padStart(4, "0")}>`);
  }
  const blocks: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    blocks.push(`${chunk.length} beginbfchar\n${chunk.join("\n")}\nendbfchar`);
  }
  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Lightfall-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange <00> <ff> endcodespacerange",
    ...blocks,
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
}

export function renderPdf(pages: Page[], title: string): Buffer {
  const objects: Buffer[] = [];
  const add = (body: string | Buffer) => {
    objects.push(typeof body === "string" ? Buffer.from(body, "latin1") : body);
    return objects.length;
  };
  const stream = (dictionary: string, data: string) => {
    const packed = deflateSync(Buffer.from(data, "latin1"));
    return Buffer.concat([
      Buffer.from(`<< ${dictionary} /Length ${packed.length} /Filter /FlateDecode >>\nstream\n`, "latin1"),
      packed,
      Buffer.from("\r\nendstream", "latin1"),
    ]);
  };

  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesId = add("PLACEHOLDER");
  const encoding = add(
    `<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [${EXTRA.map(([code, , glyph]) => `${code} /${glyph}`).join(" ")}] >>`,
  );
  const cmap = add(stream("", toUnicodeCMap()));
  const fontIds = Object.values(FONTS).map((font) =>
    [font.resource, add(`<< /Type /Font /Subtype /Type1 /BaseFont /${font.base} /Encoding ${encoding} 0 R /ToUnicode ${cmap} 0 R >>`)] as const,
  );
  const resources = `<< /Font << ${fontIds.map(([name, id]) => `/${name} ${id} 0 R`).join(" ")} >> >>`;
  const pageIds = pages.map((page) => {
    const contents = add(stream("", page.content()));
    return add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources ${resources} /Contents ${contents} 0 R >>`,
    );
  });
  objects[pagesId - 1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
    "latin1",
  );
  const info = add(`<< /Title (${encodeText(title)}) /Producer (Lightfall) >>`);

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let offset = chunks[0]!.length;
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(offset);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    chunks.push(chunk);
    offset += chunk.length;
  });
  const xref = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((value) => `${String(value).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>`,
    "startxref",
    String(offset),
    "%%EOF",
  ].join("\n");
  chunks.push(Buffer.from(`${xref}\n`, "latin1"));
  return Buffer.concat(chunks);
}
