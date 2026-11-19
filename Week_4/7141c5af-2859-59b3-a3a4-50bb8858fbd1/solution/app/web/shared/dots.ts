/**
 * The one dot primitive: chairs, swatches, hides and glyphs are all drawn from it.
 * Pure and deterministic from a seed, so the server and both browsers print the same picture.
 */
const INK = "#25282B";
const MUTED = "#62686C";
const PALE = "#B7BBBC";

type Point = readonly [number, number];

interface Shape {
  hit(x: number, y: number): boolean;
  tone(x: number, y: number): number;
}

function seedOf(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  }
  return value >>> 0;
}

/** A small deterministic generator; the same seed always gives the same grain. */
function generator(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822519);
    state = Math.imul(state ^ (state >>> 13), 3266489917);
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
}

function noise(x: number, y: number, seed: number): number {
  return generator(Math.imul(Math.round(x * 8) + 7919, 73856093) ^ Math.imul(Math.round(y * 8) + 104729, 19349663) ^ seed)();
}

function segmentDistance(x: number, y: number, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const along = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - a[0] - along * dx, y - a[1] - along * dy);
}

/** A bent tube or turned leg: a run of points at one thickness, lit along its left side. */
function tube(points: readonly Point[], radius: number, tone = 0.95): Shape {
  const nearest = (x: number, y: number): number => {
    let best = Number.POSITIVE_INFINITY;
    for (let index = 0; index + 1 < points.length; index += 1) {
      best = Math.min(best, segmentDistance(x, y, points[index] as Point, points[index + 1] as Point));
    }
    return best;
  };
  return { hit: (x, y) => nearest(x, y) <= radius, tone: () => tone };
}

/** An upholstered or wooden surface: lighter to the upper left, darker along its edge. */
function panel(corners: readonly Point[], light: number, dark: number, edge = 0.95): Shape {
  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const span = Math.max(...xs) - left + Math.max(...ys) - top || 1;
  const hit = (x: number, y: number): boolean => {
    let inside = false;
    for (let index = 0, last = corners.length - 1; index < corners.length; last = index, index += 1) {
      const a = corners[index] as Point;
      const b = corners[last] as Point;
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  const tone = (x: number, y: number): number => {
    for (let index = 0, last = corners.length - 1; index < corners.length; last = index, index += 1) {
      if (segmentDistance(x, y, corners[index] as Point, corners[last] as Point) < 1.1) return edge;
    }
    return light + ((x - left + y - top) / span) * (dark - light);
  };
  return { hit, tone };
}

function ground(cx: number, cy: number, rx: number, ry: number): Shape {
  const reach = (x: number, y: number): number => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
  return { hit: (x, y) => reach(x, y) <= 1, tone: (x, y) => 0.26 * (1 - reach(x, y)) + 0.05 };
}

function curve(from: Point, via: Point, to: Point, steps = 10): Point[] {
  return Array.from({ length: steps + 1 }, (_, step) => {
    const t = step / steps;
    const u = 1 - t;
    return [u * u * from[0] + 2 * u * t * via[0] + t * t * to[0], u * u * from[1] + 2 * u * t * via[1] + t * t * to[1]] as const;
  });
}

type Chair = (vary: number) => Shape[];

const CHAIRS: Record<string, Chair> = {
  bentwood: (vary) => {
    const top = 14 - vary * 4;
    return [
      ground(50, 92, 36, 5),
      tube([[60, 56], [68, 90]], 1.5),
      tube([[37, 56], [31, 87]], 1.5),
      tube(curve([66, 50], [80, top + 6], [58, top + 2]), 1.9),
      tube(curve([58, top + 2], [38, top - 6], [28, top + 12]), 1.9),
      tube(curve([28, top + 12], [20, 36], [26, 50]), 1.9),
      ...[0, 1, 2, 3, 4].map((index) => tube([[38 + index * 7, top + 2 + Math.abs(index - 2)], [40 + index * 5.4, 50]], 0.8, 0.7)),
      panel([[24, 52], [62, 49], [74, 58], [33, 64]], 0.28, 0.62),
      panel([[33, 64], [74, 58], [74, 61], [33, 67]], 0.8, 0.95),
      tube([[33, 66], [24, 91]], 1.7),
      tube([[74, 60], [78, 86]], 1.7),
      tube(curve([28, 80], [50, 84], [76, 76]), 1, 0.8),
      tube(curve([20, 40], [12, 44], [29, 57]), 1.6),
      tube(curve([77, 36], [84, 42], [72, 55]), 1.6),
    ];
  },
  tubular: (vary) => [
    ground(50, 91, 40, 5),
    tube(curve([28, 88], [16, 88], [16, 72]), 1.7),
    tube([[16, 72], [20, 42]], 1.7),
    tube(curve([20, 42], [22, 34], [30, 34]), 1.7),
    tube([[30, 34], [52, 34]], 1.7),
    tube([[28, 88], [72, 88]], 1.7),
    tube(curve([72, 88], [86, 88], [84, 70]), 1.7),
    tube([[84, 70], [80, 38]], 1.7),
    tube(curve([80, 38], [78, 30], [68, 31]), 1.7),
    panel([[34, 14 - vary * 3], [66, 12 - vary * 3], [74, 54], [40, 58]], 0.3, 0.72),
    panel([[26, 58], [40, 58], [74, 54], [80, 62], [32, 72]], 0.4, 0.82),
    panel([[32, 72], [80, 62], [80, 66], [32, 76]], 0.78, 0.95),
  ],
  cantilever: (vary) => [
    ground(52, 91, 34, 4.5),
    tube([[30, 89], [76, 89]], 1.6),
    tube(curve([76, 89], [86, 89], [78, 74]), 1.6),
    tube([[78, 74], [70, 60]], 1.6),
    tube(curve([70, 60], [66, 54], [58, 54]), 1.6),
    tube([[58, 54], [34, 56]], 1.6),
    tube(curve([66, 54], [74, 52], [74, 44]), 1.6),
    tube([[74, 44], [78, 12 + vary * 5]], 1.6),
    panel([[26, 50], [72, 47], [76, 53], [30, 58]], 0.28, 0.72),
    panel([[30, 58], [76, 53], [76, 56], [30, 61]], 0.78, 0.95),
    panel([[60, 12 + vary * 5], [80, 10 + vary * 5], [79, 32], [59, 34]], 0.34, 0.76),
  ],
  folding: (vary) => [
    ground(50, 92, 42, 4.5),
    tube([[24, 90], [76, 30 - vary * 4]], 1.5),
    tube([[20, 40], [82, 90]], 1.5),
    tube([[76, 30 - vary * 4], [88, 8]], 1.5),
    tube([[12, 62], [80, 62]], 1.2, 0.8),
    panel([[66, 10], [88, 8], [62, 58], [36, 72], [20, 62], [46, 52]], 0.2, 0.62),
    tube([[20, 62], [46, 52], [66, 10]], 0.9),
    tube([[36, 72], [62, 58], [88, 8]], 0.9),
    tube([[6, 56], [38, 44]], 1.8, 0.9),
  ],
  swivel: (vary) => [
    ground(50, 92, 34, 5),
    tube([[50, 72], [50, 84]], 3),
    tube([[50, 84], [22, 90]], 1.8),
    tube([[50, 84], [78, 90]], 1.8),
    tube([[50, 84], [36, 93]], 1.8),
    tube([[50, 84], [64, 93]], 1.8),
    tube([[50, 84], [50, 88]], 1.8),
    panel([[26, 64], [74, 62], [76, 70], [30, 73]], 0.58, 0.95),
    panel([[24, 56], [76, 54], [78, 63], [26, 66]], 0.26, 0.72),
    panel([[30, 12 + vary * 4], [70, 12 + vary * 4], [76, 56], [24, 57]], 0.3, 0.78),
    tube(curve([24, 40], [10, 42], [20, 54]), 2.1),
    tube(curve([76, 40], [90, 42], [80, 54]), 2.1),
  ],
  slat: () => [
    ground(50, 84, 48, 5),
    ...[0, 1, 2, 3].map((index) => panel([[4 + index * 2.4, 38 + index * 5.4], [90 + index * 2.4, 36 + index * 5.4], [90 + index * 2.4, 39.6 + index * 5.4], [4 + index * 2.4, 41.6 + index * 5.4]], 0.34, 0.7)),
    tube([[14, 60], [14, 82]], 2),
    tube([[86, 58], [86, 80]], 2),
    tube([[22, 60], [22, 76]], 1.5),
    tube([[92, 58], [92, 74]], 1.5),
    tube([[14, 72], [86, 70]], 1, 0.75),
  ],
  lounge: (vary) => [
    ground(50, 92, 40, 5),
    tube([[26, 72], [18, 90]], 1.9),
    tube([[76, 70], [84, 88]], 1.9),
    tube([[40, 72], [38, 86]], 1.5),
    tube([[62, 70], [66, 84]], 1.5),
    panel([[22, 18 - vary * 5], [58, 12 - vary * 5], [70, 56], [28, 62]], 0.26, 0.7),
    panel([[18, 56], [72, 52], [84, 62], [26, 72]], 0.3, 0.8),
    panel([[26, 72], [84, 62], [84, 66], [26, 76]], 0.76, 0.95),
    tube(curve([12, 40], [8, 52], [24, 54]), 2.4),
    tube(curve([76, 34], [90, 44], [78, 52]), 2.4),
  ],
};

const CHAIR_NAMES = Object.keys(CHAIRS);

/** The drawing seed of a piece: its title as a case slug, so a piece and its case show the same chair. */
export function chairSeed(title: string): string {
  return title.toLowerCase().replaceAll(" ", "-");
}

function chairFor(seed: string): Chair {
  const word = CHAIR_NAMES.find((name) => seed.includes(name)) ?? (seed.includes("armchair") ? "lounge" : seed.includes("bench") ? "slat" : seed.includes("deck") ? "folding" : seed.includes("desk") ? "swivel" : undefined);
  return CHAIRS[word ?? (CHAIR_NAMES[seedOf(seed) % CHAIR_NAMES.length] as string)] as Chair;
}

const CELL = 1.6;
const SCALE = 4;
const LEVELS = [0.18, 0.34, 0.52, 0.72, 0.95];

/** Dots as filled arcs: a stroked zero-length path with round caps costs a browser ten times as much to paint. */
function dotPaths(cells: readonly (readonly [number, number, number])[], colour: string, unit: number): string {
  const radii = LEVELS.map((level) => Number(((unit * Math.sqrt(level) * 1.08) / 2).toFixed(1)));
  const runs: string[] = LEVELS.map(() => "");
  for (const [x, y, level] of cells) {
    const radius = radii[level] as number;
    const across = Number((radius * 2).toFixed(1));
    runs[level] += `M${Math.round((x - radius) * 10) / 10} ${y}a${radius} ${radius} 0 1 0 ${across} 0a${radius} ${radius} 0 1 0-${across} 0`;
  }
  return `<g fill="${colour}">${runs.map((run) => (run ? `<path d="${run}"/>` : "")).join("")}</g>`;
}

export interface DrawingOptions {
  /** `ink` for a drawing that carries a tile, `muted` for one that sits behind a sentence. */
  tone?: "ink" | "muted";
  /** When given, the drawing is an image of that name; otherwise it is decoration. */
  label?: string;
}

function frame(width: number, height: number, inner: string, label: string | undefined, extra = ""): string {
  const naming = label === undefined ? `aria-hidden="true"` : `role="img" aria-label="${label.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}"`;
  return `<svg class="dots" viewBox="0 0 ${width} ${height}" ${naming} focusable="false"${extra}>${inner}</svg>`;
}

/**
 * A drawing as an image, for pages with several of them: a browser rasters an image once and keeps it,
 * where thousands of inline dots would be drawn again on every frame of any motion near them.
 */
export function asImage(svg: string): string {
  const [, width, height] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg) ?? [];
  const body = svg.replace(/ (?:aria-hidden|role|aria-label|focusable|class)="[^"]*"/g, "").replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" `).replace(/"/g, "'");
  const source = `data:image/svg+xml,${body.replace(/#/g, "%23").replace(/</g, "%3C").replace(/>/g, "%3E")}`;
  return `<img class="dots" src="${source}" alt="" width="${width}" height="${height}">`;
}

const drawn = new Map<string, string>();

/** A chair as a halftone of tube, slat, seat and back shapes, with the light from the upper left. */
export function chairSvg(seed: string, options: DrawingOptions = {}): string {
  const key = `${seed}|${options.tone ?? "ink"}|${options.label ?? ""}`;
  const known = drawn.get(key);
  if (known !== undefined) return known;
  const salt = seedOf(seed);
  const shapes = chairFor(seed)((salt % 100) / 100);
  const cells: [number, number, number][] = [];
  for (let row = 0; row * CELL <= 100; row += 1) {
    const y = row * CELL;
    for (let column = 0; column * CELL <= 100; column += 1) {
      const x = column * CELL + (row % 2 ? CELL / 2 : 0);
      let tone = 0;
      for (const shape of shapes) if (shape.hit(x, y)) tone = shape.tone(x, y);
      if (tone <= 0) continue;
      const grained = tone + (noise(x, y, salt) - 0.5) * 0.14;
      const level = LEVELS.findIndex((step) => grained <= step);
      const at = level === -1 ? LEVELS.length - 1 : level;
      if (grained >= 0.07) cells.push([Math.round(x * SCALE * 10) / 10, Math.round(y * SCALE * 10) / 10, at]);
    }
  }
  const svg = frame(100 * SCALE, 100 * SCALE, dotPaths(cells, options.tone === "muted" ? MUTED : INK, CELL * SCALE), options.label);
  drawn.set(key, svg);
  return svg;
}

type Field = (x: number, y: number, random: () => number) => number;

/** Each family's grain: how dark a point of the swatch is, from 0 to 1. */
const GRAINS: Record<string, (seed: number) => Field> = {
  aniline: (seed) => {
    const pores = generator(seed);
    const spots = Array.from({ length: 90 }, () => [pores() * 96, pores() * 96, 1.4 + pores() * 2.6] as const);
    return (x, y, random) => {
      const near = spots.some(([sx, sy, size]) => Math.hypot(x - sx, y - sy) < size);
      return near ? 0.62 + random() * 0.3 : 0.1 + random() * 0.14;
    };
  },
  "semi-aniline": (seed) => {
    const pebbles = generator(seed);
    const size = 11 + pebbles() * 7;
    const centres = Array.from({ length: 64 }, (_, index) => [((index % 8) + 0.5) * 12 + (pebbles() - 0.5) * 8, (Math.floor(index / 8) + 0.5) * 12 + (pebbles() - 0.5) * 8] as const);
    return (x, y, random) => {
      const distances = centres.map(([cx, cy]) => Math.hypot(x - cx, y - cy)).sort((a, b) => a - b);
      const seam = (distances[1] as number) - (distances[0] as number);
      return seam < size / 7 ? 0.68 + random() * 0.25 : 0.14 + random() * 0.12;
    };
  },
  "pull-up": (seed) => {
    const creases = generator(seed);
    const slope = 0.3 + creases() * 0.8;
    const gap = 13 + creases() * 11;
    const wave = creases() * 6.28;
    return (x, y, random) => {
      const line = (y + x * slope + Math.sin(x / 13 + wave) * 6) % gap;
      return Math.abs(line) < 2.6 ? 0.72 + random() * 0.22 : 0.22 + (line / gap) * 0.24 + random() * 0.08;
    };
  },
  wool: (seed) => {
    const fibres = generator(seed);
    const drift = 3 + fibres() * 8;
    return (x, y, random) => {
      const tuft = Math.sin(x / drift + fibres() * 0.2) * Math.cos(y / (drift + 2));
      return 0.4 + tuft * 0.2 + (random() - 0.5) * 0.62;
    };
  },
  linen: (seed) => {
    const threads = generator(seed);
    const warp = 5 + Math.floor(threads() * 4);
    const weft = 5 + Math.floor(threads() * 4);
    return (x, y, random) => {
      const thread = Math.round(x) % warp < 2 || Math.round(y) % weft < 2;
      return thread ? 0.56 + random() * 0.3 : 0.08 + random() * 0.1;
    };
  },
};

const FAMILY_NAMES = Object.keys(GRAINS);
const GRAIN_CELL = 3;

function fieldCells(width: number, height: number, cell: number, field: Field, seed: number): { ink: [number, number, number][]; muted: [number, number, number][]; pale: [number, number, number][] } {
  const random = generator(seed);
  const out = { ink: [] as [number, number, number][], muted: [] as [number, number, number][], pale: [] as [number, number, number][] };
  for (let row = 0; row * cell <= height; row += 1) {
    for (let column = 0; column * cell <= width; column += 1) {
      const x = column * cell + (row % 2 ? cell / 2 : 0);
      const y = row * cell;
      const tone = field(x, y, random);
      if (tone < 0.1) continue;
      const level = Math.min(LEVELS.length - 1, Math.max(0, Math.floor(tone * LEVELS.length)));
      const target = tone > 0.62 ? out.ink : tone > 0.34 ? out.muted : out.pale;
      target.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, level]);
    }
  }
  return out;
}

function greys(cells: ReturnType<typeof fieldCells>, unit: number): string {
  return dotPaths(cells.pale, PALE, unit) + dotPaths(cells.muted, MUTED, unit) + dotPaths(cells.ink, INK, unit);
}

/** A swatch: a dot grain in ink, muted and pale greys with no leather colour, told apart by family pattern and code. */
export function grainSvg(code: string, family: string): string {
  const key = `grain|${code}|${family}`;
  const known = drawn.get(key);
  if (known !== undefined) return known;
  const seed = seedOf(code);
  const name = family.toLowerCase();
  const grain = GRAINS[name] ?? (GRAINS[FAMILY_NAMES[seedOf(family) % FAMILY_NAMES.length] as string] as (seed: number) => Field);
  const svg = frame(96, 96, greys(fieldCells(96, 96, GRAIN_CELL, grain(seed), seed), GRAIN_CELL), undefined);
  drawn.set(key, svg);
  return svg;
}

const HIDE_CELL = 4;

/** The hide's grey ground in centimetres, 200 by 240, denser along its belly and spine edges. */
export function hideSvg(seed: string): string {
  const key = `hide|${seed}`;
  const known = drawn.get(key);
  if (known !== undefined) return known;
  const salt = seedOf(seed);
  const field: Field = (x, y, random) => {
    const edge = Math.min(x, 200 - x, y, 240 - y);
    const rim = Math.max(0, 1 - edge / 26);
    const fold = Math.sin(x / 31 + y / 47 + (salt % 7)) * 0.05;
    return 0.16 + rim * 0.34 + fold + (random() - 0.5) * 0.14;
  };
  const svg = frame(200, 240, greys(fieldCells(200, 240, HIDE_CELL, field, salt), HIDE_CELL), undefined, ` preserveAspectRatio="none"`);
  drawn.set(key, svg);
  return svg;
}

const GLYPHS = {
  search: ["..###..", ".#...#.", ".#...#.", ".#...#.", "..###..", ".....#.", "......#"],
  refused: ["...#...", "...#...", "...#...", "...#...", "...#...", ".......", "...#..."],
  check: [".......", "......#", ".....#.", "#...#..", ".#.#...", "..#....", "......."],
  close: ["#.....#", ".#...#.", "..#.#..", "...#...", "..#.#..", ".#...#.", "#.....#"],
  plus: ["...#...", "...#...", "...#...", "#######", "...#...", "...#...", "...#..."],
  more: [".......", ".......", ".......", "#..#..#", ".......", ".......", "......."],
  menu: [".......", "#######", ".......", "#######", ".......", "#######", "......."],
  down: [".......", ".......", "#.....#", ".#...#.", "..#.#..", "...#...", "......."],
  up: [".......", "...#...", "..#.#..", ".#...#.", "#.....#", ".......", "......."],
  left: ["....#..", "...#...", "..#....", ".#.....", "..#....", "...#...", "....#.."],
  right: ["..#....", "...#...", "....#..", ".....#.", "....#..", "...#...", "..#...."],
  rotate: ["..###.#", ".#...##", "#...###", "#......", "#.....#", ".#...#.", "..###.."],
} as const;

type GlyphName = keyof typeof GLYPHS;

/** A 7 by 7 dot glyph in the text's colour, always beside text or inside a named control. */
export function glyph(name: GlyphName, size = 20): string {
  const dots = GLYPHS[name].flatMap((row, y) => [...row].flatMap((cell, x) => (cell === "#" ? [`M${x + 0.5} ${y + 0.5}h0`] : []))).join("");
  return `<svg class="glyph" viewBox="0 0 7 7" width="${size}" height="${size}" aria-hidden="true" focusable="false"><path d="${dots}" fill="none" stroke="currentColor" stroke-width="0.92" stroke-linecap="round"/></svg>`;
}
