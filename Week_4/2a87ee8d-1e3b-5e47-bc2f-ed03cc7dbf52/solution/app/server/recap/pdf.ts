// A minimal PDF writer: subsetted TrueType fonts (Type0 / Identity-H) with ToUnicode CMaps, FlateDecode streams,
// text shown with Tj, and only Title and Author in the document information.
import zlib from "node:zlib";
import type { Glyph } from "fontkit";
import { face, glyphs, type Face } from "./fonts.js";

interface FontUse {
  face: Face;
  resource: string;
  /** original glyph id → subset glyph id */
  ids: Map<number, number>;
  glyphs: Map<number, Glyph>;
  /** subset glyph id → character, width */
  chars: Map<number, { text: string; width: number }>;
}

export type Rgb = [number, number, number];

function hex(color: Rgb): string {
  return color.map((c) => (c / 255).toFixed(3)).join(" ");
}

function utf16(text: string): string {
  return `<FEFF${Buffer.from(text, "utf16le").swap16().toString("hex").toUpperCase()}>`;
}

export class PdfDocument {
  readonly width: number;
  readonly height: number;
  private pages: string[] = [];
  private current: string[] = [];
  private fonts = new Map<Face, FontUse>();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  addPage(): void {
    if (this.current.length) this.pages.push(this.current.join("\n"));
    this.current = [];
  }

  private use(name: Face): FontUse {
    let use = this.fonts.get(name);
    if (!use) {
      use = { face: name, resource: `F${this.fonts.size + 1}`, ids: new Map(), glyphs: new Map(), chars: new Map() };
      this.fonts.set(name, use);
    }
    return use;
  }

  /** Text with its baseline at (x, y) measured from the top-left of the page. */
  text(value: string, x: number, y: number, size: number, name: Face, color: Rgb): void {
    const use = this.use(name);
    const { font } = face(name);
    const scale = 1000 / font.unitsPerEm;
    const chars = [...value];
    const codes = glyphs(name, value).map((g, i) => {
      let id = use.ids.get(g.id);
      if (id === undefined) {
        id = use.ids.size + 1;
        use.ids.set(g.id, id);
        use.glyphs.set(g.id, g);
        use.chars.set(id, { text: chars[i] ?? "", width: Math.round(g.advanceWidth * scale) });
      }
      return id.toString(16).padStart(4, "0");
    });
    this.current.push(`BT ${hex(color)} rg /${use.resource} ${size} Tf ${x.toFixed(2)} ${(this.height - y).toFixed(2)} Td <${codes.join("")}> Tj ET`);
  }

  rect(x: number, y: number, w: number, h: number, fill: Rgb | null, stroke: Rgb | null, lineWidth = 1): void {
    const box = `${x.toFixed(2)} ${(this.height - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`;
    const paint = fill && stroke ? "B" : fill ? "f" : "S";
    this.current.push(`${fill ? `${hex(fill)} rg ` : ""}${stroke ? `${hex(stroke)} RG ${lineWidth} w ` : ""}${box} ${paint}`);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Rgb, lineWidth = 0.75): void {
    this.current.push(`${hex(color)} RG ${lineWidth} w ${x1.toFixed(2)} ${(this.height - y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.height - y2).toFixed(2)} l S`);
  }

  render(info: { title: string; author: string }): Buffer {
    this.addPage();
    const objects: (string | Buffer)[] = [];
    const add = (body: string | Buffer) => {
      objects.push(body);
      return objects.length;
    };
    const stream = (dict: string, data: Buffer) => {
      const packed = zlib.deflateSync(data);
      return Buffer.concat([Buffer.from(`<< ${dict} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`, "latin1"), packed, Buffer.from("\nendstream", "latin1")]);
    };
    const catalog = add("");
    const pagesId = add("");
    const fontRefs: string[] = [];
    for (const use of this.fonts.values()) {
      const { font } = face(use.face);
      const subset = font.createSubset();
      const order = [...use.ids.entries()].sort((a, b) => a[1] - b[1]);
      for (const [original] of order) {
        const glyph = use.glyphs.get(original);
        if (glyph) subset.includeGlyph(glyph);
      }
      const program = Buffer.from(subset.encode());
      const scale = 1000 / font.unitsPerEm;
      const tag = `LFRSB${String.fromCharCode(64 + Number(use.resource.slice(1)))}`;
      const baseName = `${tag}+${font.postscriptName.replace(/[^A-Za-z0-9-]/g, "")}`;
      const fileId = add(stream(`/Length1 ${program.length}`, program));
      const descriptor = add(
        `<< /Type /FontDescriptor /FontName /${baseName} /Flags 32 /FontBBox [${[font.bbox.minX, font.bbox.minY, font.bbox.maxX, font.bbox.maxY].map((v) => Math.round(v * scale)).join(" ")}] ` +
          `/ItalicAngle ${font.italicAngle} /Ascent ${Math.round(font.ascent * scale)} /Descent ${Math.round(font.descent * scale)} /CapHeight ${Math.round(font.capHeight * scale)} /StemV 80 /FontFile2 ${fileId} 0 R >>`,
      );
      const widths = order.map(([, id]) => `${id} [${use.chars.get(id)?.width ?? 0}]`).join(" ");
      const cid = add(
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${baseName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
          `/FontDescriptor ${descriptor} 0 R /DW 0 /W [${widths}] /CIDToGIDMap /Identity >>`,
      );
      const entries = order.map(([, id]) => `<${id.toString(16).padStart(4, "0")}> ${utf16(use.chars.get(id)?.text ?? "").replace("<FEFF", "<")}`);
      const cmap = [
        "/CIDInit /ProcSet findresource begin 12 dict begin begincmap",
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def",
        "1 begincodespacerange <0000> <FFFF> endcodespacerange",
        ...Array.from({ length: Math.ceil(entries.length / 100) }, (_, i) => {
          const block = entries.slice(i * 100, i * 100 + 100);
          return `${block.length} beginbfchar\n${block.join("\n")}\nendbfchar`;
        }),
        "endcmap CMapName currentdict /CMap defineresource pop end end",
      ].join("\n");
      const toUnicode = add(stream("", Buffer.from(cmap, "latin1")));
      const type0 = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${baseName} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUnicode} 0 R >>`);
      fontRefs.push(`/${use.resource} ${type0} 0 R`);
    }
    const pageIds: number[] = [];
    for (const content of this.pages) {
      const contentId = add(stream("", Buffer.from(content, "latin1")));
      pageIds.push(
        add(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] ` +
            `/Resources << /Font << ${fontRefs.join(" ")} >> >> /Contents ${contentId} 0 R >>`,
        ),
      );
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    const infoId = add(`<< /Title ${utf16(info.title)} /Author ${utf16(info.author)} >>`);
    const parts: Buffer[] = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
    const offsets: number[] = [];
    let length = parts[0]?.length ?? 0;
    objects.forEach((body, i) => {
      offsets.push(length);
      const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"), Buffer.from("\nendobj\n", "latin1")]);
      parts.push(chunk);
      length += chunk.length;
    });
    const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
    parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${infoId} 0 R >>\nstartxref\n${length}\n%%EOF\n`, "latin1"));
    return Buffer.concat(parts);
  }
}
