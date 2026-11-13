import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arc, assertClose, circle, layer, line, pline } from './fixtures.ts';
import { findHatch } from './hatch.ts';
import type { Entity } from '../types.ts';

const byHandle = (entities: Entity[]): Record<string, Entity> => Object.fromEntries(entities.map((e) => [e.handle, e]));
const layers = { 0: layer('0') };

describe('hatch boundary', () => {
  const base = byHandle([
    pline('P1', [[0, 0], [10, 0], [10, 10], [0, 10]], true), circle('C2', 5, 5, 2), circle('C3', 5, 5, 1),
    line('L4', 20, 0, 30, 0), line('L5', 30, 0, 30, 10), line('L6', 30, 10, 20, 10), arc('A7', 20, 5, 5, 90, 270),
  ]);

  it('takes outer minus the island one level deep', () => {
    const found = findHatch([1, 1], base, layers);
    assert.ok(found);
    assertClose(found.area, 100 - 4 * Math.PI);
    assert.deepEqual(found.boundary, ['P1', 'C2']);
  });

  it('adds the circular segment of an outward arc bulge', () => {
    const found = findHatch([25, 5], base, layers);
    assert.ok(found);
    assertClose(found.area, 100 + 12.5 * Math.PI);
    assert.deepEqual(found.boundary, ['L4', 'L5', 'L6', 'A7']);
  });

  it('subtracts the segment of an inward bulge', () => {
    const inward = byHandle([line('L1', 0, 0, 10, 0), line('L2', 10, 0, 10, 10), line('L3', 10, 10, 0, 10), arc('A4', 0, 5, 5, 270, 90)]);
    const found = findHatch([5, 5], inward, layers);
    assert.ok(found);
    assertClose(found.area, 100 - 12.5 * Math.PI);
  });

  it('follows an edit of the boundary', () => {
    const wider = { ...base, P1: pline('P1', [[0, 0], [12, 0], [12, 10], [0, 10]], true) };
    assertClose(findHatch([1, 1], wider, layers)!.area, 120 - 4 * Math.PI);
  });

  it('has no boundary once an edge of the chain is gone, or around an empty point', () => {
    const { L5: _removed, ...open } = base;
    assert.equal(findHatch([25, 5], open, layers), null);
    assert.equal(findHatch([500, 500], base, layers), null);
  });

  it('ignores a frozen layer but still uses an off layer', () => {
    const hidden = byHandle([pline('P1', [[50, 0], [51, 0], [51, 1], [50, 1]], true, 'Hidden')]);
    assertClose(findHatch([50.5, 0.5], hidden, { ...layers, Hidden: layer('Hidden', 'green', { on: false }) })!.area, 1);
    assert.equal(findHatch([50.5, 0.5], hidden, { ...layers, Hidden: layer('Hidden', 'green', { frozen: true }) }), null);
  });

  it('closes a chain whose ends meet within 0.001 and picks the smallest loop around the seed', () => {
    const chain = byHandle([
      line('L1', 0, 0, 4, 0), line('L2', 4.0005, 0, 4, 4), line('L3', 4, 4, 0, 4), line('L4', 0, 4, 0, 0),
      pline('P5', [[-5, -5], [9, -5], [9, 9], [-5, 9]], true),
    ]);
    assertClose(findHatch([2, 2], chain, layers)!.area, 16, 0.01);
    assertClose(findHatch([7, 7], chain, layers)!.area, 196 - 16, 0.01);
  });

  it('picks the cell a divider cuts out of a split rectangle', () => {
    const cells = byHandle([
      line('L1', 0, 0, 5, 0), line('L2', 5, 0, 10, 0), line('L3', 10, 0, 10, 10), line('L4', 10, 10, 5, 10),
      line('L5', 5, 10, 0, 10), line('L6', 0, 10, 0, 0), line('L7', 5, 0, 5, 10),
    ]);
    assert.deepEqual(findHatch([1, 5], cells, layers)!.boundary, ['L1', 'L5', 'L6', 'L7']);
    assertClose(findHatch([1, 5], cells, layers)!.area, 50);
    assertClose(findHatch([9, 5], cells, layers)!.area, 50);
  });

  it('drops an island that moved out of the loop', () => {
    const inside = byHandle([pline('P4', [[40, 0], [44, 0], [44, 4], [40, 4]], true), circle('C5', 42, 2, 1)]);
    assertClose(findHatch([40.5, 0.5], inside, layers)!.area, 16 - Math.PI);
    assertClose(findHatch([40.5, 0.5], { ...inside, C5: circle('C5', 52, 2, 1) }, layers)!.area, 16);
    assert.deepEqual(findHatch([40.5, 0.5], { ...inside, C5: circle('C5', 52, 2, 1) }, layers)!.boundary, ['P4']);
  });

  it('uses a circle as the loop and gives its area', () => {
    assertClose(findHatch([0, 0], byHandle([circle('C1', 0, 0, 3)]), layers)!.area, Math.PI * 9);
  });
});
