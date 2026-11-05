// Cone ratings and every placement check, decided once and used by the server (authoritative)
// and by the load board (live feedback on the lifted footprint).
//
// Geometry is exact: positions and sizes are whole half-inches ("halves"), and the checks work in
// quarter-inches so circle centres stay integral.

export const CONES = ["06", "04", "02", "6", "10"] as const;
export type Cone = (typeof CONES)[number];
export const GLAZE_CONES: readonly Cone[] = ["06", "6"];

export type Shape = "round" | "rectangular" | "plate";
export type Stage = "bisque" | "glaze";
export type Rotation = 0 | 90 | 180 | 270;
const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/** Largest x or y for a footprint's top-left corner, in halves (23 in). */
export const GRID_MAX_HALVES = 46;

export function isCone(value: unknown): value is Cone {
  return typeof value === "string" && (CONES as readonly string[]).includes(value);
}

/** "9.5", "10" or 9.5 as whole half-inches on the 0 to 23 in grid, or null when it is not on the grid. */
export function gridHalves(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const match = /^(\d+)(?:\.(0+|50*))?$/.exec(text);
  if (!match) return null;
  const halves = Number(match[1]) * 2 + (match[2]?.startsWith("5") ? 1 : 0);
  return halves <= GRID_MAX_HALVES ? halves : null;
}

export function isRotation(value: unknown): value is Rotation {
  return typeof value === "number" && (ROTATIONS as readonly number[]).includes(value);
}

/** A clay is rated for a firing when the firing's cone is at or below the clay's max cone. */
export function clayRatedFor(clayMaxCone: Cone, cone: Cone): boolean {
  return CONES.indexOf(cone) <= CONES.indexOf(clayMaxCone);
}

export interface Footprint {
  shape: Shape;
  /** top-left corner within the shelf's bounding square, halves */
  x: number;
  y: number;
  /** extent along x and y after rotation, halves */
  w: number;
  d: number;
}

export interface SidesHalves {
  length?: number;
  width?: number;
  diameter?: number;
  height: number;
}

/** Round and Plate are circles of their diameter; Rectangular is Length along x at 0° and 180°. */
export function footprintOf(shape: Shape, sides: SidesHalves, rotation: Rotation, x: number, y: number): Footprint {
  if (shape === "rectangular") {
    const length = sides.length ?? 0;
    const width = sides.width ?? 0;
    const turned = rotation === 90 || rotation === 270;
    return { shape, x, y, w: turned ? width : length, d: turned ? length : width };
  }
  const diameter = sides.diameter ?? 0;
  return { shape, x, y, w: diameter, d: diameter };
}

export interface Post {
  /** top-left corner and side, halves */
  x: number;
  y: number;
  size: number;
}

export interface Shelf {
  /** shelf diameter, halves; the shelf circle is centred in its bounding square */
  diameter: number;
  posts: readonly Post[];
  /** post height, halves */
  postHeight: number;
}

export interface PieceForPlacement {
  stage: Stage | null;
  cone: Cone | null;
  clayMaxCone: Cone;
  /** rounded height, halves */
  height: number;
}

interface FiringForPlacement {
  stage: Stage;
  cone: Cone;
}

export interface Neighbour {
  pieceNumber: string;
  footprint: Footprint;
}

export type RefusalReason = "stage" | "clay" | "cone" | "height" | "edge" | "post" | "overlap";

export interface Refusal {
  reason: RefusalReason;
  message: string;
}

/** Clearance above the tallest piece on a layer: 1.0 in. */
export const LAYER_CLEARANCE_HALVES = 2;

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Disc {
  cx: number;
  cy: number;
  r: number;
}

type Solid = { kind: "box"; box: Box } | { kind: "disc"; disc: Disc };

function solidOf(footprint: Footprint): Solid {
  const x = footprint.x * 2;
  const y = footprint.y * 2;
  const w = footprint.w * 2;
  const d = footprint.d * 2;
  if (footprint.shape === "rectangular") return { kind: "box", box: { x1: x, y1: y, x2: x + w, y2: y + d } };
  return { kind: "disc", disc: { cx: x + w / 2, cy: y + w / 2, r: w / 2 } };
}

function postBox(post: Post): Box {
  return { x1: post.x * 2, y1: post.y * 2, x2: (post.x + post.size) * 2, y2: (post.y + post.size) * 2 };
}

function boxesMeet(a: Box, b: Box): boolean {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
}

function discMeetsBox(c: Disc, b: Box): boolean {
  const nearX = Math.min(Math.max(c.cx, b.x1), b.x2);
  const nearY = Math.min(Math.max(c.cy, b.y1), b.y2);
  const dx = c.cx - nearX;
  const dy = c.cy - nearY;
  return dx * dx + dy * dy < c.r * c.r;
}

function interiorsMeet(a: Solid, b: Solid): boolean {
  if (a.kind === "box" && b.kind === "box") return boxesMeet(a.box, b.box);
  if (a.kind === "disc" && b.kind === "disc") {
    const dx = a.disc.cx - b.disc.cx;
    const dy = a.disc.cy - b.disc.cy;
    const reach = a.disc.r + b.disc.r;
    return dx * dx + dy * dy < reach * reach;
  }
  if (a.kind === "disc" && b.kind === "box") return discMeetsBox(a.disc, b.box);
  return a.kind === "box" && b.kind === "disc" && discMeetsBox(b.disc, a.box);
}

function insideShelf(solid: Solid, shelf: Shelf): boolean {
  // In quarter-inches the shelf's radius and its centre coordinate both equal its diameter in halves.
  const radius = shelf.diameter;
  const centre = shelf.diameter;
  const within = (px: number, py: number, room: number) =>
    room >= 0 && (px - centre) * (px - centre) + (py - centre) * (py - centre) <= room * room;
  if (solid.kind === "disc") return within(solid.disc.cx, solid.disc.cy, radius - solid.disc.r);
  const { x1, y1, x2, y2 } = solid.box;
  return within(x1, y1, radius) && within(x2, y1, radius) && within(x1, y2, radius) && within(x2, y2, radius);
}

/** Checks that do not depend on where the footprint sits: stage, clay, cone, height. */
function pieceRefusal(piece: PieceForPlacement, firing: FiringForPlacement, shelf: Shelf): Refusal | null {
  if (piece.stage !== firing.stage) {
    return { reason: "stage", message: `Wrong stage: piece needs ${piece.stage ?? firing.stage} firing` };
  }
  if (!clayRatedFor(piece.clayMaxCone, firing.cone)) {
    return { reason: "clay", message: `Clay not rated for cone ${firing.cone}` };
  }
  if (firing.stage === "glaze" && piece.cone !== firing.cone) {
    return { reason: "cone", message: `Wrong cone: piece is cone ${piece.cone ?? ""}` };
  }
  if (piece.height + LAYER_CLEARANCE_HALVES > shelf.postHeight) {
    return { reason: "height", message: "Too tall for this layer" };
  }
  return null;
}

function positionRefusal(footprint: Footprint, shelf: Shelf, neighbours: readonly Neighbour[]): Refusal | null {
  const solid = solidOf(footprint);
  if (!insideShelf(solid, shelf)) return { reason: "edge", message: "Past shelf edge" };
  if (shelf.posts.some((post) => interiorsMeet(solid, { kind: "box", box: postBox(post) }))) {
    return { reason: "post", message: "Overlaps post" };
  }
  const hit = neighbours
    .filter((n) => interiorsMeet(solid, solidOf(n.footprint)))
    .map((n) => n.pieceNumber)
    .sort()[0];
  return hit === undefined ? null : { reason: "overlap", message: `Overlaps Piece ${hit}` };
}

/**
 * The placement checks in their order; the first failure is the only one reported.
 * `neighbours` are the other footprints on the same layer (never the piece itself).
 */
export function checkPlacement(
  piece: PieceForPlacement,
  firing: FiringForPlacement,
  shelf: Shelf,
  footprint: Footprint,
  neighbours: readonly Neighbour[],
): Refusal | null {
  return pieceRefusal(piece, firing, shelf) ?? positionRefusal(footprint, shelf, neighbours);
}

/**
 * Where a picked footprint starts: the first clear position scanning rows top to bottom and left to
 * right in half-inch steps, or the top-left of the bounding square when no position is clear.
 */
export function firstClearPosition(
  piece: PieceForPlacement,
  firing: FiringForPlacement,
  shelf: Shelf,
  place: (x: number, y: number) => Footprint,
  neighbours: readonly Neighbour[],
): { x: number; y: number } {
  if (pieceRefusal(piece, firing, shelf) === null) {
    for (let y = 0; y <= GRID_MAX_HALVES; y += 1) {
      for (let x = 0; x <= GRID_MAX_HALVES; x += 1) {
        if (positionRefusal(place(x, y), shelf, neighbours) === null) return { x, y };
      }
    }
  }
  return { x: 0, y: 0 };
}
