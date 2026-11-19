/**
 * Perspective projection of the tower's facade cells, shared by the WebGL scene (which draws the shell) and the
 * DOM grid (which lays the cells over it), so the two always agree.
 */
import { BOTTOM_FLOOR, STACKS, STACK_LETTERS, TOP_FLOOR, type StackLetter } from "../../shared/domain.js";
import { APOTHEM, TOWER_HEIGHT, faceCorners, floorSpan, normalOf, type FaceCorners } from "../../shared/tower-geometry.js";

/** Stack C faces the viewer first. */
export const FRONT_STACK: StackLetter = "C";
const FRONT_BEARING = STACKS[FRONT_STACK].bearing;
const RAD = Math.PI / 180;

/** Faces whose normal points at least this far toward the viewer are drawn and hoverable. */
export const VISIBLE_DOT = 0.25;

/** The camera's distance from the tower's axis, level with mid-height, in world units. */
export const EYE_DISTANCE = 170;

/** Screen scale of a point this far towards the viewer, relative to the plane of a head-on face. */
const perspectiveAt = (depth: number): number => (EYE_DISTANCE - APOTHEM) / (EYE_DISTANCE - depth);

const FACES: readonly FaceCorners[] = faceCorners(1);

export interface ViewFrame {
  /** Pixels per world unit, vertically. */
  readonly scale: number;
  /** Pixels per world unit, horizontally: the tower is drawn wider than it is true so its windows are big enough to use. */
  readonly xScale: number;
  /** Screen position of the tower axis at mid-height. */
  readonly centreX: number;
  readonly centreY: number;
}

/** Room left above the tower for the stack letters and below it for the turn buttons. */
const TOP_ROOM = 24;
const BOTTOM_ROOM = 80;
const MAX_STRETCH = 2.6;
/** Plan width of the three faces turned towards the viewer, in world units. */
const PLAN_WIDTH = 30;

/** Fits the whole tower into a stage of the given size, leaving `reservedRight` pixels clear on the right. */
export const frameFor = (width: number, height: number, reservedRight: number): ViewFrame => {
  const usableWidth = Math.max(80, width - reservedRight);
  const usableHeight = height - TOP_ROOM - BOTTOM_ROOM;
  const scale = usableHeight / TOWER_HEIGHT;
  const xScale = Math.min(scale * MAX_STRETCH, (usableWidth - 40) / PLAN_WIDTH);
  return { scale, xScale, centreX: usableWidth / 2, centreY: TOP_ROOM + usableHeight / 2 };
};

/** Rotation about Y that brings a stack's face to the front. Rotating by theta turns bearing b into b - theta. */
export const rotationFor = (stack: StackLetter): number => (STACKS[stack].bearing - FRONT_BEARING) * RAD;

/** Plan direction from the tower towards the viewer. */
const camera = normalOf(FRONT_BEARING);
/** Screen-right in plan for a viewer looking along -camera. */
const RIGHT = { x: camera.z, z: -camera.x };

const turn = (point: { x: number; z: number }, theta: number): { x: number; z: number } => ({
  x: point.x * Math.cos(theta) + point.z * Math.sin(theta),
  z: -point.x * Math.sin(theta) + point.z * Math.cos(theta),
});

/** Horizontal screen coordinate and perspective scale of a plan point once the tower is turned by theta. */
const project = (point: { x: number; z: number }, theta: number, frame: ViewFrame): { x: number; depthScale: number } => {
  const turned = turn(point, theta);
  const depthScale = perspectiveAt(turned.x * camera.x + turned.z * camera.z);
  return { x: frame.centreX + (turned.x * RIGHT.x + turned.z * RIGHT.z) * frame.xScale * depthScale, depthScale };
};

export interface FaceSpan {
  readonly stack: StackLetter;
  readonly left: number;
  readonly width: number;
  /** Perspective scale at the face's left and right edges on screen. */
  readonly leftScale: number;
  readonly rightScale: number;
  /** 1 when head-on, towards 0 as the face turns edge-on. */
  readonly facing: number;
  readonly visible: boolean;
}

export const faceSpans = (theta: number, frame: ViewFrame): FaceSpan[] =>
  FACES.map((face) => {
    const normal = turn(face.normal, theta);
    const facing = normal.x * camera.x + normal.z * camera.z;
    const a = project(face.start, theta, frame);
    const b = project(face.end, theta, frame);
    const [left, right] = a.x <= b.x ? [a, b] : [b, a];
    return {
      stack: face.stack,
      left: left.x,
      width: right.x - left.x,
      leftScale: left.depthScale,
      rightScale: right.depthScale,
      facing,
      visible: facing > VISIBLE_DOT,
    };
  });

interface RowSpan {
  readonly floor: number;
  readonly top: number;
  readonly height: number;
}

/** Vertical placement of every floor row, 38 down to 3. */
export const rowSpans = (frame: ViewFrame): RowSpan[] => {
  const rows: RowSpan[] = [];
  for (let floor = TOP_FLOOR; floor >= BOTTOM_FLOOR; floor -= 1) {
    const span = floorSpan(floor);
    rows.push({
      floor,
      top: frame.centreY - (span.top - TOWER_HEIGHT / 2) * frame.scale,
      height: (span.top - span.bottom) * frame.scale,
    });
  }
  return rows;
};

export interface CellShape {
  /** Offset from the top of the floor's row. */
  readonly top: number;
  readonly height: number;
  /** Rise of the cell's centre line per pixel across: floors converge away from the eye level. */
  readonly slope: number;
}

/** Where a floor's cell sits on a face, so the DOM cell lies on the quad the scene draws. */
export const cellShape = (span: FaceSpan, row: RowSpan, frame: ViewFrame): CellShape => {
  const middle = row.top + row.height / 2 - frame.centreY;
  const leftCentre = middle * span.leftScale;
  const rightCentre = middle * span.rightScale;
  const height = (row.height * (span.leftScale + span.rightScale)) / 2;
  const centre = frame.centreY + (leftCentre + rightCentre) / 2;
  return { top: centre - height / 2 - row.top, height, slope: (rightCentre - leftCentre) / Math.max(1, span.width) };
};

/** Nearest stack face to the front for a rotation, so a release settles on a face. */
export const nearestStack = (theta: number): StackLetter => {
  let best: StackLetter = FRONT_STACK;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const stack of STACK_LETTERS) {
    const target = rotationFor(stack);
    const distance = Math.abs(Math.atan2(Math.sin(theta - target), Math.cos(theta - target)));
    if (distance < bestDistance) {
      best = stack;
      bestDistance = distance;
    }
  }
  return best;
};

/** Shortest signed turn from one rotation to another. */
export const shortestTurn = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));
