// Gallery geometry shared by the 3D scene and the flat drawing. Metres in world space: x east,
// z south, y up. Each wall's offset runs from its left end as seen facing the wall.
export interface WallSpec {
  id: string;
  name: string;
  lengthMm: number;
  heightMm: number;
  plannedLux: number;
}

export interface WorkSpec {
  id: string;
  title: string;
  wallId: string;
  offsetMm: number;
  centreHeightMm: number;
  widthMm: number;
  heightMm: number;
  luxStatus: "within" | "over";
}

export interface WallFrame {
  spec: WallSpec;
  /** left end on the floor, along-wall direction, and the normal pointing into the room (x, z) */
  start: [number, number];
  dir: [number, number];
  normal: [number, number];
  facingYaw: number;
}

export const FACING_YAW: Record<string, number> = { "wall-north": 0, "wall-east": 90, "wall-south": 180, "wall-west": 270 };

/** Lays the four walls around a rectangle: North and South as long as the North wall, East and West as the East wall. */
export function frameWalls(walls: WallSpec[]): WallFrame[] {
  const north = walls.find((w) => w.id === "wall-north");
  const east = walls.find((w) => w.id === "wall-east");
  const hx = (north?.lengthMm ?? 12000) / 2000;
  const hz = (east?.lengthMm ?? 6000) / 2000;
  const layout: Record<string, Omit<WallFrame, "spec">> = {
    "wall-north": { start: [-hx, -hz], dir: [1, 0], normal: [0, 1], facingYaw: 0 },
    "wall-east": { start: [hx, -hz], dir: [0, 1], normal: [-1, 0], facingYaw: 90 },
    "wall-south": { start: [hx, hz], dir: [-1, 0], normal: [0, -1], facingYaw: 180 },
    "wall-west": { start: [-hx, hz], dir: [0, -1], normal: [1, 0], facingYaw: 270 },
  };
  return walls.filter((w) => layout[w.id]).map((spec) => ({ spec, ...layout[spec.id] }));
}

export function roomSize(walls: WallSpec[]): { width: number; depth: number; height: number } {
  const north = walls.find((w) => w.id === "wall-north");
  const east = walls.find((w) => w.id === "wall-east");
  return {
    width: (north?.lengthMm ?? 12000) / 1000,
    depth: (east?.lengthMm ?? 6000) / 1000,
    height: Math.max(...walls.map((w) => w.heightMm), 4000) / 1000,
  };
}

/** A point on a wall's face, in world metres. */
export function wallPoint(frame: WallFrame, offsetMm: number, heightMm: number, inset = 0): [number, number, number] {
  const s = offsetMm / 1000;
  return [
    frame.start[0] + frame.dir[0] * s + frame.normal[0] * inset,
    heightMm / 1000,
    frame.start[1] + frame.dir[1] * s + frame.normal[1] * inset,
  ];
}

/** Pale for low lux, warm for high: the Light view's false-colour tint (0..1 along the ramp). */
function luxRamp(lux: number): number {
  return Math.min(1, Math.max(0, (lux - 20) / 280));
}

const LUX_LOW = [0xed, 0xe9, 0xdf] as const;
const LUX_HIGH = [0xe3, 0x8f, 0x45] as const;

export function luxColour(lux: number): [number, number, number] {
  const t = luxRamp(lux);
  return [0, 1, 2].map((i) => Math.round(LUX_LOW[i] + (LUX_HIGH[i] - LUX_LOW[i]) * t)) as [number, number, number];
}

/** The screen angle of a line from a to b, turned so text along it never reads upside down. */
export function uprightAngle(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return deg > 90 ? deg - 180 : deg <= -90 ? deg + 180 : deg;
}

export function normaliseYaw(yaw: number): number {
  return ((Math.round(yaw) % 360) + 360) % 360;
}

/** Shortest signed turn from one yaw to another, in degrees. */
export function yawDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}
