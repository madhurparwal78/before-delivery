// Pure perspective maths shared by the WebGL scene, the SVG panel and the published screen rectangles.
import { FRONT_BOX, PANEL_GEOMETRY, STICKER_TILT_DEG, type PackSpec, type Point, type Rect } from "./spec";
import type { Format } from "../../shared/types";

export interface View {
  /** pixel centre of the pack in the viewport */
  cx: number;
  cy: number;
  /** focal length in pixels */
  focal: number;
  camZ: number;
  yawDeg: number;
}

const RAD = Math.PI / 180;

/** model point (group space, y up) to viewport pixels. */
export function projectModel(view: View, x: number, y: number, z: number): Point {
  const t = view.yawDeg * RAD;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const xr = x * c + z * s;
  const zr = -x * s + z * c;
  const d = view.camZ - zr;
  return [view.cx + (view.focal * xr) / d, view.cy - (view.focal * y) / d];
}

export const depthOf = (view: View, x: number, z: number): number => {
  const t = view.yawDeg * RAD;
  return view.camZ - (-x * Math.sin(t) + z * Math.cos(t));
};

/** focal length that gives the front face `heightPx` pixels at camera distance 6. */
export const focalFor = (spec: PackSpec, heightPx: number): number => (heightPx * (6 - spec.depth / 2)) / spec.height;

export type Face = "front" | "back";

/** face coordinates (u across, v down; both 0..1 of the face) to model space. */
function facePoint(spec: PackSpec, face: Face, u: number, v: number, lift = 0): [number, number, number] {
  const y = (0.5 - v) * spec.height;
  if (face === "front") return [(u - 0.5) * spec.width, y, spec.depth / 2 + lift];
  return [-(u - 0.5) * spec.width, y, -spec.depth / 2 - lift];
}

export const projectFace = (view: View, spec: PackSpec, face: Face, u: number, v: number, lift = 0): Point => {
  const [x, y, z] = facePoint(spec, face, u, v, lift);
  return projectModel(view, x, y, z);
};

export const facing = (yawDeg: number): Face | null => {
  const c = Math.cos(yawDeg * RAD);
  if (Math.abs(c) < 1e-6) return null;
  return c > 0 ? "front" : "back";
};

function bounds(points: Point[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1 - x0, y1 - y0];
}

const faceRect = (view: View, spec: PackSpec, face: Face, r: Rect): Point[] => [
  projectFace(view, spec, face, r[0], r[1]),
  projectFace(view, spec, face, r[0] + r[2], r[1]),
  projectFace(view, spec, face, r[0] + r[2], r[1] + r[3]),
  projectFace(view, spec, face, r[0], r[1] + r[3]),
];

/** bounding box of the whole pack as it would be drawn now. */
export function packRect(view: View, spec: PackSpec): Rect {
  const pts: Point[] = [];
  for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5])
    pts.push(projectModel(view, sx * spec.width, sy * spec.height, sz * spec.depth));
  return bounds(pts);
}

export const panelRect = (view: View, spec: PackSpec): Rect | null =>
  view.yawDeg > 90 ? bounds(faceRect(view, spec, "back", [0, 0, 1, 1])) : null;
export const frontRect = (view: View, spec: PackSpec): Rect | null =>
  view.yawDeg < 90 ? bounds(faceRect(view, spec, "front", FRONT_BOX)) : null;
export const mrpRect = (view: View, spec: PackSpec): Rect | null =>
  view.yawDeg > 90 ? bounds(faceRect(view, spec, "back", PANEL_GEOMETRY[spec.format].mrp)) : null;

/** Sticker flight in panel coordinates: the centre as a fraction of the way from off the panel to the seat. */
const FLIGHT_START = 0.55;
const FLIGHT_END = 0.75;
const flightFraction = (progress: number): number => Math.min(1, Math.max(0, (progress - FLIGHT_START) / (FLIGHT_END - FLIGHT_START)));

interface StickerPose {
  /** centre in face fractions */
  cx: number;
  cy: number;
  widthWorld: number;
  heightWorld: number;
  tiltDeg: number;
}

export function stickerPose(spec: PackSpec, format: Format, progress: number): StickerPose {
  const [x, y, w, h] = PANEL_GEOMETRY[format].sticker;
  const seatX = x + w / 2;
  const startX = seatX + 0.85;
  const t = flightFraction(progress);
  return {
    cx: startX + (seatX - startX) * t,
    cy: y + h / 2,
    widthWorld: w * spec.width,
    heightWorld: h * spec.height,
    tiltDeg: STICKER_TILT_DEG,
  };
}

/** Corners (TL, TR, BR, BL) of the tilted sticker in the back face's local frame (x right, y up), in world units. */
function stickerLocalCorners(spec: PackSpec, pose: StickerPose): Array<[number, number]> {
  const cx = (pose.cx - 0.5) * spec.width;
  const cy = (0.5 - pose.cy) * spec.height;
  const a = -pose.tiltDeg * RAD; // the brief's -4 degrees is clockwise-negative in panel (y down) terms: top edge rises to the right
  const co = Math.cos(a);
  const si = Math.sin(a);
  const hw = pose.widthWorld / 2;
  const hh = pose.heightWorld / 2;
  return ([[-hw, hh], [hw, hh], [hw, -hh], [-hw, -hh]] as Array<[number, number]>).map(([dx, dy]) => [
    cx + dx * co - dy * si,
    cy + dx * si + dy * co,
  ]);
}

export function stickerQuad(view: View, spec: PackSpec, pose: StickerPose): Point[] {
  return stickerLocalCorners(spec, pose).map(([lx, ly]) => {
    // back face local frame: x right as seen from behind => model x = -lx
    return projectModel(view, -lx, ly, -spec.depth / 2 - 0.004);
  });
}
