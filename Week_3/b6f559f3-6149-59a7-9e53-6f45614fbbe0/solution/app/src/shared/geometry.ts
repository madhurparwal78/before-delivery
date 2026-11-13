import { characterRefused, svgPaths, MESSAGES } from './messages';
import { cross, normalise, sub, vec } from './projection';
import type { OutlinePoint, Primitive, Vec3 } from './types';

export interface Mesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Triangle corner indices, or null when the vertices are already listed triangle by triangle. */
  indices: Uint32Array | null;
}

export function meshTriangles(mesh: Mesh): number {
  return (mesh.indices ? mesh.indices.length : mesh.positions.length / 3) / 3;
}

/** Collects triangles listed corner by corner and gives each flat normals. */
class TriangleSoup {
  private readonly corners: number[] = [];

  push(a: Vec3, b: Vec3, c: Vec3): void {
    this.corners.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }

  toMesh(): Mesh {
    const positions = new Float32Array(this.corners);
    const normals = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 9) {
      const read = (o: number): Vec3 => vec(positions[i + o] as number, positions[i + o + 1] as number, positions[i + o + 2] as number);
      const n = normalise(cross(sub(read(3), read(0)), sub(read(6), read(0))));
      for (let k = 0; k < 9; k += 3) {
        normals[i + k] = n.x;
        normals[i + k + 1] = n.y;
        normals[i + k + 2] = n.z;
      }
    }
    return { positions, normals, indices: null };
  }
}

function indexed(positions: number[], normals: number[], indices: number[]): Mesh {
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}

function cubeMesh(): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faces: [Vec3, Vec3, Vec3][] = [
    [vec(0, 0, 1), vec(1, 0, 0), vec(0, 1, 0)],
    [vec(0, 0, -1), vec(-1, 0, 0), vec(0, 1, 0)],
    [vec(1, 0, 0), vec(0, 0, -1), vec(0, 1, 0)],
    [vec(-1, 0, 0), vec(0, 0, 1), vec(0, 1, 0)],
    [vec(0, 1, 0), vec(1, 0, 0), vec(0, 0, -1)],
    [vec(0, -1, 0), vec(1, 0, 0), vec(0, 0, 1)],
  ];
  for (const [n, u, v] of faces) {
    const base = positions.length / 3;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      positions.push((n.x + su * u.x + sv * v.x) * 0.5, (n.y + su * u.y + sv * v.y) * 0.5, (n.z + su * u.z + sv * v.z) * 0.5);
      normals.push(n.x, n.y, n.z);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return indexed(positions, normals, indices);
}

function sphereMesh(radial: number, rings: number, radius: number): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI;
    for (let j = 0; j <= radial; j++) {
      const theta = (j / radial) * Math.PI * 2;
      const n = vec(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      positions.push(n.x * radius, n.y * radius, n.z * radius);
      normals.push(n.x, n.y, n.z);
    }
  }
  const stride = radial + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * stride + j;
      const b = a + stride;
      if (i !== 0) indices.push(a, b, a + 1);
      if (i !== rings - 1) indices.push(a + 1, b, b + 1);
    }
  }
  return indexed(positions, normals, indices);
}

function cylinderMesh(radial: number): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= radial; j++) {
    const theta = (j / radial) * Math.PI * 2;
    const x = Math.cos(theta);
    const z = Math.sin(theta);
    positions.push(x * 0.5, 0.5, z * 0.5, x * 0.5, -0.5, z * 0.5);
    normals.push(x, 0, z, x, 0, z);
  }
  for (let j = 0; j < radial; j++) {
    const a = j * 2;
    indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  for (const [y, ny] of [
    [0.5, 1],
    [-0.5, -1],
  ] as const) {
    const centre = positions.length / 3;
    positions.push(0, y, 0);
    normals.push(0, ny, 0);
    for (let j = 0; j <= radial; j++) {
      const theta = (j / radial) * Math.PI * 2;
      positions.push(Math.cos(theta) * 0.5, y, Math.sin(theta) * 0.5);
      normals.push(0, ny, 0);
    }
    for (let j = 0; j < radial; j++) {
      if (ny > 0) indices.push(centre, centre + j + 2, centre + j + 1);
      else indices.push(centre, centre + j + 1, centre + j + 2);
    }
  }
  return indexed(positions, normals, indices);
}

function torusMesh(radial: number, tubular: number): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const ring = 0.5;
  const tube = 0.15;
  for (let i = 0; i <= radial; i++) {
    const u = (i / radial) * Math.PI * 2;
    for (let j = 0; j <= tubular; j++) {
      const v = (j / tubular) * Math.PI * 2;
      const n = vec(Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v));
      positions.push((ring + tube * Math.cos(v)) * Math.cos(u), (ring + tube * Math.cos(v)) * Math.sin(u), tube * Math.sin(v));
      normals.push(n.x, n.y, n.z);
    }
  }
  const stride = tubular + 1;
  for (let i = 0; i < radial; i++) {
    for (let j = 0; j < tubular; j++) {
      const a = i * stride + j;
      const b = a + stride;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return indexed(positions, normals, indices);
}

function planeMesh(): Mesh {
  return indexed(
    [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
    [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    [0, 1, 2, 0, 2, 3],
  );
}

const primitiveCache = new Map<Primitive, Mesh>();

export function primitiveMesh(primitive: Primitive): Mesh {
  let mesh = primitiveCache.get(primitive);
  if (!mesh) {
    mesh = {
      Cube: cubeMesh,
      Sphere: () => sphereMesh(32, 16, 0.5),
      Cylinder: () => cylinderMesh(32),
      Torus: () => torusMesh(48, 16),
      Plane: planeMesh,
    }[primitive]();
    primitiveCache.set(primitive, mesh);
  }
  return mesh;
}

/** Half extents of a primitive's local bounding box. */
export function primitiveHalfExtents(primitive: Primitive): Vec3 {
  switch (primitive) {
    case 'Torus':
      return vec(0.65, 0.65, 0.15);
    case 'Plane':
      return vec(0.5, 0.5, 0);
    default:
      return vec(0.5, 0.5, 0.5);
  }
}

// ---------------------------------------------------------------- Halation Block font

const GLYPHS: Record<string, string> = {
  A: '010101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  J: '001001001101010',
  K: '101101110101101',
  L: '100100100100111',
  M: '101111111101101',
  N: '110101101101101',
  O: '111101101101111',
  P: '110101110100100',
  Q: '010101101110011',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101101010',
  W: '101101111111101',
  X: '101101010101101',
  Y: '101101010010010',
  Z: '111001010100111',
  '0': '010101101101010',
  '1': '010110010010111',
  '2': '110001010100111',
  '3': '110001010001110',
  '4': '101101111001001',
  '5': '111100110001110',
  '6': '011100110101010',
  '7': '111001010010010',
  '8': '010101010101010',
  '9': '010101011001110',
  '-': '000000111000000',
  '.': '000000000000010',
  '!': '010010010000010',
  ' ': '000000000000000',
};

const CELL_ADVANCE = 0.7;
const CELL_WIDTH = 0.6;

/** The first character outside the font, or null when every character is drawable. */
function unsupportedCharacter(text: string): string | null {
  for (const character of text.toUpperCase()) if (GLYPHS[character] === undefined) return character;
  return null;
}

export function fontRefusal(text: string): string | null {
  const bad = unsupportedCharacter(text);
  return bad === null ? null : characterRefused(bad);
}

interface GlyphCell {
  /** Index of the character within the text, spaces included. */
  character: number;
  outline: OutlinePoint[];
}

export function textWidth(text: string, letterHeight: number): number {
  return letterHeight * (CELL_ADVANCE * text.length - 0.1);
}

/** Every filled cell of the text as its own square outline (top-left, top-right, bottom-right, bottom-left). */
export function textCells(text: string, letterHeight: number): GlyphCell[] {
  const upper = text.toUpperCase();
  const side = 0.2 * letterHeight;
  const cells: GlyphCell[] = [];
  [...upper].forEach((character, index) => {
    const rows = GLYPHS[character] ?? GLYPHS[' '] ?? '';
    const left = -textWidth(upper, letterHeight) / 2 + index * CELL_ADVANCE * letterHeight;
    const top = letterHeight / 2;
    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 3; column++) {
        if (rows[row * 3 + column] !== '1') continue;
        const x = left + column * side;
        const y = top - row * side;
        cells.push({
          character: index,
          outline: [
            [x, y],
            [x + side, y],
            [x + side, y - side],
            [x, y - side],
          ],
        });
      }
    }
  });
  return cells;
}

/** The corners of each non-space glyph cell on the front face, in character order. */
export function glyphCorners(text: string, letterHeight: number): OutlinePoint[] {
  const upper = text.toUpperCase();
  const corners: OutlinePoint[] = [];
  [...upper].forEach((character, index) => {
    if (character === ' ') return;
    const left = -textWidth(upper, letterHeight) / 2 + index * CELL_ADVANCE * letterHeight;
    const top = letterHeight / 2;
    corners.push(
      [left, top],
      [left + CELL_WIDTH * letterHeight, top],
      [left + CELL_WIDTH * letterHeight, top - letterHeight],
      [left, top - letterHeight],
    );
  });
  return corners;
}

// ---------------------------------------------------------------- SVG outline

type OutlineResult = { outline: OutlinePoint[] } | { error: string };

function segmentsCross(a: OutlinePoint, b: OutlinePoint, c: OutlinePoint, d: OutlinePoint): boolean {
  const orient = (p: OutlinePoint, q: OutlinePoint, r: OutlinePoint): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const within = (p: OutlinePoint, q: OutlinePoint, r: OutlinePoint): boolean =>
    Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (
    (d1 === 0 && within(c, d, a)) || (d2 === 0 && within(c, d, b)) || (d3 === 0 && within(a, b, c)) || (d4 === 0 && within(a, b, d))
  );
}

function selfIntersects(points: OutlinePoint[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (segmentsCross(points[i] as OutlinePoint, points[(i + 1) % n] as OutlinePoint, points[j] as OutlinePoint, points[(j + 1) % n] as OutlinePoint))
        return true;
    }
  }
  return false;
}

/** Parses a one-path, straight-line SVG into an outline in layer units, centred, with y flipped. */
export function parseSvgOutline(source: string): OutlineResult {
  if (!/<svg[\s>]/i.test(source)) return { error: MESSAGES.notSvg };
  const paths = source.match(/<path\b[^>]*>/gi) ?? [];
  if (paths.length !== 1) return { error: svgPaths(paths.length) };
  const data = /\sd\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(paths[0] as string);
  const d = data?.[1] ?? data?.[2] ?? '';
  if (/[^MLHVZmlhvz0-9eE.,\s+-]/.test(d)) return { error: MESSAGES.svgCommands };
  const tokens = d.match(/[MLHVZmlhvz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const points: OutlinePoint[] = [];
  let command = '';
  let x = 0;
  let y = 0;
  let index = 0;
  const number = (): number => Number(tokens[index++]);
  const hasNumber = (): boolean => index < tokens.length && !/[A-Za-z]/.test(tokens[index] as string);
  while (index < tokens.length) {
    const token = tokens[index] as string;
    if (/[A-Za-z]/.test(token)) {
      command = token;
      index++;
      if (command === 'Z' || command === 'z') break;
    }
    if (!command) return { error: MESSAGES.svgCommands };
    do {
      const relative = command === command.toLowerCase();
      switch (command.toUpperCase()) {
        case 'M':
        case 'L': {
          const nx = number();
          const ny = number();
          x = relative ? x + nx : nx;
          y = relative ? y + ny : ny;
          break;
        }
        case 'H': {
          const nx = number();
          x = relative ? x + nx : nx;
          break;
        }
        default: {
          const ny = number();
          y = relative ? y + ny : ny;
        }
      }
      points.push([x, y]);
      if (command === 'M') command = 'L';
      if (command === 'm') command = 'l';
    } while (hasNumber());
  }
  const distinct = points.filter((p, i) => i === 0 || p[0] !== (points[i - 1] as OutlinePoint)[0] || p[1] !== (points[i - 1] as OutlinePoint)[1]);
  const first = distinct[0];
  const last = distinct[distinct.length - 1];
  if (first && last && distinct.length > 1 && first[0] === last[0] && first[1] === last[1]) distinct.pop();
  if (distinct.length < 3 || selfIntersects(distinct)) return { error: MESSAGES.svgCrossing };
  const xs = distinct.map((p) => p[0]);
  const ys = distinct.map((p) => p[1]);
  const centreX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centreY = (Math.min(...ys) + Math.max(...ys)) / 2;
  return { outline: distinct.map(([px, py]) => [(px - centreX) / 100, -(py - centreY) / 100] as OutlinePoint) };
}

// ---------------------------------------------------------------- extrusion

export interface ExtrusionShape {
  outlines: OutlinePoint[][];
  depth: number;
  bevelSize: number;
  bevelSegments: number;
}

/** Triangles of one simple polygon of `points` outline points. */
function polygonTriangles(points: number, bevelSize: number, bevelSegments: number): number {
  return 4 * points - 4 + (bevelSize > 0 ? 4 * points * bevelSegments : 0);
}

export function extrusionTriangles(shape: ExtrusionShape): number {
  return shape.outlines.reduce((sum, outline) => sum + polygonTriangles(outline.length, shape.bevelSize, shape.bevelSegments), 0);
}

export interface Box {
  width: number;
  height: number;
  depth: number;
}

export function extrusionBox(width: number, height: number, depth: number, bevelSize: number): Box {
  const grow = bevelSize > 0 ? 2 * bevelSize : 0;
  return { width: width + grow, height: height + grow, depth: depth + grow };
}

function signedArea(points: OutlinePoint[]): number {
  let area = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] as OutlinePoint;
    area += p[0] * q[1] - q[0] * p[1];
  });
  return area / 2;
}

function earClip(points: OutlinePoint[]): [number, number, number][] {
  const order = points.map((_, i) => i);
  if (signedArea(points) < 0) order.reverse();
  const triangles: [number, number, number][] = [];
  const cross2 = (a: OutlinePoint, b: OutlinePoint, c: OutlinePoint): number => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: OutlinePoint, a: OutlinePoint, b: OutlinePoint, c: OutlinePoint): boolean =>
    cross2(a, b, p) >= 0 && cross2(b, c, p) >= 0 && cross2(c, a, p) >= 0;
  let guard = order.length * order.length;
  while (order.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < order.length; i++) {
      const ia = order[(i + order.length - 1) % order.length] as number;
      const ib = order[i] as number;
      const ic = order[(i + 1) % order.length] as number;
      const a = points[ia] as OutlinePoint;
      const b = points[ib] as OutlinePoint;
      const c = points[ic] as OutlinePoint;
      if (cross2(a, b, c) <= 0) continue;
      const blocked = order.some((k) => k !== ia && k !== ib && k !== ic && inside(points[k] as OutlinePoint, a, b, c));
      if (blocked) continue;
      triangles.push([ia, ib, ic]);
      order.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (order.length === 3) triangles.push([order[0] as number, order[1] as number, order[2] as number]);
  return triangles;
}

function offsetOutline(points: OutlinePoint[], distance: number): OutlinePoint[] {
  if (distance === 0) return points;
  const counterClockwise = signedArea(points) > 0;
  const n = points.length;
  return points.map((p, i) => {
    const previous = points[(i + n - 1) % n] as OutlinePoint;
    const next = points[(i + 1) % n] as OutlinePoint;
    const normalOf = (from: OutlinePoint, to: OutlinePoint): OutlinePoint => {
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const l = Math.hypot(dx, dy) || 1;
      return counterClockwise ? [dy / l, -dx / l] : [-dy / l, dx / l];
    };
    const a = normalOf(previous, p);
    const b = normalOf(p, next);
    const mx = a[0] + b[0];
    const my = a[1] + b[1];
    const ml = Math.hypot(mx, my) || 1;
    const miter = Math.min(1 / Math.max((mx / ml) * a[0] + (my / ml) * a[1], 0.4), 2.5);
    return [p[0] + (mx / ml) * distance * miter, p[1] + (my / ml) * distance * miter];
  });
}

/** The renderable mesh of an extrusion: caps, side walls and bevel rings. */
export function extrusionMesh(shape: ExtrusionShape): Mesh {
  const soup = new TriangleSoup();
  const half = shape.depth / 2;
  const bevel = shape.bevelSize;
  const segments = bevel > 0 ? shape.bevelSegments : 0;
  for (const raw of shape.outlines) {
    const outline = signedArea(raw) < 0 ? [...raw].reverse() : raw;
    const rings: { outline: OutlinePoint[]; z: number }[] = [];
    for (let s = 0; s <= segments; s++) {
      const t = segments === 0 ? 0 : s / segments;
      rings.push({ outline: offsetOutline(outline, bevel * Math.sin((t * Math.PI) / 2)), z: half + bevel * Math.cos((t * Math.PI) / 2) });
    }
    const front = rings[0] as { outline: OutlinePoint[]; z: number };
    const sideTop = rings[rings.length - 1] as { outline: OutlinePoint[]; z: number };
    const lift = (p: OutlinePoint, z: number): Vec3 => vec(p[0], p[1], z);
    for (const [a, b, c] of earClip(front.outline)) {
      soup.push(lift(front.outline[a] as OutlinePoint, front.z), lift(front.outline[b] as OutlinePoint, front.z), lift(front.outline[c] as OutlinePoint, front.z));
      soup.push(lift(front.outline[a] as OutlinePoint, -front.z), lift(front.outline[c] as OutlinePoint, -front.z), lift(front.outline[b] as OutlinePoint, -front.z));
    }
    const strip = (upper: { outline: OutlinePoint[]; z: number }, lower: { outline: OutlinePoint[]; z: number }): void => {
      const n = outline.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = lift(upper.outline[i] as OutlinePoint, upper.z);
        const b = lift(upper.outline[j] as OutlinePoint, upper.z);
        const c = lift(lower.outline[j] as OutlinePoint, lower.z);
        const d = lift(lower.outline[i] as OutlinePoint, lower.z);
        soup.push(a, d, b);
        soup.push(b, d, c);
      }
    };
    for (let s = 0; s < segments; s++) {
      const upper = rings[s] as { outline: OutlinePoint[]; z: number };
      const lower = rings[s + 1] as { outline: OutlinePoint[]; z: number };
      strip(upper, lower);
      strip({ outline: lower.outline, z: -lower.z }, { outline: upper.outline, z: -upper.z });
    }
    strip(sideTop, { outline: sideTop.outline, z: -sideTop.z });
  }
  return soup.toMesh();
}

export function boundsOf(mesh: Mesh): { min: Vec3; max: Vec3 } {
  const min = vec(Infinity, Infinity, Infinity);
  const max = vec(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i] as number;
    const y = mesh.positions[i + 1] as number;
    const z = mesh.positions[i + 2] as number;
    min.x = Math.min(min.x, x);
    min.y = Math.min(min.y, y);
    min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x);
    max.y = Math.max(max.y, y);
    max.z = Math.max(max.z, z);
  }
  return { min, max };
}
