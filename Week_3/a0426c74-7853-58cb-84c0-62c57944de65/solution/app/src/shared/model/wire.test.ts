import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../errors.ts';
import { parseDrawingSeed, parseOperationGroup } from './index.ts';

function invalidField(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ApiError && error.code === 'invalid', String(error));
    return Object.keys(error.fields ?? {})[0] ?? '';
  }
  return assert.fail('expected a refusal');
}

const body = (ops: unknown[], extra: Record<string, unknown> = {}): unknown => ({ base_revision: 3, group_id: 'g1', command: 'MOVE', ops, ...extra });

test('every operation type of the brief reads into a typed group', () => {
  const ops = [
    { op_id: '1', type: 'add', entity: { type: 'line', layer: '0', x1: 0, y1: 0, x2: 1, y2: 1 } },
    { op_id: '2', type: 'add', entity: { type: 'hatch', layer: '0', seed_x: 1, seed_y: 2 } },
    { op_id: '3', type: 'add', entity: { type: 'dimension', layer: '0', kind: 'aligned', style: 'Standard', refs: [{ handle: 'L1', point: 'start' }, { handle: 'L1', point: 'end' }], override: null, text_x: 5, text_y: 2 } },
    { op_id: '4', type: 'modify', handle: 'L1', set: { x2: 20 } },
    { op_id: '5', type: 'move', handles: ['L1'], dx: 1, dy: 0 },
    { op_id: '6', type: 'delete', handles: ['L1'] },
    { op_id: '7', type: 'layer_add', name: 'Walls', colour: 'red', linetype: 'Dashed', lineweight: 0.5 },
    { op_id: '8', type: 'layer_set', name: 'Walls', set: { locked: true, rename: 'Outer' } },
    { op_id: '9', type: 'layer_delete', name: 'Outer' },
    { op_id: '10', type: 'layer_state_save', name: 'Base' },
    { op_id: '11', type: 'layer_state_restore', name: 'Base' },
    { op_id: '12', type: 'block_define', name: 'Door', base: [0, 0], handles: ['L1'], attributes: [{ tag: 'MARK', default: 'A1' }] },
    { op_id: '13', type: 'explode', handle: 'I1' },
    { op_id: '14', type: 'purge' },
    { op_id: '15', type: 'dim_style_set', name: 'Standard', precision: 3, prefix: '', suffix: '', scale: 1, text_height_mm: 2.5 },
    { op_id: '16', type: 'constraint_add', kind: 'length', refs: [{ handle: 'L1', point: null }], expression: 'd1' },
    { op_id: '17', type: 'constraint_delete', id: 'K1' },
    { op_id: '18', type: 'parameter_set', name: 'd1', expression: '5' },
    { op_id: '19', type: 'parameter_delete', name: 'd1' },
    { op_id: '20', type: 'xref_attach', name: 'Site', source: 'd', x: 0, y: 0, scale: 1, rotation: 0 },
    { op_id: '21', type: 'xref_clip', name: 'Site', rect: [0, 0, 1, 1] },
    { op_id: '22', type: 'xref_clip', name: 'Site', rect: null },
    { op_id: '23', type: 'xref_reload', name: 'Site' },
    { op_id: '24', type: 'xref_bind', name: 'Site' },
    { op_id: '25', type: 'version_restore', version: 'v' },
    { op_id: '26', type: 'import_merge', import_id: 'i' },
  ];
  const group = parseOperationGroup(body(ops));
  assert.deepEqual(group.ops.map((op) => op.type), ops.map((op) => op.type));
  assert.deepEqual([group.base_revision, group.group_id, group.command], [3, 'g1', 'MOVE']);
  assert.deepEqual(group.ops[15], { op_id: '16', type: 'constraint_add', kind: 'length', refs: [{ handle: 'L1', point: null }], expression: 'd1' });
});

test('malformed groups name the offending field', () => {
  assert.equal(invalidField(() => parseOperationGroup(null)), 'body');
  assert.equal(invalidField(() => parseOperationGroup(body([], {}))), 'ops');
  assert.equal(invalidField(() => parseOperationGroup(body([{ op_id: 'a', type: 'purge' }], { base_revision: -1 }))), 'base_revision');
  assert.equal(invalidField(() => parseOperationGroup(body([{ op_id: 'a', type: 'purge' }], { base_revision: 1.5 }))), 'base_revision');
  assert.equal(invalidField(() => parseOperationGroup(body([{ op_id: 'a', type: 'purge' }], { group_id: '' }))), 'group_id');
  assert.equal(invalidField(() => parseOperationGroup(body([{ op_id: 'a', type: 'teleport' }]))), 'ops[0].type');
  assert.equal(invalidField(() => parseOperationGroup(body([{ op_id: 'a', type: 'move', handles: ['L1'], dx: '1', dy: 0 }]))), 'ops[0].dx');
  assert.equal(invalidField(() => parseOperationGroup(body([{ op_id: 'a', type: 'add', entity: { type: 'line', layer: '0', x1: 0 } }]))), 'ops[0].entity.y1');
  assert.equal(invalidField(() => parseOperationGroup(body([{ op_id: 'a', type: 'layer_add', name: 'W', colour: 'purple', linetype: 'Dashed', lineweight: 0.5 }]))), 'ops[0].colour');
  assert.equal(invalidField(() => parseOperationGroup(body([{ type: 'purge' }]))), 'ops[0].op_id');
});

test('a seed record reads into the engine-facing fields', () => {
  const seed = parseDrawingSeed({
    key: 'd', folder: 'f', name: 'Plot plan', sheets: [],
    layers: [{ name: 'Walls', colour: 'red', linetype: 'Continuous', lineweight: 0.25, on: true, frozen: false, locked: false }],
    entities: [{ handle: 'L1', type: 'line', layer: 'Walls', x1: 0, y1: 0, x2: 10, y2: 0 }],
    generate: { lines: 5, spacing: 2 },
    blocks: [{ name: 'Door', base: [0, 0], entities: [], attributes: [{ tag: 'MARK', default: 'A1' }] }],
    xrefs: [{ name: 'Site', source: 'src', x: 0, y: 0, scale: 1, rotation: 0, clip: null }],
    constraints: [{ kind: 'fixed', refs: [{ handle: 'L1', point: 'start' }] }], layer_states: [{ name: 'Base' }],
  });
  assert.deepEqual(seed.entities?.[0], { handle: 'L1', type: 'line', layer: 'Walls', x1: 0, y1: 0, x2: 10, y2: 0 });
  assert.deepEqual(seed.xrefs, [{ name: 'Site', source: 'src', x: 0, y: 0, scale: 1, rotation: 0, clip: null }]);
  assert.deepEqual(seed.generate, { lines: 5, spacing: 2 });
  assert.deepEqual(parseDrawingSeed({}).xrefs, []);
  assert.equal(invalidField(() => parseDrawingSeed({ entities: [{ type: 'line', layer: '0', x1: 0, y1: 0, x2: 1, y2: 1 }] })), 'entities[0].handle');
});

test('an op id is used once in a group, and a base revision fits the stored 32-bit revision', () => {
  const purge = (id: string) => ({ op_id: id, type: 'purge' });
  assert.equal(invalidField(() => parseOperationGroup(body([purge('a'), purge('b'), purge('a')]))), 'ops[2].op_id');
  assert.equal(invalidField(() => parseOperationGroup(body([purge('a')], { base_revision: 2 ** 31 }))), 'base_revision');
  assert.equal(invalidField(() => parseOperationGroup(body([purge('a')], { base_revision: 1e308 }))), 'base_revision');
  assert.equal(parseOperationGroup(body([purge('a')], { base_revision: 2 ** 31 - 1 })).base_revision, 2 ** 31 - 1);
});

test('a seed generates a bounded number of whole lines', () => {
  for (const lines of [-1, 2.5, 200001, 1e9, 1e308]) {
    assert.equal(invalidField(() => parseDrawingSeed({ generate: { lines, spacing: 1 } })), 'generate.lines', String(lines));
  }
  assert.deepEqual(parseDrawingSeed({ generate: { lines: 200000, spacing: 1 } }).generate, { lines: 200000, spacing: 1 });
});
