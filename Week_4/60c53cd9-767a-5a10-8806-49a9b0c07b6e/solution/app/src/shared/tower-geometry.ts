/**
 * The tower's plan, shared by the seed generator (which writes the models) and the browser (which places the
 * grid cells over the drawn facade). Model axes: north is -Z, east is +X, up is +Y.
 */
import { STACK_LETTERS, STACKS, type StackLetter } from "./domain.js";

export const APOTHEM = 12;
export const STOREY_HEIGHT = 3;
const PODIUM_STOREYS = 2;
export const PODIUM_SCALE = 1.45;
export const TOWER_HEIGHT = STOREY_HEIGHT * 38;
export const PODIUM_HEIGHT = STOREY_HEIGHT * PODIUM_STOREYS;

interface Point2 {
  readonly x: number;
  readonly z: number;
}

/** Outward unit normal of the face for a compass bearing (north -Z, east +X). */
export const normalOf = (bearingDegrees: number): Point2 => {
  const radians = (bearingDegrees * Math.PI) / 180;
  return { x: Math.sin(radians), z: -Math.cos(radians) };
};

/** Vertex shared by the faces of two neighbouring stacks, given the plan's apothem. */
const meet = (a: Point2, b: Point2, apothem: number): Point2 => {
  const determinant = a.x * b.z - a.z * b.x;
  return { x: (apothem * (b.z - a.z)) / determinant, z: (apothem * (a.x - b.x)) / determinant };
};

/** The eight plan vertices; vertex i is the corner between stack i-1 and stack i. */
export const planVertices = (scale = 1): Point2[] =>
  STACK_LETTERS.map((_, index) => {
    const previous = STACK_LETTERS[(index + 7) % 8] as StackLetter;
    const current = STACK_LETTERS[index] as StackLetter;
    return meet(normalOf(STACKS[previous].bearing), normalOf(STACKS[current].bearing), APOTHEM * scale);
  });

export interface FaceCorners {
  readonly stack: StackLetter;
  readonly start: Point2;
  readonly end: Point2;
  readonly normal: Point2;
}

export const faceCorners = (scale = 1): FaceCorners[] => {
  const vertices = planVertices(scale);
  return STACK_LETTERS.map((stack, index) => ({
    stack,
    start: vertices[index] as Point2,
    end: vertices[(index + 1) % 8] as Point2,
    normal: normalOf(STACKS[stack].bearing),
  }));
};

/** Vertical extent of a residential floor's cells (floor 3 sits above the two podium storeys). */
export const floorSpan = (floor: number): { bottom: number; top: number } => ({
  bottom: (floor - 1) * STOREY_HEIGHT,
  top: floor * STOREY_HEIGHT,
});
