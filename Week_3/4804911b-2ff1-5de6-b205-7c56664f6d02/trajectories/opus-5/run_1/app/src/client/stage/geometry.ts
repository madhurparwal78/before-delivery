export type PackFormat = 'carton' | 'pet' | 'glass' | 'can';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The published pack panel geometry, in panel coordinates from 0 to 1. */
export const PANEL_GEOMETRY: Record<PackFormat, { mrp: Rect; sticker: Rect }> = {
  carton: { mrp: { x: 0.08, y: 0.3, w: 0.4, h: 0.16 }, sticker: { x: 0.54, y: 0.28, w: 0.38, h: 0.22 } },
  pet: { mrp: { x: 0.1, y: 0.42, w: 0.36, h: 0.14 }, sticker: { x: 0.52, y: 0.4, w: 0.38, h: 0.2 } },
  glass: { mrp: { x: 0.12, y: 0.48, w: 0.34, h: 0.14 }, sticker: { x: 0.52, y: 0.46, w: 0.36, h: 0.2 } },
  can: { mrp: { x: 0.1, y: 0.36, w: 0.36, h: 0.14 }, sticker: { x: 0.5, y: 0.34, w: 0.4, h: 0.2 } },
};

export const FRONT_BOX: Rect = { x: 0.1, y: 0.18, w: 0.8, h: 0.44 };
export const GRAIN_STRIP: Rect = { x: 0.1, y: 0.76, w: 0.8, h: 0.14 };

export const PACK_SIZES: Record<PackFormat, { w: number; h: number; d: number; neck: number }> = {
  carton: { w: 0.92, h: 1.6, d: 0.92, neck: 0 },
  pet: { w: 0.86, h: 1.66, d: 0.86, neck: 0.34 },
  glass: { w: 0.8, h: 1.56, d: 0.8, neck: 0.3 },
  can: { w: 0.86, h: 1.34, d: 0.86, neck: 0 },
};

export const CAMERA_FAR = 6;
export const CAMERA_NEAR = 3.2;
export const TURN_END = 0.55;
export const SEAT_AT = 0.75;
/** The seated sticker's tilt, so its top edge rises to the right by 4 degrees on screen. */
export const STICKER_TILT_DEGREES = 4;

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function yawFor(progress: number): number {
  return progress >= TURN_END ? 180 : (clamp01(progress) / TURN_END) * 180;
}

export function cameraFor(progress: number): number {
  if (progress <= SEAT_AT) return CAMERA_FAR;
  const run = (clamp01(progress) - SEAT_AT) / (1 - SEAT_AT);
  return CAMERA_FAR + run * (CAMERA_NEAR - CAMERA_FAR);
}

export function stickerIsSeated(progress: number): boolean {
  return progress >= SEAT_AT;
}

/**
 * 0 when the sticker leaves its off-panel start, 1 when it is seated. A scroll
 * offset that lands a hair under 0.55 still counts as the start of the flight.
 */
export function flightProgress(progress: number): number {
  if (progress < TURN_END - 0.002) return -1;
  if (progress >= SEAT_AT) return 1;
  return clamp01((progress - TURN_END) / (SEAT_AT - TURN_END));
}

export function sliderValueText(progress: number): string {
  if (progress < 0.275) return 'Front of the pack';
  if (progress < 0.55) return 'Turning to the panel';
  if (progress < 0.75) return 'Declaration panel';
  return 'Close on the panel';
}

export interface Camera {
  yawDegrees: number;
  cameraZ: number;
  scale: number;
  centreX: number;
  centreY: number;
}

export interface Projected extends Point {
  depth: number;
}

export function project(camera: Camera, x: number, y: number, z: number): Projected {
  const angle = (camera.yawDegrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rotatedX = x * cos + z * sin;
  const rotatedZ = -x * sin + z * cos;
  const depth = Math.max(0.2, camera.cameraZ - rotatedZ);
  return {
    x: camera.centreX + (camera.scale * rotatedX) / depth,
    y: camera.centreY - (camera.scale * y) / depth,
    depth,
  };
}

export interface PackSpacePoint {
  x: number;
  y: number;
  z: number;
}

/** A point of the declaration panel, which is the pack's back face. */
export function panelPoint(format: PackFormat, u: number, v: number): PackSpacePoint {
  const size = PACK_SIZES[format];
  return { x: size.w / 2 - u * size.w, y: size.h / 2 - v * size.h, z: -size.d / 2 };
}

export function frontPoint(format: PackFormat, u: number, v: number): PackSpacePoint {
  const size = PACK_SIZES[format];
  return { x: -size.w / 2 + u * size.w, y: size.h / 2 - v * size.h, z: size.d / 2 };
}

export function boundingRect(points: Point[]): Rect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top };
}

export function rectCorners(rect: Rect): Point[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
}

/** The sticker's corners in panel coordinates: inset, tilted, and flown in from the right. */
export function stickerPanelQuad(format: PackFormat, progress: number): Point[] | null {
  const flight = flightProgress(progress);
  if (flight < 0) return null;
  const rect = PANEL_GEOMETRY[format].sticker;
  const inset = 0.012;
  const seat: Rect = {
    x: rect.x + inset,
    y: rect.y + inset,
    w: rect.w - inset * 2,
    h: rect.h - inset * 2,
  };
  const centre = { x: seat.x + seat.w / 2, y: seat.y + seat.h / 2 };
  const start = { x: 1.55, y: centre.y };
  const nowCentre = {
    x: start.x + flight * (centre.x - start.x),
    y: start.y + flight * (centre.y - start.y),
  };
  // The panel's own coordinates are normalised per axis, so the tilt is corrected
  // by the panel's aspect to land as 4 degrees on screen.
  const size = PACK_SIZES[format];
  const angle = -Math.atan(Math.tan((STICKER_TILT_DEGREES * Math.PI) / 180) * (size.w / size.h));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const halfW = seat.w / 2;
  const halfH = seat.h / 2;
  return [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ].map((corner) => ({
    x: nowCentre.x + corner.x * cos - corner.y * sin,
    y: nowCentre.y + corner.x * sin + corner.y * cos,
  }));
}

export function formatRect(rect: Rect): string {
  const round = (value: number): string => (Math.round(value * 100) / 100).toString();
  return `${round(rect.x)},${round(rect.y)},${round(rect.w)},${round(rect.h)}`;
}

export function formatQuad(points: Point[]): string {
  const round = (value: number): string => (Math.round(value * 100) / 100).toString();
  return points.map((point) => `${round(point.x)},${round(point.y)}`).join(' ');
}

/** The pixels per unit that make the pack fill its safe box at the closest camera. */
export function scaleFor(format: PackFormat, safeWidth: number, safeHeight: number): number {
  const size = PACK_SIZES[format];
  const byHeight = (0.74 * safeHeight * CAMERA_NEAR) / (size.h + size.neck * 0.6);
  const byWidth = (0.78 * safeWidth * (CAMERA_NEAR - size.d / 2)) / size.w;
  return Math.max(60, Math.min(byHeight, byWidth));
}

export function packCorners(format: PackFormat): PackSpacePoint[] {
  const size = PACK_SIZES[format];
  const half = { x: size.w / 2, y: size.h / 2, z: size.d / 2 };
  const points: PackSpacePoint[] = [];
  for (const x of [-half.x, half.x]) {
    for (const y of [-half.y, half.y + size.neck]) {
      for (const z of [-half.z, half.z]) points.push({ x, y, z });
    }
  }
  return points;
}
