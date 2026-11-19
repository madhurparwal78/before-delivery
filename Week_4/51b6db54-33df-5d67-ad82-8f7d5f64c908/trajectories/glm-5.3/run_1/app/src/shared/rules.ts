// Shared drawing rules. The single authority for lines, brushes, shapes, fill,
// dither, mirror, pixel-perfect, selection ops, compositing, ramps, dither
// matrix, edge masks and command ranking. Used by both server and client.

export type Tool = 'pencil' | 'eraser' | 'line' | 'rectangle' | 'ellipse' | 'fill' | 'dither' | 'selection' | 'picker';

export const TOOLS: Tool[] = ['pencil', 'eraser', 'line', 'rectangle', 'ellipse', 'fill', 'dither', 'selection', 'picker'];

export interface Cel { rows: number[][] } // rows of swatch indices
export interface Rect { x: number; y: number; w: number; h: number }

export function newCel(w: number, h: number): Cel {
  return { rows: Array.from({ length: h }, () => new Array<number>(w).fill(0)) };
}

export function celWidth(c: Cel): number { return c.rows[0]?.length ?? 0; }
export function celHeight(c: Cel): number { return c.rows.length; }

export function getIdx(c: Cel, x: number, y: number): number {
  if (y < 0 || y >= c.rows.length) return 0;
  const row = c.rows[y];
  if (x < 0 || x >= row.length) return 0;
  return row[x];
}

export function setIdx(c: Cel, x: number, y: number, i: number): void {
  if (y < 0 || y >= c.rows.length) return;
  const row = c.rows[y];
  if (x < 0 || x >= row.length) return;
  row[x] = i;
}

/** Bresenham-style per the brief. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = [];
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  let err = dx + dy;
  let x = x0, y = y0;
  pts.push([x, y]);
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += x1 > x ? 1 : -1; }
    if (e2 <= dx) { err += dx; y += y1 > y ? 1 : -1; }
    pts.push([x, y]);
  }
  return pts;
}

export function brushOffsets(size: number): number[] {
  const from = -Math.floor((size - 1) / 2), to = Math.floor(size / 2);
  const out: number[] = [];
  for (let o = from; o <= to; o++) out.push(o);
  return out;
}

export interface PaintOptions {
  filled?: boolean;
  contiguous?: boolean;
  secondary?: number;
  level?: number;
  pixelPerfect?: boolean;
}

export interface StrokeInput {
  tool: Tool;
  points: [number, number][];
  swatch: number;
  size: number;
  mirror: 'none' | 'x' | 'y' | 'both';
  options?: PaintOptions;
}

export function rectsNormalise(x0: number, y0: number, x1: number, y1: number): Rect {
  return {
    x: Math.min(x0, x1), y: Math.min(y0, y1),
    w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1
  };
}

export function ellipseCells(r: Rect, filled: boolean): [number, number][] {
  const { x: x0, y: y0, w: W, h: H } = r;
  const x1 = x0 + W - 1, y1 = y0 + H - 1;
  const inside = (x: number, y: number) => {
    const u = 2 * x + 1 - (x0 + x1 + 1);
    const v = 2 * y + 1 - (y0 + y1 + 1);
    return u * u * H * H + v * v * W * W <= W * W * H * H;
  };
  const cells: [number, number][] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      if (filled || !(inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1))) cells.push([x, y]);
    }
  }
  return cells;
}

/** Flood fill region on exact swatch index, 4-connected (or all cells of index). */
export function fillRegion(c: Cel, x: number, y: number, contiguous: boolean): [number, number][] {
  const w = celWidth(c), h = celHeight(c);
  const target = getIdx(c, x, y);
  const out: [number, number][] = [];
  if (!contiguous) {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (c.rows[yy][xx] === target) out.push([xx, yy]);
    return out;
  }
  const seen = new Set<string>();
  const q: [number, number][] = [[x, y]];
  seen.add(x + ',' + y);
  while (q.length) {
    const [cx, cy] = q.pop()!;
    out.push([cx, cy]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const key = nx + ',' + ny;
      if (seen.has(key)) continue;
      if (c.rows[ny][nx] !== target) continue;
      seen.add(key);
      q.push([nx, ny]);
    }
  }
  return out;
}

export const DITHER_MATRIX = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];

export function mirrorCell(x: number, y: number, w: number, h: number, mirror: 'none' | 'x' | 'y' | 'both'): [number, number][] {
  const out: [number, number][] = [[x, y]];
  if (mirror === 'x' || mirror === 'both') out.push([w - 1 - x, y]);
  if (mirror === 'y' || mirror === 'both') out.push([x, h - 1 - y]);
  if (mirror === 'both') out.push([w - 1 - x, h - 1 - y]);
  return out;
}

/** Keep one paint of each cell; a cell on a mirror axis is painted once. */
export function dedupe(cells: [number, number][]): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const [x, y] of cells) {
    const k = x + ',' + y;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([x, y]);
  }
  return out;
}

export function pixelPerfectKeep(points: [number, number][]): [number, number][] {
  const collapsed: [number, number][] = [];
  for (const p of lineJoin(points)) {
    const last = collapsed[collapsed.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    collapsed.push(p);
  }
  const kept: [number, number][] = [];
  for (const c of collapsed) {
    if (kept.length >= 2) {
      const p = kept[kept.length - 1], q = kept[kept.length - 2];
      const diag = Math.abs(c[0] - q[0]) === 1 && Math.abs(c[1] - q[1]) === 1;
      const shares = (p[0] === q[0] || p[1] === q[1]) && (p[0] === c[0] || p[1] === c[1]);
      if (diag && shares) kept.pop();
    }
    kept.push(c);
  }
  return kept;
}

export function lineJoin(points: [number, number][]): [number, number][] {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0]];
  let out: [number, number][] = [];
  for (let i = 1; i < points.length; i++) {
    const seg = linePoints(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    out = out.length ? out.concat(seg) : seg;
  }
  return out;
}

/** The cells a pencil/eraser/line/rectangle/ellipse stroke paints, before clipping. */
export function strokeCells(input: StrokeInput, w: number, h: number): [number, number][] {
  const { tool, points, size } = input;
  const mirror = input.mirror ?? 'none';
  const opts = input.options ?? {};
  let base: [number, number][] = [];
  if (tool === 'pencil' || tool === 'eraser') {
    let path = lineJoin(points);
    if (opts.pixelPerfect && size === 1) path = pixelPerfectKeep(points);
    base = path;
  } else if (tool === 'line') {
    base = points.length >= 2 ? linePoints(points[0][0], points[0][1], points[1][0], points[1][1]) : (points[0] ? [points[0]] : []);
  } else if (tool === 'rectangle') {
    if (points.length >= 2) {
      const r = rectsNormalise(points[0][0], points[0][1], points[1][0], points[1][1]);
      const filled = !!opts.filled;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const border = x === r.x || x === r.x + r.w - 1 || y === r.y || y === r.y + r.h - 1;
          if (filled || border) base.push([x, y]);
        }
      }
    }
  } else if (tool === 'ellipse') {
    if (points.length >= 2) {
      const r = rectsNormalise(points[0][0], points[0][1], points[1][0], points[1][1]);
      base = ellipseCells(r, !!opts.filled);
    }
  }
  let expanded: [number, number][] = [];
  const sz = tool === 'pencil' || tool === 'eraser' || tool === 'line' ? size : 1;
  for (const [x, y] of base) {
    for (const ox of brushOffsets(sz)) {
      for (const oy of brushOffsets(sz)) expanded.push([x + ox, y + oy]);
    }
  }
  if (mirror !== 'none') {
    const mirrored: [number, number][] = [];
    for (const [x, y] of expanded) mirrored.push(...mirrorCell(x, y, w, h, mirror));
    expanded = mirrored;
  }
  return dedupe(expanded);
}

/** Cells painted by fill or dither, as [x, y, swatch] triples. */
export function fillDitherCells(input: StrokeInput, cel: Cel): [number, number, number][] {
  const w = celWidth(cel), h = celHeight(cel);
  const [sx, sy] = input.points[0];
  const contiguous = input.options?.contiguous !== false;
  const mirror = input.mirror ?? 'none';
  const seeds = mirrorCell(sx, sy, w, h, mirror);
  const regions: [number, number][] = [];
  for (const s of seeds) {
    for (const c of fillRegion(cel, s[0], s[1], contiguous)) {
      regions.push(...mirrorCell(c[0], c[1], w, h, mirror));
    }
  }
  const expanded = dedupe(regions);
  const level = input.options?.level ?? 8;
  const primary = input.swatch;
  const secondary = input.options?.secondary ?? 0;
  const out: [number, number, number][] = [];
  for (const [x, y] of expanded) {
    const m = DITHER_MATRIX[y & 3][x & 3];
    out.push([x, y, m < level ? primary : secondary]);
  }
  return out;
}

// ---- Compositing (integer, exact per brief) ----

export function rh(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}

export function hexToBytes(color: string): [number, number, number, number] {
  return [
    parseInt(color.slice(0, 2), 16),
    parseInt(color.slice(2, 4), 16),
    parseInt(color.slice(4, 6), 16),
    parseInt(color.slice(6, 8), 16)
  ];
}

export function bytesToHex(r: number, g: number, b: number, a: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return h(r) + h(g) + h(b) + h(a);
}

/** Composite the stack bottom-first. Each layer's source colour comes from the
 * swatch index at each cell through colorOf. */
export interface CompositeLayer { rows: number[][]; colorOf: (index: number) => string; opacity: number; blend: 'normal' | 'multiply'; visible: boolean }

export function makeColorOf(colors: { index: number; color: string }[]): (index: number) => string {
  const map = new Map(colors.map((c) => [c.index, c.color]));
  return (index: number) => map.get(index) ?? '00000000';
}

export function composite(w: number, h: number, layers: CompositeLayer[]): Uint8Array {
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let dr = 0, dg = 0, db = 0, da = 0;
      for (const layer of layers) {
        if (!layer.visible) continue;
        const idx = layer.rows[y]?.[x] ?? 0;
        if (idx === 0) continue;
        const [sr, sg, sb, sa] = hexToBytes(layer.colorOf(idx));
        const o = layer.opacity;
        const a = rh(sa * o, 100);
        if (a === 0) continue;
        let cr: number, cg: number, cb: number;
        if (layer.blend === 'multiply' && da > 0) {
          cr = rh(sr * (255 - da) + rh(sr * dr, 255) * da, 255);
          cg = rh(sg * (255 - da) + rh(sg * dg, 255) * da, 255);
          cb = rh(sb * (255 - da) + rh(sb * db, 255) * da, 255);
        } else {
          cr = sr; cg = sg; cb = sb;
        }
        const ra = a + rh(da * (255 - a), 255);
        dr = rh(cr * a * 255 + dr * da * (255 - a), ra * 255);
        dg = rh(cg * a * 255 + dg * da * (255 - a), ra * 255);
        db = rh(cb * a * 255 + db * da * (255 - a), ra * 255);
        da = ra;
      }
      const o = (y * w + x) * 4;
      buf[o] = dr; buf[o + 1] = dg; buf[o + 2] = db; buf[o + 3] = da;
    }
  }
  return buf;
}

export function rampColor(from: string, to: string, i: number, n: number): string {
  const a = hexToBytes(from), b = hexToBytes(to);
  const ch = (av: number, bv: number) => rh(av * (n - 1 - i) + bv * i, n - 1);
  return bytesToHex(ch(a[0], b[0]), ch(a[1], b[1]), ch(a[2], b[2]), ch(a[3], b[3]));
}

// ---- Edge matching ----

export function edgeMask(cells: Set<string>, x: number, y: number): number {
  let m = 0;
  if (cells.has(x + ',' + (y - 1))) m |= 1;
  if (cells.has((x + 1) + ',' + y)) m |= 2;
  if (cells.has(x + ',' + (y + 1))) m |= 4;
  if (cells.has((x - 1) + ',' + y)) m |= 8;
  return m;
}

// ---- Command ranking ----

export function subsequenceMatch(query: string, name: string): { start: number; end: number } | null {
  const q = query.toLowerCase(), n = name.toLowerCase();
  let ni = 0, start = -1, end = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const found = n.indexOf(q[qi], ni);
    if (found === -1) return null;
    if (start === -1) start = found;
    end = found;
    ni = found + 1;
  }
  return { start, end: end + 1 };
}

export function commandScore(query: string, name: string): number | null {
  if (query === '') return 100;
  const m = subsequenceMatch(query, name);
  if (!m) return null;
  const span = m.end - m.start;
  return 100 - m.start - (span - query.length);
}

export function rankCommands(query: string, items: string[]): string[] {
  const scored = items.map((it) => ({ it, s: commandScore(query, it) }))
    .filter((x): x is { it: string; s: number } => x.s !== null);
  scored.sort((a, b) => b.s - a.s || a.it.toLowerCase().localeCompare(b.it.toLowerCase()));
  return scored.map((x) => x.it);
}

// ---- Palette files ----

export interface PaletteParseResult { colors: string[]; error?: { line: number; text: string } }

export function parseHexPalette(text: string): PaletteParseResult {
  const colors: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    if (!/^[0-9a-fA-F]{6}$/.test(line)) return { colors, error: { line: i + 1, text: `Line ${i + 1}: expected six hex digits` } };
    colors.push(line.toLowerCase() + 'ff');
  }
  return { colors };
}

export function parseGplPalette(text: string): PaletteParseResult {
  const lines = text.split(/\r?\n/);
  if (!lines[0].startsWith('GIMP Palette')) return { colors: [], error: { line: 1, text: 'Line 1: expected GIMP Palette header' } };
  const colors: string[] = [];
  for (let idx = 1; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (line === '') continue;
    if (line.startsWith('Name:') || line.startsWith('Columns:')) continue;
    if (line.startsWith('#')) continue;
    const m = line.match(/^(\d+)\s+(\d+)\s+(\d+)\b/);
    if (!m) return { colors, error: { line: idx + 1, text: `Line ${idx + 1}: expected three numbers from 0 to 255` } };
    const nums = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (nums.some((n) => n < 0 || n > 255)) {
      return { colors, error: { line: idx + 1, text: `Line ${idx + 1}: expected three numbers from 0 to 255` } };
    }
    colors.push(bytesToHex(nums[0], nums[1], nums[2], 255));
  }
  return { colors };
}

export function parsePaletteFile(file_name: string, text: string): PaletteParseResult {
  const lower = file_name.toLowerCase();
  if (lower.endsWith('.hex')) return parseHexPalette(text);
  if (lower.endsWith('.gpl')) return parseGplPalette(text);
  return { colors: [], error: { line: 0, text: 'Use a .hex or .gpl file' } };
}

// ---- Number and date formatting ----

export function formatNumber(n: number, locale: 'en-US' | 'en-IN'): string {
  const [int, dec] = String(n).split('.');
  const neg = int.startsWith('-');
  const digits = neg ? int.slice(1) : int;
  let grouped: string;
  if (digits.length <= 3) grouped = digits;
  else if (locale === 'en-IN') {
    const last3 = digits.slice(-3);
    const rest = digits.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  } else {
    grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  return (neg ? '-' : '') + grouped + (dec ? '.' + dec : '');
}

export function formatDate(instant: string, locale: 'en-US' | 'en-IN', zone: 'UTC' | 'Asia/Kolkata' | 'America/New_York'): string {
  const d = new Date(instant);
  const fmt = new Intl.DateTimeFormat(locale === 'en-US' ? 'en-US' : 'en-IN', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const abbr = zone === 'UTC' ? 'UTC' : zone === 'Asia/Kolkata' ? 'IST' : (nyDst(d) ? 'EDT' : 'EST');
  const hour = get('hour');
  const hm = `${hour.length < 2 ? '0' + hour : hour}:${get('minute')}`;
  return locale === 'en-US'
    ? `${get('month')} ${get('day')}, ${get('year')} ${hm} ${abbr}`
    : `${get('day')} ${get('month')} ${get('year')} ${hm} ${abbr}`;
}

function nyDst(d: Date): boolean {
  const y = d.getUTCFullYear();
  const march1 = new Date(Date.UTC(y, 2, 1));
  const nov1 = new Date(Date.UTC(y, 10, 1));
  const start = new Date(Date.UTC(y, 2, 8 + ((14 - march1.getUTCDay()) % 7), 7, 0));
  const end = new Date(Date.UTC(y, 10, 1 + ((7 - nov1.getUTCDay()) % 7), 6, 0));
  return d >= start && d < end;
}

export function relativeTime(nowMs: number, atMs: number): string {
  const diff = Math.max(0, Math.floor((nowMs - atMs) / 1000));
  if (diff < 60) return 'just now';
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// ---- Tag sequences ----

export function tagSequence(from: number, to: number, direction: 'forward' | 'reverse' | 'pingpong'): number[] {
  if (direction === 'forward') {
    const out: number[] = [];
    for (let f = from; f <= to; f++) out.push(f);
    return out;
  }
  if (direction === 'reverse') {
    const out: number[] = [];
    for (let f = to; f >= from; f--) out.push(f);
    return out;
  }
  const up: number[] = [];
  for (let f = from; f <= to; f++) up.push(f);
  if (up.length < 2) return up;
  const down: number[] = [];
  for (let f = to - 1; f > from; f--) down.push(f);
  return up.concat(down);
}

/** Apply a stroke to a cel; returns painted cells (clipped) with their indices. */
export function applyStrokeToCel(cel: Cel, input: StrokeInput): { cells: [number, number, number][]; changed: number } {
  const painted = input.tool === 'fill' || input.tool === 'dither'
    ? fillDitherCells(input, cel)
    : strokeCells(input, celWidth(cel), celHeight(cel)).map(([x, y]) => [x, y, input.tool === 'eraser' ? 0 : input.swatch] as [number, number, number]);
  const cells: [number, number, number][] = [];
  let changed = 0;
  for (const [x, y, idx] of painted) {
    if (x < 0 || y < 0 || y >= cel.rows.length || x >= cel.rows[y].length) continue;
    const row = cel.rows[y];
    if (row[x] !== idx) changed++;
    row[x] = idx;
    cells.push([x, y, idx]);
  }
  return { cells, changed };
}
