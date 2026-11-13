import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as copy from '../copy.ts';
import { ApiError } from '../errors.ts';
import type { Entity } from '../types.ts';
import { purgeCandidates } from './index.ts';
import { Harness, add, insert, layer, line } from './testing.ts';

const A = 'asha';

function refusal(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ApiError, String(error));
    return error;
  }
  return assert.fail('expected a refusal');
}

const door = { name: 'Door', base: [0, 0] as [number, number], entities: [line('L50', 0, 0, 1, 0)], attributes: [{ tag: 'MARK', default: 'A1' }] };

test('BLOCK moves the picked entities into the definition and adds one insert at the base point', () => {
  const h = new Harness({ layers: [layer('Walls')], entities: [line('L1', 0, 0, 1, 0, 'Walls'), line('L2', 5, 5, 6, 5)] });
  const out = h.apply(A, [{ type: 'block_define', name: 'Door', base: [2, 3], handles: ['L1', 'L2'], attributes: [{ tag: 'MARK', default: 'A1' }] }], { command: 'BLOCK' });
  assert.deepEqual(out.results[0].handles, ['I3']);
  assert.ok(!('L1' in out.state.entities) && !('L2' in out.state.entities));
  assert.deepEqual(out.state.blocks.Door.entities.map((e) => e.handle), ['L1', 'L2']);
  const made = out.state.entities.I3;
  assert.ok(made.type === 'insert' && made.x === 2 && made.y === 3 && made.scale === 1 && made.layer === 'Walls');
  assert.deepEqual(made.type === 'insert' && made.attributes, { MARK: 'A1' });
});

test('redefining updates every insert, keeps values of tags that remain and gives new tags their defaults', () => {
  const h = new Harness({
    blocks: [door, { name: 'Outer', base: [0, 0], entities: [insert('I51', 'Door', 0, 0, 1, 0, { MARK: 'N1' })], attributes: [] }],
    entities: [insert('I1', 'Door', 10, 0, 2, 90, { MARK: 'X9' }), insert('I2', 'Door', 20, 0, 1, 0, { MARK: 'A1' }), line('L3', 0, 0, 0, 3)],
  });
  const out = h.apply(A, [{ type: 'block_define', name: 'Door', base: [0, 0], handles: ['L3'], attributes: [{ tag: 'MARK', default: 'Z' }, { tag: 'NOTE', default: 'N' }] }]);
  const attributes = (e: Entity | undefined): unknown => (e?.type === 'insert' ? e.attributes : undefined);
  assert.deepEqual(attributes(out.state.entities.I1), { MARK: 'X9', NOTE: 'N' });
  assert.deepEqual(attributes(out.state.entities.I2), { MARK: 'A1', NOTE: 'N' });
  assert.deepEqual(attributes(out.state.blocks.Outer.entities[0]), { MARK: 'N1', NOTE: 'N' });
  const added = out.state.entities[out.results[0].handles[0]];
  assert.deepEqual(attributes(added), { MARK: 'Z', NOTE: 'N' });
  assert.deepEqual(out.state.blocks.Door.entities.map((e) => e.handle), ['L3']);
});

test('removing a tag drops its values from the inserts', () => {
  const h = new Harness({ blocks: [door], entities: [insert('I1', 'Door', 0, 0, 1, 0, { MARK: 'X9' }), line('L3', 0, 0, 0, 3)] });
  const out = h.apply(A, [{ type: 'block_define', name: 'Door', base: [0, 0], handles: ['L3'], attributes: [] }]);
  assert.deepEqual(out.state.entities.I1.type === 'insert' && out.state.entities.I1.attributes, {});
});

test('a definition that contains itself is refused with its chain', () => {
  const h = new Harness({
    blocks: [door, { name: 'Outer', base: [0, 0], entities: [insert('I51', 'Door', 0, 0)], attributes: [] }],
    entities: [insert('I4', 'Outer', 50, 50), line('L3', 0, 0, 0, 3)],
  });
  const error = refusal(() => h.apply(A, [{ type: 'block_define', name: 'Door', base: [0, 0], handles: ['I4'], attributes: [] }]));
  assert.deepEqual([error.code, error.message], ['invalid', copy.blockSelfContained('Door', ['Door', 'Outer', 'Door'])]);
});

test('blocks may nest: picking an insert puts it in the new definition', () => {
  const h = new Harness({ blocks: [door], entities: [insert('I1', 'Door', 0, 0), line('L2', 5, 5, 6, 5)] });
  const out = h.apply(A, [{ type: 'block_define', name: 'Frame', base: [0, 0], handles: ['I1', 'L2'], attributes: [] }]);
  assert.ok(out.state.blocks.Frame.entities.some((e) => e.type === 'insert' && e.block === 'Door'));
});

test('EXPLODE puts the definition entities at their drawn positions with new handles and drops the attributes', () => {
  const h = new Harness({ blocks: [door], entities: [insert('I1', 'Door', 10, 0, 2, 90, { MARK: 'X9' })] });
  const out = h.apply(A, [{ type: 'explode', handle: 'I1' }], { command: 'EXPLODE' });
  assert.ok(!('I1' in out.state.entities));
  const [handle] = out.results[0].handles;
  const exploded = out.state.entities[handle];
  assert.equal(handle, 'L51');
  assert.ok(exploded.type === 'line' && Math.abs(exploded.x1 - 10) < 1e-9 && Math.abs(exploded.y1) < 1e-9 && Math.abs(exploded.x2 - 10) < 1e-9 && Math.abs(exploded.y2 - 2) < 1e-9);
  assert.equal(refusal(() => h.apply(A, [{ type: 'explode', handle: handle }])).message, 'L51 is not a block insert.');
});

test('PURGE removes unreachable blocks and empty layers other than 0, and returns the counts', () => {
  const h = new Harness({
    layers: [layer('E1'), layer('E2'), layer('Used')],
    blocks: [door, { name: 'Outer', base: [0, 0], entities: [insert('I51', 'Door', 0, 0)], attributes: [] },
      { name: 'Spare1', base: [0, 0], entities: [line('L52', 0, 0, 1, 1)], attributes: [] }, { name: 'Spare2', base: [0, 0], entities: [line('L53', 0, 0, 1, 1)], attributes: [] }],
    entities: [insert('I4', 'Outer', 50, 50), line('L5', 0, 0, 1, 1, 'Used')],
  });
  assert.deepEqual(purgeCandidates(h.state), { blocks: ['Spare1', 'Spare2'], layers: ['E1', 'E2'] });
  const out = h.apply(A, [{ type: 'purge' }], { command: 'PURGE' });
  assert.deepEqual(out.purged, { blocks: 2, layers: 2 });
  assert.deepEqual(Object.keys(out.state.blocks).sort(), ['Door', 'Outer']);
  assert.deepEqual(Object.keys(out.state.layers).sort(), ['0', 'Used']);
});

test('an insert made while someone redefined its block is redirected to the new definition', () => {
  const h = new Harness({ blocks: [{ name: 'Door', base: [0, 0], entities: [line('L50', 0, 0, 1, 0)], attributes: [] }], entities: [line('L3', 0, 0, 0, 3)] });
  const base = h.state.revision;
  h.apply('bram', [{ type: 'block_define', name: 'Door', base: [0, 0], handles: ['L3'], attributes: [{ tag: 'T', default: 'd' }] }], { base, command: 'BLOCK' });
  const late = h.apply(A, [add(insert('x', 'Door', 70, 0))], { base, command: 'INSERT' });
  assert.equal(late.results[0].status, 'redirected');
  assert.deepEqual(late.notices, [{ username: A, text: copy.conflictRedefined('bram', 'Door') }]);
  const made = late.state.entities[late.results[0].handles[0]];
  assert.deepEqual(made.type === 'insert' && made.attributes, { T: 'd' });
});

test('inserting an unknown block is refused', () => {
  const h = new Harness();
  assert.equal(refusal(() => h.apply(A, [add(insert('x', 'Nope', 0, 0))])).message, 'No block named Nope.');
});
