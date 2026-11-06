/**
 * The moped, built procedurally from the one parts table.
 *
 * Every shape here is derived from the catalogue: the pack takes its own width
 * and height, the hub its width and shaft, and the wheels and fork the donor's
 * wheelbase. Nothing is modelled by hand.
 *
 * Lengths are millimetres. Brief coordinates are x forward from the rear axle,
 * y to the left and z up; `toScene` maps them to Three's y-up space.
 */

import { Vector3 } from 'three';

import type { Catalogue } from '../api.js';

export type Axis = 'x' | 'y' | 'z';

export interface Primitive {
  kind: 'box' | 'cylinder';
  /** Centre in brief coordinates, millimetres. */
  centre: [number, number, number];
  /** Full extents along brief x, y, z, millimetres. */
  size: [number, number, number];
  /** For a cylinder, the axis its length runs along. */
  along?: Axis;
}

export interface ScenePart {
  id: string;
  name: string;
  /** Centre in brief coordinates, millimetres. */
  position: [number, number, number];
  primitives: Primitive[];
  storyStage: number | null;
  /** Unit direction the part travels for the story, in brief coordinates. */
  storyAxis: [number, number, number] | null;
  storyDistanceMm: number;
  fadedFor: ('pack' | 'hub')[];
  /** The dimension line's value, millimetres. */
  dimensionMm: number;
  /** Which brief axis the dimension line measures. */
  dimensionAxis: Axis;
}

export function toScene(point: readonly [number, number, number]): Vector3 {
  return new Vector3(point[0], point[2], -point[1]);
}

const AXIS_VECTORS: Record<string, [number, number, number]> = {
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
};

function tenths(value: number): number {
  return value / 10;
}

function box(
  centre: [number, number, number],
  size: [number, number, number],
): Primitive {
  return { kind: 'box', centre, size };
}

function cylinder(
  centre: [number, number, number],
  size: [number, number, number],
  along: Axis,
): Primitive {
  return { kind: 'cylinder', centre, size, along };
}

export interface BuildInput {
  catalogue: Catalogue;
  model: string;
  packId: string;
  hubId: string;
}

/**
 * Resolve the parts table against a donor and kit. `front-wheel` and
 * `front-fork` take the donor's wheelbase, and `traction-pack` the donor's
 * bay x, as the API's resolved positions do.
 */
export function buildParts(input: BuildInput): ScenePart[] {
  const { catalogue } = input;
  const donor = catalogue.donors.find((row) => row.model === input.model) ?? catalogue.donors[0];
  const pack = catalogue.packs.find((row) => row.id === input.packId) ?? catalogue.packs[0];
  const hub = catalogue.hubs.find((row) => row.id === input.hubId) ?? catalogue.hubs[0];
  if (!donor || !pack || !hub) throw new Error('the catalogue must carry a donor, a pack and a hub');

  const wheelbase = tenths(donor.wheelbaseTenthsMm);
  const bayX = tenths(donor.bayXTenthsMm);
  const packWidth = tenths(pack.widthTenthsMm);
  const packHeight = tenths(pack.heightTenthsMm);
  const hubWidth = tenths(hub.widthTenthsMm);
  const shaft = tenths(hub.shaftTenthsMm);

  return catalogue.parts.map((row) => {
    const base: [number, number, number] = [
      tenths(row.position[0]),
      tenths(row.position[1]),
      tenths(row.position[2]),
    ];

    // The donor's wheelbase and bay move the parts the API resolves.
    const position: [number, number, number] =
      row.id === 'front-wheel' || row.id === 'front-fork'
        ? [base[0] - 1240 + wheelbase, base[1], base[2]]
        : row.id === 'traction-pack'
          ? [bayX, base[1], base[2]]
          : base;

    const { primitives, dimensionMm, dimensionAxis } = shapeFor(row.id, position, {
      wheelbase,
      packWidth,
      packHeight,
      hubWidth,
      shaft,
    });

    return {
      id: row.id,
      name: row.name,
      position,
      primitives,
      storyStage: row.storyStage,
      storyAxis: row.axis ? (AXIS_VECTORS[row.axis] ?? null) : null,
      storyDistanceMm: tenths(row.storyDistanceTenthsMm),
      fadedFor: row.fadedFor,
      dimensionMm,
      dimensionAxis,
    };
  });
}

interface Sizes {
  wheelbase: number;
  packWidth: number;
  packHeight: number;
  hubWidth: number;
  shaft: number;
}

interface Shape {
  primitives: Primitive[];
  dimensionMm: number;
  dimensionAxis: Axis;
}

/**
 * Each part's shape. Together they read as a step-through scooter: a low
 * footboard between the leg shield and the seat, with the frame's tunnel
 * passing beneath.
 */
function shapeFor(id: string, at: [number, number, number], sizes: Sizes): Shape {
  const [x, y, z] = at;

  switch (id) {
    case 'frame':
      return {
        primitives: [
          box([x + 360, y, z], [60, 60, 340]),
          box([x - 60, y, z - 150], [700, 70, 60]),
          box([x - 380, y, z], [60, 70, 260]),
        ],
        dimensionMm: 700,
        dimensionAxis: 'x',
      };
    case 'footboard':
      return { primitives: [box([x, y, z], [520, 280, 30])], dimensionMm: 520, dimensionAxis: 'x' };
    case 'leg-shield':
      return { primitives: [box([x, y, z], [50, 300, 420])], dimensionMm: 420, dimensionAxis: 'z' };
    case 'front-panel':
      return { primitives: [box([x, y, z], [120, 240, 220])], dimensionMm: 240, dimensionAxis: 'y' };
    case 'seat':
      return { primitives: [box([x, y, z], [420, 260, 90])], dimensionMm: 420, dimensionAxis: 'x' };
    case 'side-panel-left':
    case 'side-panel-right':
      return { primitives: [box([x, y, z], [360, 25, 240])], dimensionMm: 360, dimensionAxis: 'x' };
    case 'fuel-tank':
      return { primitives: [box([x, y, z], [260, 180, 140])], dimensionMm: 260, dimensionAxis: 'x' };
    case 'engine-exhaust':
      return {
        primitives: [
          box([x, y, z], [220, 160, 180]),
          cylinder([x + 40, y - 150, z - 30], [320, 70, 70], 'x'),
        ],
        dimensionMm: 220,
        dimensionAxis: 'x',
      };
    case 'hub-motor':
      return {
        primitives: [cylinder([x, y, z], [220, sizes.hubWidth, 220], 'y'), box([x, y - sizes.hubWidth / 2 - sizes.shaft / 2, z], [40, sizes.shaft, 40])],
        dimensionMm: sizes.hubWidth,
        dimensionAxis: 'y',
      };
    case 'traction-pack':
      return {
        primitives: [box([x, y, z], [360, sizes.packWidth, sizes.packHeight])],
        dimensionMm: sizes.packWidth,
        dimensionAxis: 'y',
      };
    case 'controller':
      return { primitives: [box([x, y, z], [160, 140, 90])], dimensionMm: 160, dimensionAxis: 'x' };
    case 'front-fork':
      return {
        primitives: [
          box([x, y + 55, z], [40, 40, 420]),
          box([x, y - 55, z], [40, 40, 420]),
        ],
        dimensionMm: 420,
        dimensionAxis: 'z',
      };
    case 'front-wheel':
    case 'rear-wheel':
      return {
        primitives: [
          cylinder([x, y, z], [380, 80, 380], 'y'),
          cylinder([x, y, z], [240, 84, 240], 'y'),
        ],
        dimensionMm: 380,
        dimensionAxis: 'z',
      };
    case 'swingarm':
      return { primitives: [box([x + 100, y, z], [300, 180, 40])], dimensionMm: 300, dimensionAxis: 'x' };
    default:
      return { primitives: [box([x, y, z], [120, 120, 120])], dimensionMm: 120, dimensionAxis: 'x' };
  }
}

/** The half extent of a part along a brief axis, for its leading edge. */
export function halfExtentAlong(part: ScenePart, axis: [number, number, number]): number {
  const index = axis[0] !== 0 ? 0 : axis[1] !== 0 ? 1 : 2;
  let furthest = 0;
  for (const primitive of part.primitives) {
    const offset = primitive.centre[index] - part.position[index];
    const half = (primitive.size[index] as number) / 2;
    const sign = axis[index] as number;
    furthest = Math.max(furthest, sign * offset + half);
  }
  return furthest;
}

export const STORY_STAGE_COUNT = 6;

/**
 * A part's live story offset: its distance times the fraction of
 * `progress × 6 − (stage − 1)` clamped between 0 and 1, along its axis.
 * A pure function of progress, so scrolling back reassembles exactly.
 */
export function storyOffset(part: ScenePart, progress: number): [number, number, number] {
  if (part.storyStage === null || !part.storyAxis) return [0, 0, 0];
  const scaled = progress * STORY_STAGE_COUNT - (part.storyStage - 1);
  const fraction = Math.min(1, Math.max(0, scaled));
  const distance = part.storyDistanceMm * fraction;
  return [
    part.storyAxis[0] * distance,
    part.storyAxis[1] * distance,
    part.storyAxis[2] * distance,
  ];
}

/** The stage a progress value sits in: 1 to 6, with 6 at progress 1. */
export function storyStageFor(progress: number): number {
  return Math.min(STORY_STAGE_COUNT, Math.floor(progress * STORY_STAGE_COUNT) + 1);
}

export { AXIS_VECTORS };
