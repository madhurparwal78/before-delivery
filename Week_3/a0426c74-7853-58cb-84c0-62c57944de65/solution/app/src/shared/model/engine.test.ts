import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as copy from '../copy.ts';
import { ApiError } from '../errors.ts';
import { applyGroup, applyPatch, isServerOnlyOp } from './index.ts';
import { Harness, add, arc, circle, layer, line, pline, withIds } from './testing.ts';
import type { OpInput } from './testing.ts';

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

test('add assigns the next handle, the author and the stored 6-decimal numbers; revision advances by the op count', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 1, 1)] });
  const out = h.apply(A, [add(line('x', 0.1234567, 0, 5, 0)), add(circle('x', 1, 1, 2)), add(arc('x', 0, 0, 3, -90, 450))]);
  assert.deepEqual(out.results.map((r) => r.handles), [['L2'], ['C3'], ['A4']]);
  assert.equal(out.state.revision, 3);
  assert.equal(out.state.next_handle, 5);
  const created = out.state.entities.L2;
  assert.ok(created.type === 'line' && created.x1 === 0.123457 && created.author === A);
  const swept = out.state.entities.A4;
  assert.ok(swept.type === 'arc' && swept.start === 270 && swept.end === 90);
  assert.deepEqual(out.changes.map((c) => [c.kind, c.key, c.before === null]), [['entity', 'L2', true], ['entity', 'C3', true], ['entity', 'A4', true]]);
});

test('a group is all or nothing and refusals are invalid (422) with the published text', () => {
  const h = new Harness({ layers: [layer('0')], entities: [line('L1', 0, 0, 1, 1)] });
  const before = h.state;
  const error = refusal(() => h.apply(A, [add(line('x', 0, 0, 5, 5)), { type: 'layer_delete', name: '0' }]));
  assert.equal(error.code, 'invalid');
  assert.equal(error.message, "Layer 0 can't be deleted.");
  assert.equal(h.state, before);
});

test('ops that touch or add to a locked layer are refused with layer_locked', () => {
  const h = new Harness({ layers: [layer('Walls', { locked: true })], entities: [line('L1', 0, 0, 10, 0, 'Walls')] });
  const ops: OpInput[] = [
    { type: 'move', handles: ['L1'], dx: 1, dy: 0 }, { type: 'modify', handle: 'L1', set: { x2: 20 } },
    { type: 'delete', handles: ['L1'] }, add(line('x', 0, 0, 1, 1, 'Walls')),
  ];
  for (const op of ops) {
    const error = refusal(() => h.apply(A, [op]));
    assert.deepEqual([error.code, error.message], ['layer_locked', 'Layer Walls is locked.']);
  }
  h.apply(A, [{ type: 'layer_set', name: 'Walls', set: { locked: false } }]);
  h.apply(A, [{ type: 'move', handles: ['L1'], dx: 1, dy: 0 }]);
});

test('entities that come from an xref cannot be changed', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 1, 1)] });
  const ops: OpInput[] = [{ type: 'move', handles: ['Site|L1'], dx: 1, dy: 0 }, { type: 'delete', handles: ['Site|L1'] }, { type: 'modify', handle: 'Site|L1', set: { x2: 1 } }];
  for (const op of ops) {
    assert.equal(refusal(() => h.apply(A, [op])).code, 'invalid');
  }
});

test('modify refuses fields that cannot be set and out-of-range numbers', () => {
  const h = new Harness({ entities: [circle('C1', 0, 0, 1)] });
  assert.equal(refusal(() => h.apply(A, [{ type: 'modify', handle: 'C1', set: { x1: 4 } }])).code, 'invalid');
  assert.equal(refusal(() => h.apply(A, [{ type: 'modify', handle: 'C1', set: { r: 0 } }])).message, 'Enter a number greater than 0.');
  assert.equal(refusal(() => h.apply(A, [{ type: 'modify', handle: 'C1', set: { r: 'big' } }])).message, "That isn't a number.");
  assert.equal(refusal(() => h.apply(A, [{ type: 'modify', handle: 'C9', set: { r: 2 } }])).message, 'No entity C9.');
});

test('move translates every kind of entity', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 1, 1), circle('C2', 0, 0, 1), pline('P3', [[0, 0], [1, 0]], false), arc('A4', 0, 0, 1, 0, 90)] });
  const out = h.apply(A, [{ type: 'move', handles: ['L1', 'C2', 'P3', 'A4'], dx: 2, dy: 3 }]);
  const e = out.state.entities;
  assert.ok(e.L1.type === 'line' && e.L1.x2 === 3 && e.L1.y2 === 4);
  assert.ok(e.C2.type === 'circle' && e.C2.cx === 2 && e.C2.cy === 3);
  assert.deepEqual(e.P3.type === 'pline' && e.P3.points, [[2, 3], [3, 3]]);
  assert.ok(e.A4.type === 'arc' && e.A4.cx === 2);
  assert.deepEqual(out.results[0].handles, ['L1', 'C2', 'P3', 'A4']);
});

test('layers: add, set, rename updates entities, delete rules, saved states', () => {
  const h = new Harness({ layers: [layer('Walls', { colour: 'red' })], entities: [line('L1', 0, 0, 1, 1, 'Walls'), line('L2', 0, 0, 1, 1, 'Walls')] });
  assert.equal(refusal(() => h.apply(A, [{ type: 'layer_delete', name: 'Walls' }])).message, 'Layer Walls has 2 entities. Move them first.');
  assert.equal(refusal(() => h.apply(A, [{ type: 'layer_set', name: '0', set: { rename: 'Zero' } }])).message, "Layer 0 can't be deleted.");
  assert.equal(refusal(() => h.apply(A, [{ type: 'layer_add', name: 'Walls', colour: 'red', linetype: 'Dashed', lineweight: 0.5 }])).message, 'Layer Walls already exists.');
  h.apply(A, [{ type: 'layer_add', name: 'Beams', colour: 'blue', linetype: 'Dashed', lineweight: 0.5 }], { command: 'LAYER' });
  assert.equal(h.state.layers.Beams.linetype, 'Dashed');
  h.apply(A, [{ type: 'layer_state_save', name: 'Base' }]);
  h.apply(A, [{ type: 'layer_set', name: 'Walls', set: { colour: 'green', frozen: true, rename: 'Outer' } }]);
  assert.ok(!('Walls' in h.state.layers) && h.state.layers.Outer.colour === 'green' && h.state.layers.Outer.frozen);
  assert.deepEqual([h.state.entities.L1.layer, h.state.entities.L2.layer], ['Outer', 'Outer']);
  assert.ok(h.state.layer_states.Base.layers.some((l) => l.name === 'Outer'), 'saved states follow a rename');
  h.apply(A, [{ type: 'layer_state_restore', name: 'Base' }]);
  assert.deepEqual([h.state.layers.Outer.colour, h.state.layers.Outer.frozen], ['red', false]);
  assert.equal(refusal(() => h.apply(A, [{ type: 'layer_state_restore', name: 'Nope' }])).message, 'No layer state named Nope.');
  h.apply(A, [{ type: 'layer_delete', name: 'Beams' }]);
  assert.ok(!('Beams' in h.state.layers));
});

test('a restored layer state puts every property back', () => {
  const h = new Harness({ layers: [layer('Walls', { colour: 'red' })] });
  h.apply(A, [{ type: 'layer_state_save', name: 'Base' }], { command: 'LAYERSTATE' });
  h.apply(A, [{ type: 'layer_set', name: 'Walls', set: { colour: 'green', locked: true, on: false } }]);
  const out = h.apply(A, [{ type: 'layer_state_restore', name: 'Base' }], { command: 'LAYERSTATE' });
  assert.deepEqual(out.state.layers.Walls, layer('Walls', { colour: 'red' }));
});

test('conflicts: two people move one entity, the later wins from the base geometry and the earlier author is told', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 10, 0), line('L4', 0, 30, 10, 30)] });
  const base = h.state.revision;
  h.apply(A, [{ type: 'move', handles: ['L1'], dx: 5, dy: 0 }], { base });
  const late = h.apply(B, [{ type: 'move', handles: ['L1'], dx: 0, dy: 3 }], { base });
  assert.equal(late.results[0].status, 'rebased');
  assert.equal(late.results[0].message, null);
  assert.deepEqual(late.notices, [{ username: A, text: copy.conflictMoved(B, 'L1') }]);
  assert.ok(late.state.entities.L1.type === 'line' && late.state.entities.L1.x1 === 0 && late.state.entities.L1.y1 === 3);
  const base2 = h.state.revision;
  h.apply(A, [{ type: 'modify', handle: 'L4', set: { x2: 20 } }], { base: base2 });
  const modified = h.apply(B, [{ type: 'modify', handle: 'L4', set: { y2: 7 } }], { base: base2 });
  assert.equal(modified.results[0].status, 'rebased');
  assert.deepEqual(modified.notices, [{ username: A, text: copy.conflictChanged(B, 'L4') }]);
  const l4 = modified.state.entities.L4;
  assert.ok(l4.type === 'line' && l4.x2 === 10 && l4.y2 === 7);
});

test('conflicts: a person never conflicts with themselves', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 10, 0)] });
  const base = h.state.revision;
  h.apply(A, [{ type: 'move', handles: ['L1'], dx: 5, dy: 0 }], { base });
  const again = h.apply(A, [{ type: 'move', handles: ['L1'], dx: 0, dy: 3 }], { base });
  assert.equal(again.results[0].status, 'applied');
  assert.ok(again.state.entities.L1.type === 'line' && again.state.entities.L1.x1 === 5 && again.state.entities.L1.y1 === 3);
});

test('conflicts: an edit to an entity someone deleted is dropped and its author is told', () => {
  const h = new Harness({ entities: [line('L2', 0, 10, 10, 10)] });
  const base = h.state.revision;
  h.apply(B, [{ type: 'delete', handles: ['L2'] }], { base });
  const revision = h.state.revision;
  const late = h.apply(A, [{ type: 'modify', handle: 'L2', set: { x2: 20 } }], { base });
  assert.deepEqual([late.results[0].status, late.results[0].message], ['dropped', copy.conflictDeleted(B, 'L2')]);
  assert.deepEqual(late.notices, [{ username: A, text: copy.conflictDeleted(B, 'L2') }]);
  assert.equal(late.changes.length, 0);
  assert.equal(late.state.revision, revision + 1, 'a dropped op still counts');
});

test('conflicts: a move of several entities drops only the deleted ones', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 1, 0), line('L2', 0, 5, 1, 5)] });
  const base = h.state.revision;
  h.apply(B, [{ type: 'delete', handles: ['L2'] }], { base });
  const late = h.apply(A, [{ type: 'move', handles: ['L1', 'L2'], dx: 1, dy: 0 }], { base });
  assert.deepEqual([late.results[0].status, late.results[0].handles], ['rebased', ['L1']]);
  assert.equal(late.results[0].message, copy.conflictDeleted(B, 'L2'));
});

test('conflicts: an entity added on a layer someone deleted goes to layer 0', () => {
  const h = new Harness({ layers: [layer('Temp')] });
  const base = h.state.revision;
  h.apply(B, [{ type: 'layer_delete', name: 'Temp' }], { base, command: 'LAYER' });
  const late = h.apply(A, [add(line('x', 50, 0, 60, 0, 'Temp'))], { base });
  assert.equal(late.results[0].status, 'redirected');
  assert.deepEqual(late.notices, [{ username: A, text: copy.conflictLayerDeleted(B, 'Temp') }]);
  assert.equal(late.state.entities[late.results[0].handles[0]].layer, '0');
});

test('a missing layer nobody deleted is an error', () => {
  const h = new Harness();
  assert.equal(refusal(() => h.apply(A, [add(line('x', 0, 0, 1, 1, 'Nowhere'))])).message, 'No layer named Nowhere.');
});

test('isServerOnlyOp names the ops that need server data', () => {
  const [attach, move] = withIds([{ type: 'xref_attach', name: 'S', source: 'd', x: 0, y: 0, scale: 1, rotation: 0 }, { type: 'move', handles: ['L1'], dx: 0, dy: 0 }]);
  assert.deepEqual([isServerOnlyOp(attach), isServerOnlyOp(move)], [true, false]);
});

test('the browser can hand out its own handles', () => {
  const h = new Harness();
  let n = 0;
  const out = applyGroup(h.state, { base_revision: 0, group_id: 'g', command: 'LINE', ops: withIds([add(line('x', 0, 0, 1, 1))]) },
    { username: A, assignHandle: () => `new-${(n += 1)}` });
  assert.deepEqual(out.results[0].handles, ['new-1']);
  assert.equal(out.state.next_handle, 1);
});

test('undo and redo round-trip, and the patch equals the new state', () => {
  const h = new Harness({ layers: [layer('Walls')], entities: [line('L1', 0, 0, 10, 0, 'Walls'), line('L2', 0, 5, 10, 5)] });
  const steps: [string, OpInput[]][] = [
    ['MOVE', [{ type: 'move', handles: ['L1'], dx: 1, dy: 2 }]],
    ['LINE', [add(line('x', 3, 3, 4, 4))]],
    ['LAYER', [{ type: 'layer_set', name: 'Walls', set: { colour: 'red', rename: 'Outer' } }]],
    ['ERASE', [{ type: 'delete', handles: ['L2'] }]],
  ];
  for (const [command, ops] of steps) {
    const before = h.state;
    const out = h.apply(A, ops, { command });
    assert.deepEqual(applyPatch(before, out.patch), out.state, `patch of ${command}`);
    const after = h.state;
    h.undo(A);
    assert.deepEqual({ ...h.state, revision: 0 }, { ...before, revision: 0, next_handle: h.state.next_handle }, `undo of ${command}`);
    h.undo(A, 'redo');
    assert.deepEqual({ ...h.state, revision: 0 }, { ...after, revision: 0 }, `redo of ${command}`);
  }
});

test('undo is skipped when someone else changed a target after the group', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 10, 0), line('L2', 0, 10, 10, 10)] });
  h.apply(A, [{ type: 'delete', handles: ['L2'] }], { command: 'ERASE' });
  h.apply(A, [{ type: 'move', handles: ['L1'], dx: 2, dy: 0 }], { command: 'MOVE' });
  h.apply(B, [{ type: 'move', handles: ['L1'], dx: 0, dy: 5 }], { command: 'MOVE' });
  const error = refusal(() => h.undo(A));
  assert.deepEqual([error.code, error.message], ['undo_superseded', copy.undoSuperseded(B, 'L1')]);
  assert.equal(h.undo(A), 'ERASE');
  assert.ok('L2' in h.entities);
});

test('an undo is one synthetic op: revision advances by 1 and the result list is empty', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 10, 0)] });
  h.apply(A, [{ type: 'move', handles: ['L1'], dx: 1, dy: 0 }, { type: 'move', handles: ['L1'], dx: 1, dy: 0 }]);
  const revision = h.state.revision;
  h.undo(A);
  assert.equal(h.state.revision, revision + 1);
});

test('the change log reads an entity back as it was at a base revision', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 10, 0)] });
  const base = h.state.revision;
  h.apply(A, [{ type: 'move', handles: ['L1'], dx: 5, dy: 0 }]);
  h.apply(B, [{ type: 'move', handles: ['L1'], dx: 0, dy: 3 }]);
  const early = h.probe.entityAt('L1', base);
  assert.ok(early?.type === 'line' && early.x1 === 0 && early.y1 === 0 && early.x2 === 10);
  assert.equal(h.probe.entityAt('L2', base), null);
  assert.equal(h.probe.entityAt('L1', h.state.revision), h.entities.L1);
});

test('a number too large to keep refuses the whole group instead of being stored as null', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 1, 1), circle('C2', 0, 0, 1)] });
  const before = h.state;
  for (const ops of [
    [add(circle('x', 0, 0, 1e308))],
    [add(line('x', 1e308, 0, -1e308, 0))],
    [{ type: 'modify', handle: 'C2', set: { r: 1e308 } }],
    [{ type: 'move', handles: ['L1'], dx: 1e308, dy: 0 }, { type: 'move', handles: ['L1'], dx: 1e308, dy: 0 }],
  ] satisfies OpInput[][]) {
    const error = refusal(() => h.apply(A, ops));
    assert.equal(error.code, 'invalid');
    assert.equal(error.message, copy.NUMBER_TOO_LARGE);
  }
  assert.equal(h.state, before);
});

test('a dimension style keeps its precision to what a number can print', () => {
  const h = new Harness({});
  const style = (precision: number): OpInput => ({ type: 'dim_style_set', name: 'Fine', precision, prefix: '', suffix: '', scale: 1, text_height_mm: 2.5 });
  assert.equal(h.apply(A, [style(12)]).state.dim_styles.Fine.precision, 12);
  assert.equal(refusal(() => h.apply(A, [style(13)])).code, 'invalid');
  assert.equal(refusal(() => h.apply(A, [style(1e9)])).code, 'invalid');
});
