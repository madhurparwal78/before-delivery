import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DimStyle, Entity } from '../types.ts';
import { arc, assertClose, circle, dimension, line } from './fixtures.ts';
import { STANDARD_DIM_STYLE, dimensionDataValue, dimensionLayout, dimensionStyle, dimensionText, dimensionValue, linkDimensionPoint } from './dimension.ts';

const byHandle = (...entities: Entity[]): Record<string, Entity> => Object.fromEntries(entities.map((e) => [e.handle, e]));
const start = (handle: string) => ({ handle, point: 'start' as const });
const end = (handle: string) => ({ handle, point: 'end' as const });

describe('dimension values', () => {
  const entities = byHandle(line('L1', 0, 0, 10, 0), line('L3', 100, 0, 110, 0), line('L4', 100, 0, 110, 10), circle('C5', 200, 0, 2.5));

  it('measures linear, aligned, angular and radial values', () => {
    assert.equal(dimensionValue({ kind: 'linear', refs: [start('L1'), end('L1')] }, entities, STANDARD_DIM_STYLE), 10);
    assert.equal(dimensionValue({ kind: 'aligned', refs: [start('L1'), end('L1')] }, entities, STANDARD_DIM_STYLE), 10);
    assertClose(dimensionValue({ kind: 'angular', refs: [{ handle: 'L3' }, { handle: 'L4' }] }, entities, STANDARD_DIM_STYLE)!, 45);
    assert.equal(dimensionValue({ kind: 'radial', refs: [{ handle: 'C5', point: 'centre' }] }, entities, STANDARD_DIM_STYLE), 2.5);
  });

  it('takes |dx| for linear when the horizontal span is at least the vertical one, else |dy|', () => {
    const moved = byHandle(line('L1', 0, 0, 13, 4), line('L2', 0, 0, 4, 13));
    assert.equal(dimensionValue({ kind: 'linear', refs: [start('L1'), end('L1')] }, moved, STANDARD_DIM_STYLE), 13);
    assert.equal(dimensionValue({ kind: 'linear', refs: [start('L2'), end('L2')] }, moved, STANDARD_DIM_STYLE), 13);
    assertClose(dimensionValue({ kind: 'aligned', refs: [start('L1'), end('L1')] }, moved, STANDARD_DIM_STYLE)!, Math.hypot(13, 4));
  });

  it('shows the aligned value at the style precision with zeros kept: 13.60, 13.601, 10.00', () => {
    const moved = byHandle(line('L1', 0, 0, 13, 4));
    const aligned = { kind: 'aligned' as const, refs: [start('L1'), end('L1')] };
    const value = dimensionValue(aligned, moved, STANDARD_DIM_STYLE)!;
    assert.equal(dimensionDataValue({ value }, STANDARD_DIM_STYLE), '13.60');
    assert.equal(dimensionDataValue({ value }, { ...STANDARD_DIM_STYLE, precision: 3 }), '13.601');
    assert.equal(dimensionDataValue({ value: 10 }, STANDARD_DIM_STYLE), '10.00');
    assert.equal(dimensionDataValue({ value: 2.5 }, STANDARD_DIM_STYLE), '2.50');
  });

  it('multiplies the value by the style scale', () => {
    const scaled: DimStyle = { ...STANDARD_DIM_STYLE, name: 'Half', scale: 0.5 };
    assert.equal(dimensionValue({ kind: 'aligned', refs: [start('L1'), end('L1')] }, entities, scaled), 5);
  });

  it('has no value once a ref is gone', () => {
    assert.equal(dimensionValue({ kind: 'aligned', refs: [start('L9'), end('L9')] }, entities, STANDARD_DIM_STYLE), null);
    assert.equal(dimensionValue({ kind: 'radial', refs: [{ handle: 'L1', point: 'centre' }] }, entities, STANDARD_DIM_STYLE), null);
  });

  it('reads the radius of an arc', () => {
    assert.equal(dimensionValue({ kind: 'radial', refs: [{ handle: 'A1' }] }, byHandle(arc('A1', 0, 0, 7, 0, 90)), STANDARD_DIM_STYLE), 7);
  });
});

describe('dimension text and styles', () => {
  const style: DimStyle = { name: 'Metric', precision: 1, prefix: 'R', suffix: ' mm', scale: 1, text_height_mm: 3.5 };

  it('reads prefix + value + suffix, and an override replaces it with <> standing for that text', () => {
    assert.equal(dimensionText({ value: 12.34, override: null }, style), 'R12.3 mm');
    assert.equal(dimensionText({ value: 12.34, override: 'about <>' }, style), 'about R12.3 mm');
    assert.equal(dimensionText({ value: 12.34, override: 'fixed' }, style), 'fixed');
  });

  it('falls back to Standard for an unknown style', () => {
    assert.equal(dimensionStyle({ Metric: style }, 'Metric'), style);
    assert.equal(dimensionStyle({}, 'Gone'), STANDARD_DIM_STYLE);
    assert.deepEqual([STANDARD_DIM_STYLE.precision, STANDARD_DIM_STYLE.scale, STANDARD_DIM_STYLE.text_height_mm, STANDARD_DIM_STYLE.prefix, STANDARD_DIM_STYLE.suffix], [2, 1, 2.5, '', '']);
  });
});

describe('linking dimension points', () => {
  const entities = byHandle(line('L1', 0, 0, 10, 0), circle('C2', 5, 5, 2), arc('A3', 20, 0, 5, 0, 90));

  it('links a point within 0.001 of an entity start, end or centre', () => {
    assert.deepEqual(linkDimensionPoint(entities, [0, 0.0005]), { handle: 'L1', point: 'start' });
    assert.deepEqual(linkDimensionPoint(entities, [10, 0]), { handle: 'L1', point: 'end' });
    assert.deepEqual(linkDimensionPoint(entities, [5, 5]), { handle: 'C2', point: 'centre' });
    assert.deepEqual(linkDimensionPoint(entities, [25, 0]), { handle: 'A3', point: 'start' });
  });

  it('links nothing farther away', () => {
    assert.equal(linkDimensionPoint(entities, [0, 0.01]), null);
  });
});

describe('dimension layout', () => {
  const lookup = (e: Record<string, Entity>) => (handle: string): Entity | undefined => e[handle];

  it('puts a horizontal linear dimension line at the text height with extension lines', () => {
    const layout = dimensionLayout(dimension('D1', 'linear', [start('L1'), end('L1')], 5, -3), lookup(byHandle(line('L1', 0, 0, 10, 0))))!;
    assert.deepEqual(layout.segments, [[[0, 0], [0, -3]], [[10, 0], [10, -3]], [[0, -3], [10, -3]]]);
    assert.equal(layout.arrows.length, 2);
    assert.equal(layout.textAngle, 0);
  });

  it('offsets an aligned dimension to the text side', () => {
    const layout = dimensionLayout(dimension('D1', 'aligned', [start('L1'), end('L1')], 5, 2), lookup(byHandle(line('L1', 0, 0, 10, 0))))!;
    assert.deepEqual(layout.segments[2], [[0, 2], [10, 2]]);
  });

  it('draws an angular dimension as an arc around the crossing and a radial one as a leader', () => {
    const angular = dimensionLayout(dimension('D2', 'angular', [{ handle: 'L3' }, { handle: 'L4' }], 105, 3), lookup(byHandle(line('L3', 100, 0, 110, 0), line('L4', 100, 0, 110, 10))))!;
    assert.ok(angular.arc !== null);
    assertClose(angular.arc.c[0], 100);
    assertClose(angular.arc.start, 0);
    assertClose(angular.arc.end, 45);
    const radial = dimensionLayout(dimension('D3', 'radial', [{ handle: 'C5', point: 'centre' }], 203, 0), lookup(byHandle(circle('C5', 200, 0, 2.5))))!;
    assert.deepEqual(radial.segments, [[[200, 0], [203, 0]]]);
  });

  it('has no layout once its geometry is gone', () => {
    assert.equal(dimensionLayout(dimension('D1', 'linear', [start('L1'), end('L1')], 5, 2), lookup({})), null);
  });
});
