// What the island renderers draw, shared by the WebGL scene and the flat plan.
import type { BuildingType, Rotation, UnitKey } from '../../shared/catalog';

export type ViewMode = 'village' | 'scout' | 'raid' | 'replay';

export interface SceneBuilding {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  rotation: Rotation;
  level: number;
  working: boolean;
  destroyed: boolean;
}

export interface SceneUnit {
  unit: UnitKey;
  /** Position in thousandths of a cell. */
  x: number;
  y: number;
  alive: boolean;
}

export interface Ghost {
  type: BuildingType;
  x: number;
  y: number;
  rotation: Rotation;
  movingId: number | null;
}

export interface Camera {
  azimuth: number;
  zoom: number;
  panX: number;
  panY: number;
  /** Screen offset (px) that moves the look-at point into the uncovered part of the view. */
  offsetX: number;
  offsetY: number;
}

/** Per-building transition state, 0 → 1. */
export interface BuildingMotion {
  rise: number;
  collapse: number;
  pulse: number;
}

export interface DrawState {
  mode: ViewMode;
  buildings: SceneBuilding[];
  motion: Map<number, BuildingMotion>;
  units: SceneUnit[];
  ghost: (Ghost & { valid: boolean }) | null;
  cursor: { x: number; y: number };
  selected: number | null;
  camera: Camera;
  /** Seconds of loop time: drives the tide and the scaffold rings; frozen under reduced motion. */
  loopTime: number;
}

export interface Renderer {
  readonly kind: 'webgl' | 'flat';
  resize(width: number, height: number): void;
  draw(state: DrawState): void;
  /** The grid point (in cells, fractional) under a canvas pixel, or null. */
  pick(px: number, py: number, camera: Camera): { x: number; y: number } | null;
  /** The canvas pixel where a grid point (in cells) is drawn. */
  project(x: number, y: number, camera: Camera): { x: number; y: number };
  dispose(): void;
}
