/** Widths of Helvetica, one of the 14 standard PDF fonts, in 1/1000 em. */
const HELVETICA_WIDTHS: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** All text in the completed PDF is plain ASCII; anything else becomes `?`. */
export const toAscii = (text: string): string =>
  [...text].map((char) => (char >= ' ' && char <= '~' ? char : '?')).join('');

export const helveticaWidth = (text: string, size: number): number => {
  let total = 0;
  for (const char of toAscii(text)) {
    total += HELVETICA_WIDTHS[char.charCodeAt(0) - 32] ?? 556;
  }
  return (total / 1000) * size;
};

export const fitSize = (text: string, maxWidth: number, maxSize: number): number => {
  const measured = helveticaWidth(text, maxSize);
  if (measured <= maxWidth || measured === 0) return maxSize;
  return Math.max(4, (maxWidth / measured) * maxSize);
};

const escapeLiteral = (text: string): string =>
  toAscii(text).replace(/[\\()]/g, (char) => `\\${char}`);

const n = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');

export class ContentStream {
  private readonly parts: string[] = [];

  /** Draws one text string with the standard Helvetica font. */
  text(value: string, x: number, y: number, size: number): this {
    this.parts.push(
      `BT /F1 ${n(size)} Tf 1 0 0 1 ${n(x)} ${n(y)} Tm (${escapeLiteral(value)}) Tj ET`,
    );
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, width: number): this {
    this.parts.push(`q ${n(width)} w ${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S Q`);
    return this;
  }

  polyline(points: ReadonlyArray<readonly [number, number]>, width: number): this {
    if (points.length === 0) return this;
    const [first, ...rest] = points;
    if (!first) return this;
    const ops = [`q ${n(width)} w 1 J 1 j ${n(first[0])} ${n(first[1])} m`];
    for (const [x, y] of rest) ops.push(`${n(x)} ${n(y)} l`);
    if (rest.length === 0) ops.push(`${n(first[0] + 0.3)} ${n(first[1])} l`);
    ops.push('S Q');
    this.parts.push(ops.join(' '));
    return this;
  }

  form(name: string): this {
    this.parts.push(`q /${name} Do Q`);
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.from(`${this.parts.join('\n')}\n`, 'latin1');
  }
}
