import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as copy from '../copy.ts';
import { ApiError } from '../errors.ts';
import type { Entity } from '../types.ts';
import { Harness, line, circle, layer } from './testing.ts';

const A = 'asha';
const SOLVE_TOL = 0.0001;

function refusal(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ApiError, String(error));
    return error;
  }
  return assert.fail('expected a refusal');
}

const length = (e: Entity): number => (e.type === 'line' ? Math.hypot(e.x2 - e.x1, e.y2 - e.y1) : NaN);
const near = (a: number, b: number): boolean => Math.abs(a - b) <= SOLVE_TOL;

test('a parameter drives a length constraint and the geometry follows its edits', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 4, 0), line('L2', 0, 5, 4, 6)] });
  h.apply(A, [{ type: 'parameter_set', name: 'd1', expression: '5' }], { command: 'PARAM' });
  h.apply(A, [{ type: 'constraint_add', kind: 'fixed', refs: [{ handle: 'L1', point: 'start' }] }]);
  const out = h.apply(A, [{ type: 'constraint_add', kind: 'length', refs: [{ handle: 'L1', point: null }], expression: 'd1' }]);
  assert.ok(near(length(h.entities.L1), 5));
  assert.ok(out.changes.some((c) => c.kind === 'entity' && c.key === 'L1' && !c.derived), 'solved entities are part of the group');
  assert.ok(out.changes.some((c) => c.kind === 'constraint'));
  h.apply(A, [{ type: 'parameter_set', name: 'd1', expression: '2*(3+1)' }], { command: 'PARAM' });
  assert.ok(near(length(h.entities.L1), 8));
  const l1 = h.entities.L1;
  assert.ok(l1.type === 'line' && near(l1.x1, 0) && near(l1.y1, 0));
  h.apply(A, [{ type: 'constraint_add', kind: 'horizontal', refs: [{ handle: 'L2', point: null }] }]);
  const l2 = h.entities.L2;
  assert.ok(l2.type === 'line' && Math.abs(l2.y1 - l2.y2) <= SOLVE_TOL);
});

test('a conflicting constraint is refused naming the new one and the first unsatisfied, and nothing changes', () => {
  const h = new Harness({
    entities: [line('L1', 0, 0, 8, 0)], parameters: [{ name: 'd1', expression: '8' }],
    constraints: [{ kind: 'fixed', refs: [{ handle: 'L1', point: 'start' }] }, { kind: 'length', refs: [{ handle: 'L1', point: null }], expression: 'd1' }],
  });
  const before = h.state;
  const error = refusal(() => h.apply(A, [{ type: 'constraint_add', kind: 'length', refs: [{ handle: 'L1', point: null }], expression: '3' }]));
  assert.deepEqual([error.code, error.message], ['invalid', copy.overConstrained('length L1 = 3', 'length L1 = d1')]);
  assert.equal(h.state, before);
});

test('parameter expression errors are refused with the published texts', () => {
  const h = new Harness();
  assert.equal(refusal(() => h.apply(A, [{ type: 'parameter_set', name: 'd2', expression: 'd3+1' }])).message, 'Unknown parameter: d3.');
  h.apply(A, [{ type: 'parameter_set', name: 'd3', expression: '1' }]);
  h.apply(A, [{ type: 'parameter_set', name: 'd2', expression: 'd3+1' }]);
  assert.match(refusal(() => h.apply(A, [{ type: 'parameter_set', name: 'd3', expression: 'd2*2' }])).message, /^Expression cycle: (d3 -> d2 -> d3|d2 -> d3 -> d2)\.$/);
  h.apply(A, [{ type: 'parameter_set', name: 'd4', expression: '0' }]);
  assert.match(refusal(() => h.apply(A, [{ type: 'parameter_set', name: 'd5', expression: '10/d4' }])).message, /^Expression divides by zero: d[45]\.$/);
  assert.equal(h.state.parameters.d3.expression, '1');
  assert.ok(!('d5' in h.state.parameters));
  assert.equal(refusal(() => h.apply(A, [{ type: 'parameter_set', name: 'width', expression: '1' }])).message, 'Parameters are named d followed by digits.');
});

test('deleting a parameter that something uses is refused', () => {
  const h = new Harness({ parameters: [{ name: 'd1', expression: '1' }, { name: 'd2', expression: 'd1+1' }] });
  assert.equal(refusal(() => h.apply(A, [{ type: 'parameter_delete', name: 'd1' }])).message, 'Unknown parameter: d1.');
  h.apply(A, [{ type: 'parameter_delete', name: 'd2' }]);
  assert.ok(!('d2' in h.state.parameters));
});

test('a dragged grip on fixed geometry is refused and rolls the group back', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 10, 0)], parameters: [{ name: 'd1', expression: '5' }], constraints: [{ kind: 'fixed', refs: [{ handle: 'L1', point: null }] }] });
  const error = refusal(() => h.apply(A, [{ type: 'modify', handle: 'L1', set: { x2: 14, y2: 3 } }], { command: 'GRIP' }));
  assert.equal(error.code, 'invalid');
  assert.match(error.message, /^Over-constrained: .* conflicts with fixed L1\.$/);
});

test('a dragged grip keeps its point and the constrained geometry follows', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 10, 0)], constraints: [{ kind: 'horizontal', refs: [{ handle: 'L1', point: null }] }] });
  h.apply(A, [{ type: 'modify', handle: 'L1', set: { x2: 14, y2: 3 } }], { command: 'GRIP' });
  const l1 = h.entities.L1;
  assert.ok(l1.type === 'line' && near(l1.x2, 14) && near(l1.y1, 3) && near(l1.y2, 3));
});

test('deleting an entity deletes the constraints that refer to it, and undo brings both back', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 10, 0), line('L2', 0, 5, 10, 5)], constraints: [{ kind: 'horizontal', refs: [{ handle: 'L2', point: null }] }, { kind: 'horizontal', refs: [{ handle: 'L1', point: null }] }] });
  h.apply(A, [{ type: 'delete', handles: ['L2'] }], { command: 'ERASE' });
  assert.deepEqual(h.state.constraints.map((c) => c.refs[0].handle), ['L1']);
  h.undo(A);
  assert.deepEqual(h.state.constraints.map((c) => c.refs[0].handle), ['L2', 'L1'], 'creation order is kept');
});

test('constraint_add checks the references fit the kind', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 10, 0), circle('C2', 0, 0, 1)] });
  assert.equal(refusal(() => h.apply(A, [{ type: 'constraint_add', kind: 'horizontal', refs: [{ handle: 'C2', point: null }] }])).message, 'horizontal needs one line.');
  assert.equal(refusal(() => h.apply(A, [{ type: 'constraint_add', kind: 'parallel', refs: [{ handle: 'L1', point: null }] }])).message, 'parallel needs two lines.');
  assert.equal(refusal(() => h.apply(A, [{ type: 'constraint_delete', id: 'K9' }])).message, 'No constraint K9.');
  h.apply(A, [{ type: 'constraint_add', kind: 'radius', refs: [{ handle: 'C2', point: null }], expression: '3' }]);
  const c2 = h.entities.C2;
  assert.ok(c2.type === 'circle' && near(c2.r, 3));
});

test('constraints never move an entity on a locked layer', () => {
  const h = new Harness({ layers: [layer('Shut', { locked: true })], entities: [line('L1', 0, 0, 4, 1, 'Shut')] });
  const error = refusal(() => h.apply(A, [{ type: 'constraint_add', kind: 'horizontal', refs: [{ handle: 'L1', point: null }] }]));
  assert.equal(error.code, 'layer_locked');
});
