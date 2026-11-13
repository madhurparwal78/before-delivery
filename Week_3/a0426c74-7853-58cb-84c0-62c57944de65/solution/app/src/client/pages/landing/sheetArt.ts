// Path-string helpers for the invented sheet drawings. Y runs down, units are the frame's viewBox units.

export const rect = (x: number, y: number, w: number, h: number): string => `M${x} ${y}h${w}v${h}h${-w}z`;

export const circle = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const ellipse = (cx: number, cy: number, rx: number, ry: number): string =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;

/** a small cross marking a centre */
export const centreMark = (cx: number, cy: number, size = 2): string =>
  `M${cx - size} ${cy}h${2 * size}M${cx} ${cy - size}v${2 * size}`;

/** 45 degree hatch lines clipped to a rectangle */
export function hatch(x: number, y: number, w: number, h: number, gap: number): string {
  const segments: string[] = [];
  for (let t = gap; t < w + h; t += gap) {
    const startX = t <= w ? x + t : x + w;
    const startY = t <= w ? y : y + (t - w);
    const endX = t <= h ? x : x + (t - h);
    const endY = t <= h ? y + t : y + h;
    segments.push(`M${startX} ${startY}L${endX} ${endY}`);
  }
  return segments.join('');
}

/** horizontal dimension line with end ticks */
export const dimH = (x1: number, x2: number, y: number): string =>
  `M${x1} ${y}H${x2}M${x1} ${y - 2.5}v5M${x2} ${y - 2.5}v5M${x1 - 1.5} ${y + 1.5}l3 -3M${x2 - 1.5} ${y + 1.5}l3 -3`;

/** vertical dimension line with end ticks */
export const dimV = (x: number, y1: number, y2: number): string =>
  `M${x} ${y1}V${y2}M${x - 2.5} ${y1}h5M${x - 2.5} ${y2}h5M${x - 1.5} ${y1 + 1.5}l3 -3M${x - 1.5} ${y2 + 1.5}l3 -3`;

/** repeated copies of a path generator along a row or grid */
export function grid(columns: number, rows: number, x: number, y: number, dx: number, dy: number, cell: (cx: number, cy: number) => string): string {
  const cells: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) cells.push(cell(x + column * dx, y + row * dy));
  }
  return cells.join('');
}

/** copies of a path generator spaced evenly on a circle */
export function around(cx: number, cy: number, radius: number, count: number, cell: (x: number, y: number) => string): string {
  const cells: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (2 * Math.PI * i) / count;
    cells.push(cell(+(cx + radius * Math.cos(angle)).toFixed(2), +(cy + radius * Math.sin(angle)).toFixed(2)));
  }
  return cells.join('');
}
