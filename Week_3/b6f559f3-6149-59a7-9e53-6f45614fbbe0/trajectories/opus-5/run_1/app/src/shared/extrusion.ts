import { MSG, copy } from './messages';
import {
  filledCellCount,
  textCells,
  textGlyphCellBoxes,
  textOutlineWidth,
  unsupportedCharacter,
  GLYPH_CELL_HEIGHT,
} from './font';
import type { Mesh } from './math3d';
import { vec } from './math3d';
import type { Vec3 } from './types';

export interface ExtrusionBounds {
  width: number;
  height: number;
  depth: number;
}

export interface Outline {
  points: { x: number; y: number }[];
}

export function squareTriangles(bevelSize: number, bevelSegments: number): number {
  return bevelSize > 0 ? 12 + 16 * bevelSegments : 12;
}

export function outlineTriangles(
  pointCount: number,
  bevelSize: number,
  bevelSegments: number,
): number {
  const base = 4 * pointCount - 4;
  return bevelSize > 0 ? base + 4 * pointCount * bevelSegments : base;
}

function grow(value: number, bevelSize: number): number {
  return bevelSize > 0 ? value + 2 * bevelSize : value;
}

export function textBounds(
  text: string,
  letterHeight: number,
  depth: number,
  bevelSize: number,
): ExtrusionBounds {
  return {
    width: grow(textOutlineWidth(text, letterHeight), bevelSize),
    height: grow(GLYPH_CELL_HEIGHT * letterHeight, bevelSize),
    depth: grow(depth, bevelSize),
  };
}

export function textTriangles(
  text: string,
  bevelSize: number,
  bevelSegments: number,
): number {
  return filledCellCount(text) * squareTriangles(bevelSize, bevelSegments);
}

export function outlineBounds(
  outline: Outline,
  depth: number,
  bevelSize: number,
): ExtrusionBounds {
  const xs = outline.points.map((p) => p.x);
  const ys = outline.points.map((p) => p.y);
  return {
    width: grow(Math.max(...xs) - Math.min(...xs), bevelSize),
    height: grow(Math.max(...ys) - Math.min(...ys), bevelSize),
    depth: grow(depth, bevelSize),
  };
}

/** Front face z for an extrusion. */
export function frontFaceZ(depth: number, bevelSize: number): number {
  return depth / 2 + bevelSize;
}

export function textFormationPoints(
  text: string,
  letterHeight: number,
  depth: number,
  bevelSize: number,
): Vec3[] {
  const z = frontFaceZ(depth, bevelSize);
  const points: Vec3[] = [];
  for (const box of textGlyphCellBoxes(text, letterHeight)) {
    points.push(vec(box.left, box.top, z));
    points.push(vec(box.right, box.top, z));
    points.push(vec(box.right, box.bottom, z));
    points.push(vec(box.left, box.bottom, z));
  }
  return points;
}

export function outlineFormationPoints(
  outline: Outline,
  depth: number,
  bevelSize: number,
): Vec3[] {
  const z = frontFaceZ(depth, bevelSize);
  return outline.points.map((p) => vec(p.x, p.y, z));
}

/** Builds the extruded mesh for text, one square outline per filled cell. */
export function textMesh(text: string, letterHeight: number, depth: number, bevelSize: number): Mesh {
  const mesh: Mesh = { positions: [], indices: [] };
  const front = frontFaceZ(depth, bevelSize);
  const back = -front;
  for (const cell of textCells(text, letterHeight)) {
    addBox(mesh, cell.left, cell.left + cell.size, cell.top - cell.size, cell.top, back, front);
  }
  return mesh;
}

export function outlineMesh(outline: Outline, depth: number, bevelSize: number): Mesh {
  const mesh: Mesh = { positions: [], indices: [] };
  const front = frontFaceZ(depth, bevelSize);
  const back = -front;
  const base = mesh.positions.length / 3;
  for (const point of outline.points) {
    mesh.positions.push(point.x, point.y, front);
  }
  for (const point of outline.points) {
    mesh.positions.push(point.x, point.y, back);
  }
  const count = outline.points.length;
  for (let i = 1; i < count - 1; i += 1) {
    mesh.indices.push(base, base + i, base + i + 1);
    mesh.indices.push(base + count, base + count + i + 1, base + count + i);
  }
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    mesh.indices.push(base + i, base + next, base + count + next);
    mesh.indices.push(base + i, base + count + next, base + count + i);
  }
  return mesh;
}

function addBox(
  mesh: Mesh,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
): void {
  const base = mesh.positions.length / 3;
  const corners: [number, number, number][] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  for (const c of corners) mesh.positions.push(c[0], c[1], c[2]);
  const faces = [
    [4, 5, 6, 7],
    [1, 0, 3, 2],
    [0, 4, 7, 3],
    [5, 1, 2, 6],
    [3, 7, 6, 2],
    [0, 1, 5, 4],
  ];
  for (const face of faces) {
    mesh.indices.push(base + face[0], base + face[1], base + face[2]);
    mesh.indices.push(base + face[0], base + face[2], base + face[3]);
  }
}

export interface SvgParseResult {
  outline: Outline | null;
  refusal: string | null;
}

const PATH_TAG = /<path\b[^>]*>/gi;
const D_ATTRIBUTE = /\sd\s*=\s*("([^"]*)"|'([^']*)')/i;

export function parseSvgOutline(source: string): SvgParseResult {
  if (!/<svg[\s>]/i.test(source)) return { outline: null, refusal: MSG.svgNotSvg };
  const paths = source.match(PATH_TAG) ?? [];
  if (paths.length !== 1) {
    return { outline: null, refusal: copy.svgPathCount(paths.length) };
  }
  const match = D_ATTRIBUTE.exec(paths[0]);
  const d = (match?.[2] ?? match?.[3] ?? '').trim();
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const allowed = new Set(['M', 'm', 'L', 'l', 'H', 'h', 'V', 'v', 'Z', 'z']);
  const points: { x: number; y: number }[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let command = '';
  let index = 0;
  const readNumber = (): number => Number(tokens[index++]);
  while (index < tokens.length) {
    const token = tokens[index];
    if (/^[a-zA-Z]$/.test(token)) {
      if (!allowed.has(token)) return { outline: null, refusal: MSG.svgStraightOnly };
      command = token;
      index += 1;
      if (command === 'Z' || command === 'z') continue;
    }
    if (command === '') return { outline: null, refusal: MSG.svgStraightOnly };
    if (command === 'M' || command === 'L') {
      cursorX = readNumber();
      cursorY = readNumber();
    } else if (command === 'm' || command === 'l') {
      cursorX += readNumber();
      cursorY += readNumber();
    } else if (command === 'H') {
      cursorX = readNumber();
    } else if (command === 'h') {
      cursorX += readNumber();
    } else if (command === 'V') {
      cursorY = readNumber();
    } else if (command === 'v') {
      cursorY += readNumber();
    } else {
      return { outline: null, refusal: MSG.svgStraightOnly };
    }
    points.push({ x: cursorX, y: cursorY });
    if (command === 'M') command = 'L';
    if (command === 'm') command = 'l';
  }
  if (points.length < 3) return { outline: null, refusal: MSG.svgStraightOnly };
  const last = points[points.length - 1];
  const first = points[0];
  if (points.length > 3 && Math.abs(last.x - first.x) < 1e-9 && Math.abs(last.y - first.y) < 1e-9) {
    points.pop();
  }
  const scaled = points.map((p) => ({ x: p.x / 100, y: -p.y / 100 }));
  const xs = scaled.map((p) => p.x);
  const ys = scaled.map((p) => p.y);
  const centreX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centreY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const centred = scaled.map((p) => ({ x: p.x - centreX, y: p.y - centreY }));
  if (selfCrossing(centred)) return { outline: null, refusal: MSG.svgSelfCrossing };
  return { outline: { points: centred }, refusal: null };
}

function selfCrossing(points: { x: number; y: number }[]): boolean {
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const a1 = points[i];
    const a2 = points[(i + 1) % count];
    for (let j = i + 1; j < count; j += 1) {
      if (j === i || (j + 1) % count === i || j === (i + 1) % count) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % count];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

type Point = { x: number; y: number };

function orientation(a: Point, b: Point, c: Point): number {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-12) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return (
    b.x <= Math.max(a.x, c.x) + 1e-12 &&
    b.x >= Math.min(a.x, c.x) - 1e-12 &&
    b.y <= Math.max(a.y, c.y) + 1e-12 &&
    b.y >= Math.min(a.y, c.y) - 1e-12
  );
}

function segmentsIntersect(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

export function textRefusal(text: string): string | null {
  const character = unsupportedCharacter(text);
  return character === null ? null : copy.notInFont(character);
}
