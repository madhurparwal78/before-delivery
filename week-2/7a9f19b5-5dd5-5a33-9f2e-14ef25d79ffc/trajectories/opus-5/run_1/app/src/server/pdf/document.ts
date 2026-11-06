/**
 * A small PDF writer. Text is drawn with the site's own OFL faces embedded as
 * Type0/Identity-H CIDFontType2 fonts, so names such as "Totara Track Spot" keep
 * their macrons and spec numerals stay monospaced.
 *
 * The shipped faces are split into `latin` and `latin-ext` subsets, so a string is
 * drawn as runs: each run uses the first subset of its family that has the glyph.
 */

import { join } from "node:path";
import { FONT_DIR } from "../paths.js";
import { loadFont, type TrueTypeFont } from "./truetype.js";

export type FontFamily = "display" | "body" | "bodyStrong" | "mono";

interface LoadedFace {
  /** PDF resource name, such as `F0`. */
  resource: string;
  font: TrueTypeFont;
  postScriptName: string;
  /** Glyphs actually used, mapped back to their code point for the ToUnicode CMap. */
  used: Map<number, number>;
}

/** Each family is a run of subsets tried in order. */
const FAMILY_FILES: Record<FontFamily, readonly string[]> = {
  display: ["instrument-serif-latin-400-normal.woff", "instrument-serif-latin-ext-400-normal.woff"],
  body: ["inter-tight-latin-400-normal.woff", "inter-tight-latin-ext-400-normal.woff"],
  bodyStrong: ["inter-tight-latin-600-normal.woff", "inter-tight-latin-ext-600-normal.woff"],
  mono: ["jetbrains-mono-latin-400-normal.woff", "jetbrains-mono-latin-ext-400-normal.woff"],
};

const faceCache = new Map<string, TrueTypeFont>();

function face(file: string): TrueTypeFont {
  const cached = faceCache.get(file);
  if (cached) return cached;
  const loaded = loadFont(join(FONT_DIR, file));
  faceCache.set(file, loaded);
  return loaded;
}

export const PAGE = { width: 595.28, height: 841.89, margin: 48 } as const;

const utf16BeHex = (codePoint: number): string =>
  Array.from(String.fromCodePoint(codePoint), (unit) => unit.charCodeAt(0).toString(16).padStart(4, "0")).join("");

/** Lets readers recover the original text from Identity-H glyph indices. */
function buildToUnicodeCMap(used: ReadonlyMap<number, number>): string {
  const entries = [...used.entries()].sort((a, b) => a[0] - b[0]);
  const blocks: string[] = [];
  for (let start = 0; start < entries.length; start += 100) {
    const chunk = entries.slice(start, start + 100);
    const lines = chunk
      .map(([glyph, codePoint]) => `<${glyph.toString(16).padStart(4, "0")}> <${utf16BeHex(codePoint)}>`)
      .join("\n");
    blocks.push(`${chunk.length} beginbfchar\n${lines}\nendbfchar`);
  }
  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
    ...blocks,
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
}

interface TextRun {
  face: LoadedFace;
  glyphs: number[];
  widthEm: number;
}

export class PdfDocument {
  private readonly faces = new Map<string, LoadedFace>();
  private readonly pages: string[] = [];
  private current: string[] = [];

  constructor() {
    this.pages.push("");
    this.current = [];
  }

  private faceFor(family: FontFamily, codePoint: number): LoadedFace | null {
    for (const file of FAMILY_FILES[family]) {
      const font = face(file);
      if (!font.cmap.has(codePoint)) continue;
      return this.registerFace(file, font);
    }
    return null;
  }

  private registerFace(file: string, font: TrueTypeFont): LoadedFace {
    const existing = this.faces.get(file);
    if (existing) return existing;
    const loaded: LoadedFace = {
      resource: `F${this.faces.size}`,
      font,
      postScriptName: file.replace(/\.woff$/, "").replace(/[^A-Za-z0-9]/g, ""),
      used: new Map<number, number>(),
    };
    this.faces.set(file, loaded);
    return loaded;
  }

  /** Splits a string into runs that each have a face carrying every glyph. */
  private runsFor(text: string, family: FontFamily): TextRun[] {
    const runs: TextRun[] = [];
    for (const character of text) {
      const codePoint = character.codePointAt(0) ?? 32;
      const chosen = this.faceFor(family, codePoint) ?? this.faceFor(family, 0x20);
      if (!chosen) continue;
      const glyph = chosen.font.cmap.get(codePoint) ?? chosen.font.cmap.get(0x20) ?? 0;
      chosen.used.set(glyph, codePoint);
      const advance = chosen.font.advances.get(glyph) ?? chosen.font.defaultAdvance;
      const widthEm = advance / chosen.font.unitsPerEm;
      const last = runs[runs.length - 1];
      if (last && last.face === chosen) {
        last.glyphs.push(glyph);
        last.widthEm += widthEm;
      } else {
        runs.push({ face: chosen, glyphs: [glyph], widthEm });
      }
    }
    return runs;
  }

  measure(text: string, family: FontFamily, size: number): number {
    return this.runsFor(text, family).reduce((sum, run) => sum + run.widthEm * size, 0);
  }

  /** Draws a line of text with its baseline at `y`, measured from the page bottom. */
  text(
    text: string,
    options: { x: number; y: number; family: FontFamily; size: number; grey?: number; align?: "left" | "right" },
  ): void {
    const runs = this.runsFor(text, options.family);
    if (runs.length === 0) return;
    const total = runs.reduce((sum, run) => sum + run.widthEm * options.size, 0);
    let x = options.align === "right" ? options.x - total : options.x;
    const grey = options.grey ?? 0;

    this.current.push("BT");
    this.current.push(`${grey.toFixed(3)} g`);
    for (const run of runs) {
      const hex = run.glyphs.map((glyph) => glyph.toString(16).padStart(4, "0")).join("");
      this.current.push(`/${run.face.resource} ${options.size} Tf`);
      this.current.push(`1 0 0 1 ${x.toFixed(2)} ${options.y.toFixed(2)} Tm`);
      this.current.push(`<${hex}> Tj`);
      x += run.widthEm * options.size;
    }
    this.current.push("ET");
  }

  /** A one-pixel hairline rule, as the site uses to frame every section. */
  rule(args: { x: number; y: number; width: number; grey?: number }): void {
    this.current.push(
      `${(args.grey ?? 0.75).toFixed(3)} G 0.5 w ${args.x.toFixed(2)} ${args.y.toFixed(2)} m ` +
        `${(args.x + args.width).toFixed(2)} ${args.y.toFixed(2)} l S`,
    );
  }

  newPage(): void {
    this.pages[this.pages.length - 1] = this.current.join("\n");
    this.pages.push("");
    this.current = [];
  }

  get pageCount(): number {
    return this.pages.length;
  }

  build(): Buffer {
    this.pages[this.pages.length - 1] = this.current.join("\n");

    const objects: Buffer[] = [];
    const reserve = (): number => {
      objects.push(Buffer.alloc(0));
      return objects.length;
    };
    const put = (id: number, body: Buffer): void => {
      objects[id - 1] = body;
    };

    const catalogId = reserve();
    const pagesId = reserve();
    const pageIds = this.pages.map(() => reserve());
    const contentIds = this.pages.map(() => reserve());

    const fontResourceEntries: string[] = [];
    for (const loaded of this.faces.values()) {
      const type0Id = reserve();
      const cidFontId = reserve();
      const descriptorId = reserve();
      const fileId = reserve();
      const toUnicodeId = reserve();
      fontResourceEntries.push(`/${loaded.resource} ${type0Id} 0 R`);

      const scale = 1000 / loaded.font.unitsPerEm;
      const glyphs = [...loaded.used.keys()].sort((a, b) => a - b);
      const widths = glyphs
        .map((glyph) => {
          const advance = loaded.font.advances.get(glyph) ?? loaded.font.defaultAdvance;
          return `${glyph} [${Math.round(advance * scale)}]`;
        })
        .join(" ");

      put(
        type0Id,
        Buffer.from(
          `<< /Type /Font /Subtype /Type0 /BaseFont /${loaded.postScriptName} ` +
            `/Encoding /Identity-H /DescendantFonts [${cidFontId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`,
        ),
      );
      const toUnicode = Buffer.from(buildToUnicodeCMap(loaded.used), "latin1");
      put(
        toUnicodeId,
        Buffer.concat([
          Buffer.from(`<< /Length ${toUnicode.length} >>\nstream\n`),
          toUnicode,
          Buffer.from("\nendstream"),
        ]),
      );
      put(
        cidFontId,
        Buffer.from(
          `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${loaded.postScriptName} ` +
            `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
            `/FontDescriptor ${descriptorId} 0 R /DW ${Math.round(loaded.font.defaultAdvance * scale)} ` +
            `/W [${widths}] /CIDToGIDMap /Identity >>`,
        ),
      );
      const [x0, y0, x1, y1] = loaded.font.bbox;
      put(
        descriptorId,
        Buffer.from(
          `<< /Type /FontDescriptor /FontName /${loaded.postScriptName} /Flags 4 ` +
            `/FontBBox [${Math.round(x0 * scale)} ${Math.round(y0 * scale)} ${Math.round(x1 * scale)} ${Math.round(
              y1 * scale,
            )}] /ItalicAngle 0 /Ascent ${Math.round(loaded.font.ascent * scale)} ` +
            `/Descent ${Math.round(loaded.font.descent * scale)} /CapHeight ${Math.round(
              loaded.font.capHeight * scale,
            )} /StemV 80 /FontFile2 ${fileId} 0 R >>`,
        ),
      );
      put(
        fileId,
        Buffer.concat([
          Buffer.from(`<< /Length ${loaded.font.sfnt.length} /Length1 ${loaded.font.sfnt.length} >>\nstream\n`),
          loaded.font.sfnt,
          Buffer.from("\nendstream"),
        ]),
      );
    }

    const resources = `<< /Font << ${fontResourceEntries.join(" ")} >> >>`;
    put(catalogId, Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`));
    put(
      pagesId,
      Buffer.from(
        `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
      ),
    );
    this.pages.forEach((content, index) => {
      const pageId = pageIds[index] as number;
      const contentId = contentIds[index] as number;
      put(
        pageId,
        Buffer.from(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
            `/Resources ${resources} /Contents ${contentId} 0 R >>`,
        ),
      );
      const stream = Buffer.from(content, "latin1");
      put(
        contentId,
        Buffer.concat([
          Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
          stream,
          Buffer.from("\nendstream"),
        ]),
      );
    });

    const parts: Buffer[] = [Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1")];
    let offset = parts[0]?.length ?? 0;
    const offsets: number[] = [];
    objects.forEach((body, index) => {
      offsets.push(offset);
      const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
      parts.push(chunk);
      offset += chunk.length;
    });

    const xrefStart = offset;
    const xref: string[] = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n"];
    for (const entry of offsets) xref.push(`${entry.toString().padStart(10, "0")} 00000 n \n`);
    parts.push(Buffer.from(xref.join("")));
    parts.push(
      Buffer.from(
        `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
      ),
    );

    return Buffer.concat(parts);
  }
}
