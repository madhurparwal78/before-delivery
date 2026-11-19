import type { SceneObject } from '../shared/types.js';
import { colorForIndex } from '../shared/palette.js';

export interface Starter {
  id: string;
  name: string;
  objects: () => SceneObject[];
}

interface ShapeInput {
  kind: 'box' | 'cylinder' | 'sphere';
  mode?: 'solid' | 'hole';
  x?: number;
  y?: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rotationZ?: number;
}

const shapes = (inputs: ShapeInput[]): SceneObject[] =>
  inputs.map((input, index) => ({
    id: `starter-${index + 1}`,
    kind: input.kind,
    mode: input.mode ?? 'solid',
    x: input.x ?? 0,
    y: input.y ?? 0,
    z: input.z,
    w: input.w,
    d: input.d,
    h: input.h,
    rotationZ: input.rotationZ ?? 0,
    color: colorForIndex(index),
    children: [],
  }));

export const STARTERS: Starter[] = [
  {
    id: 'desk-name-tag',
    name: 'Desk Name Tag',
    objects: () =>
      shapes([
        { kind: 'box', z: 2, w: 60, d: 28, h: 4 },
        { kind: 'cylinder', mode: 'hole', x: -24, y: 0, z: 2, w: 6, d: 6, h: 4 },
        { kind: 'box', x: -10, y: 0, z: 6, w: 6, d: 14, h: 4 },
        { kind: 'box', x: -2, y: 0, z: 6, w: 6, d: 14, h: 4 },
        { kind: 'box', x: 6, y: 0, z: 6, w: 6, d: 14, h: 4 },
        { kind: 'box', x: 14, y: 0, z: 6, w: 6, d: 14, h: 4 },
      ]),
  },
  {
    id: 'pencil-cup',
    name: 'Pencil Cup',
    objects: () =>
      shapes([
        { kind: 'cylinder', z: 28, w: 44, d: 44, h: 56 },
        { kind: 'cylinder', mode: 'hole', z: 31, w: 36, d: 36, h: 52 },
      ]),
  },
  {
    id: 'rainbow-lamp',
    name: 'Rainbow Lamp',
    objects: () =>
      shapes([
        { kind: 'cylinder', z: 8, w: 46, d: 46, h: 16 },
        { kind: 'cylinder', z: 24, w: 36, d: 36, h: 16 },
        { kind: 'cylinder', z: 40, w: 28, d: 28, h: 16 },
        { kind: 'sphere', z: 65, w: 34, d: 34, h: 34 },
      ]),
  },
  {
    id: 'spiral-tower',
    name: 'Spiral Tower',
    objects: () =>
      shapes(
        Array.from({ length: 6 }, (_unused, level) => ({
          kind: 'box' as const,
          z: 4 + level * 8,
          w: 40 - level * 3,
          d: 40 - level * 3,
          h: 8,
          rotationZ: (level * 15) % 360,
        })),
      ),
  },
];

export const starterById = (id: string | null): Starter | null =>
  STARTERS.find((starter) => starter.id === id) ?? null;
