import type { BuildingType, Rotation } from '../../shared/types.js';

export type SceneBuilding = {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  rotation: Rotation;
  level: number;
  destroyed: boolean;
  working: boolean;
};

export type SceneUnit = { x: number; y: number; alive: boolean };

export type SceneGhost = {
  type: BuildingType;
  x: number;
  y: number;
  rotation: Rotation;
  valid: boolean;
};

export type CameraState = {
  azimuth: number;
  zoom: number;
  panX: number;
  panY: number;
};

export type IslandRenderer = {
  readonly kind: 'webgl' | 'flat';
  setBuildings(buildings: readonly SceneBuilding[]): void;
  setUnits(units: readonly SceneUnit[]): void;
  setGhost(ghost: SceneGhost | null): void;
  setCursor(x: number, y: number): void;
  setCamera(camera: CameraState): void;
  setReducedMotion(reduced: boolean): void;
  resize(width: number, height: number): void;
  pickCell(clientX: number, clientY: number): { x: number; y: number } | null;
  frame(nowMs: number): boolean;
  dispose(): void;
};

export const GROUND_CELLS = 40;
export const DEFAULT_CAMERA: CameraState = { azimuth: 0, zoom: 1, panX: 20, panY: 20 };
export const PALETTE = {
  indigo: 0x141a2e,
  salt: 0xf2efe6,
  orange: 0xe8742c,
  teal: 0x3f8f8a,
  danger: 0xb63a2b,
  crust: 0xd8d2c2,
  crustDark: 0xa9a292
} as const;
