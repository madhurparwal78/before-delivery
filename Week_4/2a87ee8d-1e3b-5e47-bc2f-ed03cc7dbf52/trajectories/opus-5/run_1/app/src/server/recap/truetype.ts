/**
 * The little of TrueType the recap PDF needs: the glyph a character maps to, its advance
 * width, and the font bytes to embed. Enough to build a CIDFontType2 with a ToUnicode CMap,
 * so a plain extractor recovers each note text.
 */

interface TableRecord {
  readonly offset: number;
  readonly length: number;
}

export class TrueTypeFont {
  private readonly tables = new Map<string, TableRecord>();
  readonly unitsPerEm: number;
  readonly numGlyphs: number;
  private readonly advances: readonly number[];
  private readonly characterToGlyph = new Map<number, number>();

  constructor(
    readonly bytes: Buffer,
    readonly postScriptName: string,
  ) {
    const numTables = bytes.readUInt16BE(4);
    for (let index = 0; index < numTables; index += 1) {
      const base = 12 + index * 16;
      const tag = bytes.toString('latin1', base, base + 4);
      this.tables.set(tag, { offset: bytes.readUInt32BE(base + 8), length: bytes.readUInt32BE(base + 12) });
    }
    const head = this.table('head');
    this.unitsPerEm = bytes.readUInt16BE(head.offset + 18);
    const maxp = this.table('maxp');
    this.numGlyphs = bytes.readUInt16BE(maxp.offset + 4);
    this.advances = this.readAdvances();
    this.readCmap();
  }

  private table(tag: string): TableRecord {
    const record = this.tables.get(tag);
    if (!record) throw new Error(`Font ${this.postScriptName} has no ${tag} table`);
    return record;
  }

  private readAdvances(): number[] {
    const hhea = this.table('hhea');
    const count = this.bytes.readUInt16BE(hhea.offset + 34);
    const hmtx = this.table('hmtx');
    const advances: number[] = [];
    let last = 0;
    for (let glyph = 0; glyph < this.numGlyphs; glyph += 1) {
      if (glyph < count) last = this.bytes.readUInt16BE(hmtx.offset + glyph * 4);
      advances.push(last);
    }
    return advances;
  }

  private readCmap(): void {
    const cmap = this.table('cmap');
    const subtableCount = this.bytes.readUInt16BE(cmap.offset + 2);
    let best: { offset: number; format: number } | null = null;
    for (let index = 0; index < subtableCount; index += 1) {
      const record = cmap.offset + 4 + index * 8;
      const platform = this.bytes.readUInt16BE(record);
      const encoding = this.bytes.readUInt16BE(record + 2);
      const offset = cmap.offset + this.bytes.readUInt32BE(record + 4);
      const format = this.bytes.readUInt16BE(offset);
      const isUnicode =
        (platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0;
      if (!isUnicode) continue;
      // Format 12 covers the whole range; prefer it when present.
      if (best === null || (format === 12 && best.format !== 12)) best = { offset, format };
    }
    if (best === null) throw new Error(`Font ${this.postScriptName} has no Unicode cmap`);
    if (best.format === 4) this.readCmapFormat4(best.offset);
    else if (best.format === 12) this.readCmapFormat12(best.offset);
    else throw new Error(`Font ${this.postScriptName} uses unsupported cmap format ${best.format}`);
  }

  private readCmapFormat4(offset: number): void {
    const segCountX2 = this.bytes.readUInt16BE(offset + 6);
    const segCount = segCountX2 / 2;
    const endCodes = offset + 14;
    const startCodes = endCodes + segCountX2 + 2;
    const idDeltas = startCodes + segCountX2;
    const idRangeOffsets = idDeltas + segCountX2;
    for (let segment = 0; segment < segCount; segment += 1) {
      const end = this.bytes.readUInt16BE(endCodes + segment * 2);
      const start = this.bytes.readUInt16BE(startCodes + segment * 2);
      const delta = this.bytes.readInt16BE(idDeltas + segment * 2);
      const rangeOffsetPosition = idRangeOffsets + segment * 2;
      const rangeOffset = this.bytes.readUInt16BE(rangeOffsetPosition);
      if (start === 0xffff) continue;
      for (let code = start; code <= end && code !== 0x10000; code += 1) {
        let glyph: number;
        if (rangeOffset === 0) {
          glyph = (code + delta) & 0xffff;
        } else {
          const glyphPosition = rangeOffsetPosition + rangeOffset + (code - start) * 2;
          if (glyphPosition + 1 >= this.bytes.length) continue;
          const raw = this.bytes.readUInt16BE(glyphPosition);
          glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
        }
        if (glyph !== 0) this.characterToGlyph.set(code, glyph);
      }
    }
  }

  private readCmapFormat12(offset: number): void {
    const groupCount = this.bytes.readUInt32BE(offset + 12);
    for (let group = 0; group < groupCount; group += 1) {
      const base = offset + 16 + group * 12;
      const start = this.bytes.readUInt32BE(base);
      const end = this.bytes.readUInt32BE(base + 4);
      const startGlyph = this.bytes.readUInt32BE(base + 8);
      for (let code = start; code <= end; code += 1) {
        this.characterToGlyph.set(code, startGlyph + (code - start));
      }
    }
  }

  glyphFor(codePoint: number): number {
    return this.characterToGlyph.get(codePoint) ?? 0;
  }

  /** Advance width in 1000ths of an em, the unit PDF font widths use. */
  widthFor(glyph: number): number {
    const advance = this.advances[glyph] ?? 0;
    return Math.round((advance * 1000) / this.unitsPerEm);
  }

  private locaOffsets: readonly number[] | null = null;

  private readLoca(): readonly number[] {
    if (this.locaOffsets !== null) return this.locaOffsets;
    const head = this.table('head');
    const longFormat = this.bytes.readInt16BE(head.offset + 50) === 1;
    const loca = this.table('loca');
    const offsets: number[] = [];
    for (let glyph = 0; glyph <= this.numGlyphs; glyph += 1) {
      offsets.push(
        longFormat
          ? this.bytes.readUInt32BE(loca.offset + glyph * 4)
          : this.bytes.readUInt16BE(loca.offset + glyph * 2) * 2,
      );
    }
    this.locaOffsets = offsets;
    return offsets;
  }

  /**
   * The glyph's closed contours in font units, with quadratic curves already flattened,
   * so a scanline fill can rasterise them for the recap PNGs.
   */
  contoursFor(glyph: number): ReadonlyArray<ReadonlyArray<readonly [number, number]>> {
    const loca = this.readLoca();
    const glyf = this.table('glyf');
    const start = loca[glyph];
    const end = loca[glyph + 1];
    if (start === undefined || end === undefined || end <= start) return [];
    const base = glyf.offset + start;
    const contourCount = this.bytes.readInt16BE(base);
    // A composite glyph assembles other glyphs; its components are drawn in their own right.
    if (contourCount < 0) return this.compositeContours(base);

    const endPoints: number[] = [];
    for (let index = 0; index < contourCount; index += 1) {
      endPoints.push(this.bytes.readUInt16BE(base + 10 + index * 2));
    }
    const pointCount = (endPoints[contourCount - 1] ?? -1) + 1;
    let cursor = base + 10 + contourCount * 2;
    cursor += 2 + this.bytes.readUInt16BE(cursor); // skip the instructions

    const flags: number[] = [];
    while (flags.length < pointCount) {
      const flag = this.bytes.readUInt8(cursor);
      cursor += 1;
      flags.push(flag);
      if ((flag & 8) !== 0) {
        const repeat = this.bytes.readUInt8(cursor);
        cursor += 1;
        for (let index = 0; index < repeat; index += 1) flags.push(flag);
      }
    }

    const readCoordinates = (shortBit: number, sameBit: number): number[] => {
      const values: number[] = [];
      let value = 0;
      for (let index = 0; index < pointCount; index += 1) {
        const flag = flags[index] as number;
        if ((flag & shortBit) !== 0) {
          const delta = this.bytes.readUInt8(cursor);
          cursor += 1;
          value += (flag & sameBit) !== 0 ? delta : -delta;
        } else if ((flag & sameBit) === 0) {
          value += this.bytes.readInt16BE(cursor);
          cursor += 2;
        }
        values.push(value);
      }
      return values;
    };
    const xs = readCoordinates(2, 16);
    const ys = readCoordinates(4, 32);

    const contours: Array<Array<readonly [number, number]>> = [];
    let first = 0;
    for (const last of endPoints) {
      const points: Array<{ x: number; y: number; onCurve: boolean }> = [];
      for (let index = first; index <= last; index += 1) {
        points.push({
          x: xs[index] as number,
          y: ys[index] as number,
          onCurve: ((flags[index] as number) & 1) !== 0,
        });
      }
      if (points.length > 0) contours.push(flattenContour(points));
      first = last + 1;
    }
    return contours;
  }

  private compositeContours(base: number): ReadonlyArray<ReadonlyArray<readonly [number, number]>> {
    const contours: Array<ReadonlyArray<readonly [number, number]>> = [];
    let cursor = base + 10;
    for (;;) {
      const flags = this.bytes.readUInt16BE(cursor);
      const glyphIndex = this.bytes.readUInt16BE(cursor + 2);
      cursor += 4;
      let dx = 0;
      let dy = 0;
      if ((flags & 1) !== 0) {
        dx = this.bytes.readInt16BE(cursor);
        dy = this.bytes.readInt16BE(cursor + 2);
        cursor += 4;
      } else {
        dx = this.bytes.readInt8(cursor);
        dy = this.bytes.readInt8(cursor + 1);
        cursor += 2;
      }
      if ((flags & 8) !== 0) cursor += 2;
      else if ((flags & 0x40) !== 0) cursor += 4;
      else if ((flags & 0x80) !== 0) cursor += 8;

      for (const contour of this.contoursFor(glyphIndex)) {
        contours.push(contour.map(([x, y]) => [x + dx, y + dy] as const));
      }
      if ((flags & 0x20) === 0) break;
    }
    return contours;
  }
}

const CURVE_STEPS = 6;

/** Turns a TrueType contour into a polygon, splitting each quadratic curve into segments. */
function flattenContour(
  points: ReadonlyArray<{ x: number; y: number; onCurve: boolean }>,
): Array<readonly [number, number]> {
  const midpoint = (
    left: { x: number; y: number },
    right: { x: number; y: number },
  ): { x: number; y: number; onCurve: boolean } => ({
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
    onCurve: true,
  });

  // Normalise so the contour starts on the curve.
  const first = points[0] as { x: number; y: number; onCurve: boolean };
  const ordered = first.onCurve
    ? [...points]
    : [midpoint(points[points.length - 1] as { x: number; y: number }, first), ...points];

  const polygon: Array<readonly [number, number]> = [];
  const start = ordered[0] as { x: number; y: number };
  polygon.push([start.x, start.y]);
  let current = start;

  for (let index = 1; index <= ordered.length; index += 1) {
    const point = ordered[index % ordered.length] as { x: number; y: number; onCurve: boolean };
    if (point.onCurve) {
      polygon.push([point.x, point.y]);
      current = point;
      continue;
    }
    const after = ordered[(index + 1) % ordered.length] as { x: number; y: number; onCurve: boolean };
    const end = after.onCurve ? after : midpoint(point, after);
    for (let step = 1; step <= CURVE_STEPS; step += 1) {
      const t = step / CURVE_STEPS;
      const inverse = 1 - t;
      polygon.push([
        inverse * inverse * current.x + 2 * inverse * t * point.x + t * t * end.x,
        inverse * inverse * current.y + 2 * inverse * t * point.y + t * t * end.y,
      ]);
    }
    current = end;
    if (after.onCurve) index += 1;
  }
  return polygon;
}

export interface ShapedText {
  /** Glyph ids, in order, for the Identity-H encoded string. */
  readonly glyphs: readonly number[];
  /** The code point each glyph stands for, so the ToUnicode CMap can be built. */
  readonly codePoints: readonly number[];
  /** Width in 1000ths of an em. */
  readonly width: number;
}

export function shape(font: TrueTypeFont, text: string): ShapedText {
  const glyphs: number[] = [];
  const codePoints: number[] = [];
  let width = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    const glyph = font.glyphFor(codePoint);
    glyphs.push(glyph);
    codePoints.push(codePoint);
    width += font.widthFor(glyph);
  }
  return { glyphs, codePoints, width };
}

export function textWidth(font: TrueTypeFont, text: string, fontSize: number): number {
  return (shape(font, text).width * fontSize) / 1000;
}
