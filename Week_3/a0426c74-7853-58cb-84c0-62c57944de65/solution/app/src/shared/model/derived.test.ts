import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../errors.ts';
import { Harness, add, arc, circle, dimension, hatch, layer, line, pline } from './testing.ts';

const A = 'asha';
const B = 'bram';

function refusal(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ApiError, String(error));
    return error;
  }
  return assert.fail('expected a refusal');
}

const near = (a: number | undefined, b: number): boolean => a !== undefined && Math.abs(a - b) < 1e-6;
const valueOf = (h: Harness, handle: string): number | undefined => {
  const e = h.entities[handle];
  return e?.type === 'dimension' ? e.value : undefined;
};
const associative = (h: Harness, handle: string): boolean | undefined => {
  const e = h.entities[handle];
  return e?.type === 'dimension' || e?.type === 'hatch' ? e.associative : undefined;
};

const ref = [{ handle: 'L1', point: 'start' as const }, { handle: 'L1', point: 'end' as const }];

test('dimension values follow the geometry for every kind', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 10, 0), line('L3', 100, 0, 110, 0), line('L4', 100, 0, 110, 10), circle('C5', 200, 0, 2.5)] });
  const out = h.apply(A, [
    add(dimension('x', 'aligned', ref)), add(dimension('x', 'linear', ref)),
    add(dimension('x', 'angular', [{ handle: 'L3' }, { handle: 'L4' }])), add(dimension('x', 'radial', [{ handle: 'C5', point: 'centre' }])),
  ]);
  const [aligned, linear, angular, radial] = out.results.map((r) => r.handles[0]);
  assert.deepEqual([aligned, linear, angular, radial].map((handle) => valueOf(h, handle)), [10, 10, 45, 2.5]);
  h.apply(B, [{ type: 'modify', handle: 'L1', set: { x2: 13, y2: 4 } }]);
  assert.ok(near(valueOf(h, aligned), Math.hypot(13, 4)) && near(valueOf(h, linear), 13));
  assert.equal(h.entities[aligned].type === 'dimension' && h.entities[aligned].author, A);
});

test('dim_style_set changes the dimensions that use the style', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 10, 0)] });
  const dim = h.apply(A, [add(dimension('x', 'aligned', ref))]).results[0].handles[0];
  h.apply(A, [{ type: 'dim_style_set', name: 'Standard', precision: 3, prefix: '', suffix: '', scale: 2, text_height_mm: 2.5 }]);
  assert.equal(valueOf(h, dim), 20);
  assert.equal(refusal(() => h.apply(A, [{ type: 'dim_style_set', name: 'S', precision: 2, prefix: '', suffix: '', scale: 0, text_height_mm: 2.5 }])).message, 'Enter a number greater than 0.');
});

test('deleting a linked entity keeps the value, stops following and tells the author; one undo brings the link back without a toast', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 10, 0)] });
  const dim = h.apply(A, [add(dimension('x', 'aligned', ref))]).results[0].handles[0];
  h.notices.length = 0;
  const out = h.apply(B, [{ type: 'delete', handles: ['L1'] }], { command: 'ERASE' });
  assert.equal(associative(h, dim), false);
  assert.equal(valueOf(h, dim), 10);
  assert.deepEqual(out.notices, [{ username: A, text: `Dimension ${dim} lost its geometry.` }]);
  const change = out.changes.find((c) => c.key === dim);
  assert.ok(change?.derived);
  h.undo(B);
  assert.equal(associative(h, dim), true);
  assert.deepEqual(h.notices.slice(1), [], 'the undo yields no toast');
});

test('a dimension needs existing geometry', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 10, 0)] });
  assert.equal(refusal(() => h.apply(A, [add(dimension('x', 'aligned', [{ handle: 'L9', point: 'start' }, { handle: 'L1', point: 'end' }]))])).message, 'No entity L9.');
});

const boundary = [pline('P1', [[0, 0], [10, 0], [10, 10], [0, 10]], true), circle('C2', 5, 5, 2), circle('C3', 5, 5, 1),
  line('L4', 20, 0, 30, 0), line('L5', 30, 0, 30, 10), line('L6', 30, 10, 20, 10), arc('A7', 20, 5, 5, 90, 270)];

test('hatch finds the smallest loop with one level of islands and its area follows edits', () => {
  const h = new Harness({ entities: boundary });
  const [inner, chain] = h.apply(A, [add(hatch('x', 1, 1)), add(hatch('x', 25, 5))]).results.map((r) => r.handles[0]);
  const area = (handle: string): number | undefined => {
    const e = h.entities[handle];
    return e?.type === 'hatch' ? e.area : undefined;
  };
  assert.ok(near(area(inner), 100 - Math.PI * 4));
  assert.ok(near(area(chain), 100 + 12.5 * Math.PI));
  h.apply(B, [{ type: 'modify', handle: 'P1', set: { points: [[0, 0], [12, 0], [12, 10], [0, 10]] } }]);
  assert.ok(near(area(inner), 120 - Math.PI * 4));
});

test('a hatch without a closed loop is refused; a broken boundary keeps the area and tells the author; undo restores', () => {
  const h = new Harness({ layers: [layer('Hidden', { on: false })], entities: boundary });
  assert.equal(refusal(() => h.apply(A, [add(hatch('x', 500, 500))])).message, 'No closed boundary around that point.');
  const chain = h.apply(A, [add(hatch('x', 25, 5))]).results[0].handles[0];
  const before = h.entities[chain];
  h.notices.length = 0;
  const out = h.apply(B, [{ type: 'delete', handles: ['L5'] }], { command: 'ERASE' });
  assert.equal(associative(h, chain), false);
  assert.ok(before.type === 'hatch' && near(h.entities[chain].type === 'hatch' ? h.entities[chain].area : undefined, before.area));
  assert.deepEqual(out.notices, [{ username: A, text: `Hatch ${chain}: boundary broken. It no longer follows its edges.` }]);
  h.undo(B);
  assert.equal(associative(h, chain), true);
});

test('frozen layers are ignored by the hatch search, off layers are used', () => {
  const h = new Harness({ layers: [layer('Hidden', { on: false })], entities: [pline('P1', [[50, 0], [51, 0], [51, 1], [50, 1]], true, 'Hidden')] });
  h.apply(A, [add(hatch('x', 50.5, 0.5))]);
  h.apply(A, [{ type: 'layer_set', name: 'Hidden', set: { frozen: true } }]);
  assert.equal(refusal(() => h.apply(A, [add(hatch('x', 50.5, 0.5))])).message, 'No closed boundary around that point.');
});

test('moving an island out of a hatch drops it from the area', () => {
  const h = new Harness({ entities: [pline('P4', [[40, 0], [44, 0], [44, 4], [40, 4]], true), circle('C5', 42, 2, 1)] });
  const handle = h.apply(A, [add(hatch('x', 40.5, 0.5))]).results[0].handles[0];
  h.apply(A, [{ type: 'move', handles: ['C5'], dx: 10, dy: 0 }]);
  const e = h.entities[handle];
  assert.ok(e.type === 'hatch' && near(e.area, 16));
});
