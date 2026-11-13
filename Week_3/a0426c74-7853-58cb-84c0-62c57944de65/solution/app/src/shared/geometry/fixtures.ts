// Entity builders shared by the geometry unit tests.
import assert from 'node:assert/strict';
import type { ArcEntity, BlockDef, CircleEntity, DimensionEntity, DrawingState, Entity, HatchEntity, InsertEntity, Layer, LineEntity, PlineEntity, Point } from '../types.ts';

export const line = (handle: string, x1: number, y1: number, x2: number, y2: number, layer = '0', extra: Partial<LineEntity> = {}): LineEntity =>
  ({ type: 'line', handle, layer, x1, y1, x2, y2, ...extra });
export const circle = (handle: string, cx: number, cy: number, r: number, layer = '0'): CircleEntity => ({ type: 'circle', handle, layer, cx, cy, r });
export const arc = (handle: string, cx: number, cy: number, r: number, start: number, end: number, layer = '0'): ArcEntity =>
  ({ type: 'arc', handle, layer, cx, cy, r, start, end });
export const pline = (handle: string, points: Point[], closed: boolean, layer = '0'): PlineEntity => ({ type: 'pline', handle, layer, points, closed });
export const insert = (handle: string, block: string, x: number, y: number, scale = 1, rotation = 0, attributes: Record<string, string> = {}, layer = '0'): InsertEntity =>
  ({ type: 'insert', handle, layer, block, x, y, scale, rotation, attributes });
export const hatch = (handle: string, seedX: number, seedY: number, layer = '0'): HatchEntity =>
  ({ type: 'hatch', handle, layer, seed_x: seedX, seed_y: seedY, area: 0, associative: true, boundary: [] });
export const dimension = (handle: string, kind: DimensionEntity['kind'], refs: DimensionEntity['refs'], textX: number, textY: number, value = 0): DimensionEntity =>
  ({ type: 'dimension', handle, layer: '0', kind, style: 'Standard', refs, override: null, text_x: textX, text_y: textY, value, associative: true });

export const layer = (name: string, colour: Layer['colour'] = 'white', flags: Partial<Layer> = {}): Layer =>
  ({ name, colour, linetype: 'Continuous', lineweight: 0.25, on: true, frozen: false, locked: false, ...flags });
export const block = (name: string, entities: Entity[], base: Point = [0, 0]): BlockDef => ({ name, base, entities, attributes: [] });

export function drawing(entities: Entity[], extra: Partial<DrawingState> = {}): DrawingState {
  return {
    revision: 0, next_handle: 1, layers: { 0: layer('0') }, entities: Object.fromEntries(entities.map((e) => [e.handle, e])),
    blocks: {}, dim_styles: {}, parameters: {}, constraints: [], xrefs: {}, layer_states: {}, underlays: [], ...extra,
  };
}

export function assertClose(actual: number, expected: number, tolerance = 1e-6, message?: string): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, message ?? `${actual} is not within ${tolerance} of ${expected}`);
}

export function assertPoint(actual: Point, expected: Point, tolerance = 1e-6): void {
  assertClose(actual[0], expected[0], tolerance, `x ${actual[0]} vs ${expected[0]}`);
  assertClose(actual[1], expected[1], tolerance, `y ${actual[1]} vs ${expected[1]}`);
}
