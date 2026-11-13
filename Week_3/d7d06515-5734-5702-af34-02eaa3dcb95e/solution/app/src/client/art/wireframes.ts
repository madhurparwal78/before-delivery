// The roof shell wireframes and the selection-grip constellations, generated from a few parameters.
import { closed, lerp, lerpPoint, line, offsetQuad, polyline, quad, quadAt, round, seeded, type Point, type Stroke } from './geometry.ts';

export const HERO_VIEW = { width: 1440, height: 900 } as const;
export const CALLOUT_VIEW = { width: 1440, height: 640 } as const;

/** Control point that bows the curve a to b away from its chord, toward the top of the screen. */
function bow(a: Point, b: Point, amount: number): Point {
  const mid = lerpPoint(a, b, 0.5);
  const up = b[0] < a[0] ? -1 : 1;
  return [mid[0] + up * (b[1] - a[1]) * amount, mid[1] - up * (b[0] - a[0]) * amount];
}

/** Hatch lines across a quadrilateral: each joins the same fraction of its top and bottom sides, so none leave the outline. */
function hatch(tl: Point, tr: Point, bl: Point, br: Point, count: number): Stroke[] {
  const strokes: Stroke[] = [];
  for (let i = 1; i < count; i += 1) {
    const t = i / count;
    strokes.push({ d: line(lerpPoint(tl, tr, t), lerpPoint(bl, br, t)) });
  }
  return strokes;
}

/**
 * Hero backdrop: a ribbed roof shell that rises from an apex just over the preview's top edge, with the latitude
 * lines that tie the ribs together, and closed oblique ground planes lower left and lower right. Nothing is drawn
 * behind the device preview or the headline; every rib end carries a grip.
 */
export function heroShell(): Stroke[] {
  const strokes: Stroke[] = [];
  const apex: Point = [1010, 372];
  const ribs: { a: Point; c: Point; b: Point }[] = [];
  const count = 15;
  for (let i = 0; i < count; i += 1) {
    const angle = (lerp(142, 4, i / (count - 1)) * Math.PI) / 180;
    const reach = 1 + 0.16 * Math.sin((i / (count - 1)) * Math.PI);
    const b: Point = [apex[0] + 500 * reach * Math.cos(angle), apex[1] - 380 * reach * Math.sin(angle)];
    ribs.push({ a: apex, c: bow(apex, b, lerp(0.16, 0.06, i / (count - 1))), b });
  }
  for (const { a, c, b } of ribs) strokes.push({ d: quad(a, c, b), ...(b[0] < 1425 ? { grip: b } : {}) });

  for (const along of [0.34, 0.56, 0.76, 0.92]) {
    const points: Point[] = ribs.map(({ a, c, b }) => quadAt(a, c, b, along));
    strokes.push({ d: polyline(points) });
  }

  const nearLeft: Point[] = [[20, 842], [340, 826], [380, 882], [60, 898]];
  const nearMid: Point[] = [[340, 826], [640, 836], [700, 894], [380, 882]];
  const farRight: Point[] = [[840, 898], [1130, 848], [1440, 832], [1440, 900]];
  for (const plane of [nearLeft, nearMid, farRight]) strokes.push({ d: closed(plane) });
  const [tl, tr, br, bl] = nearLeft as [Point, Point, Point, Point];
  strokes.push(...hatch(tl, tr, bl, br, 11));
  strokes.push({ d: line([1130, 848], [1160, 900]) });
  strokes.push({ d: line([1286, 838], [1310, 900]) });
  return strokes;
}

/**
 * Callout backdrop, drawn to fill the whole section: two fans of offset curves rising from apexes at the base
 * (a right fan and a left lobe), parallel strands of the same curves, hatched rib bays and base lines. Static.
 */
export function calloutShell(): Stroke[] {
  const strokes: Stroke[] = [];
  const { width, height } = CALLOUT_VIEW;
  const base = height - 22;

  const fan = (apex: Point, ends: Point[], amount: number): { a: Point; c: Point; b: Point }[] =>
    ends.map((b, i) => ({ a: apex, c: bow(apex, b, lerp(amount, amount * 0.4, i / (ends.length - 1))), b }));

  const rightEnds: Point[] = Array.from({ length: 15 }, (_, i): Point => [width + 10 - i * 12, 10 + i * 44]);
  const leftEnds: Point[] = Array.from({ length: 13 }, (_, i): Point => [-10 + i * 12, 20 + i * 48]);
  const right = fan([540, base], rightEnds, 0.2);
  const left = fan([900, base], leftEnds, -0.2);
  for (const rib of [...right, ...left]) strokes.push({ d: quad(rib.a, rib.c, rib.b) });

  // Strands: the outer ribs of each fan repeated as parallel offsets, so the shell reads as a surface and not a few lines.
  for (const rib of [right[0], right[right.length - 1], left[0], left[left.length - 1]]) {
    if (!rib) continue;
    for (let k = 1; k <= 4; k += 1) {
      const [a, c, b] = offsetQuad(rib.a, rib.c, rib.b, (rib === right[0] || rib === left[0] ? -1 : 1) * k * 11);
      strokes.push({ d: quad(a, c, b) });
    }
  }

  // Rib bays: rungs between neighbouring ribs, only along the part of the bay that is clear of the card.
  const bays: [typeof right, number, number, number][] = [[right, 2, 0.58, 0.94], [right, 8, 0.52, 0.9], [left, 3, 0.58, 0.94], [left, 8, 0.5, 0.88]];
  for (const [family, index, from, to] of bays) {
    const one = family[index];
    const next = family[index + 1];
    if (!one || !next) continue;
    const rungs = 9;
    for (let i = 0; i <= rungs; i += 1) {
      const t = lerp(from, to, i / rungs);
      strokes.push({ d: line(quadAt(one.a, one.c, one.b, t), quadAt(next.a, next.c, next.b, t)) });
    }
  }

  // Base lines: the ground the shell stands on, receding toward the apexes, with short ties between them.
  for (let i = 0; i < 5; i += 1) strokes.push({ d: line([0, base - 8 + i * 6], [width, base - 8 + i * 6 + (i - 2) * 2]) });
  for (let i = 0; i < 18; i += 1) {
    const x = 40 + i * 14;
    strokes.push({ d: line([x, base - 40], [x, base - 8]) });
  }
  for (let i = 0; i < 12; i += 1) {
    const x = width - 280 + i * 14;
    strokes.push({ d: line([x, base - 56 + i * 2], [x, base - 8]) });
  }
  return strokes;
}

interface ConstellationShape {
  seed: number;
  width: number;
  height: number;
  hub: Point;
  /** Fan directions in degrees, counter-clockwise from +X in screen space (y down is positive). */
  from: number;
  to: number;
  nodes: number;
  /** Shortest and longest spoke in viewBox units; by default spokes run up to three quarters of the box diagonal. */
  reach?: readonly [number, number];
}

/** Thin lines from a hub to square grip nodes, with a few cross links. */
export function constellation(shape: ConstellationShape): { strokes: Stroke[]; width: number; height: number } {
  const random = seeded(shape.seed);
  const nodes: Point[] = [];
  const margin = 10;
  for (let i = 0; i < shape.nodes; i += 1) {
    const angle = (lerp(shape.from, shape.to, (i + random() * 0.5) / shape.nodes) * Math.PI) / 180;
    const [near, far] = shape.reach ?? [0.35 * 0.75 * Math.hypot(shape.width, shape.height), 0.75 * Math.hypot(shape.width, shape.height)];
    const reach = lerp(near, far, random());
    const x = Math.min(shape.width - margin, Math.max(margin, shape.hub[0] + Math.cos(angle) * reach));
    const y = Math.min(shape.height - margin, Math.max(margin, shape.hub[1] + Math.sin(angle) * reach));
    nodes.push([round(x), round(y)]);
  }
  const strokes: Stroke[] = nodes.map((node) => ({ d: line(shape.hub, node), grip: node }));
  for (let i = 0; i + 1 < nodes.length; i += 2) {
    const a = nodes[i];
    const b = nodes[i + 1];
    if (a && b) strokes.push({ d: line(a, b) });
  }
  return { strokes, width: shape.width, height: shape.height };
}
