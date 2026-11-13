// The installation outlines dropped onto the grid, to scale in metres (brief: Pieces).
import type { Silhouette } from "./state";

export interface Box {
  size: [number, number, number];
  at: [number, number, number];
}

const SHAPES: Record<Silhouette, Box[]> = {
  none: [],
  "camera-reactive-wall": [
    { size: [4, 2.6, 0.4], at: [0, 1.3, 0] },
    { size: [0.5, 0.18, 0.18], at: [0, 2.75, 0.12] },
  ],
  "portrait-kiosk": [
    { size: [1.2, 2.0, 1.2], at: [0, 1.0, 0] },
    { size: [0.8, 0.9, 0.04], at: [0, 1.35, 0.62] },
  ],
  "projection-room": [
    { size: [1.0, 2.4, 1.0], at: [0, 1.2, 0] },
    { size: [0.5, 0.3, 0.5], at: [0, 2.55, 0] },
    { size: [3.2, 0.02, 2.4], at: [0, 0.01, -2.4] },
  ],
};

export function silhouetteBoxes(kind: Silhouette): Box[] {
  return SHAPES[kind];
}
