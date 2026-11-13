import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '../../shared/errors.ts';
import { seedDrawing } from '../../shared/model/index.ts';
import { line } from '../../shared/model/testing.ts';
import type { OperationGroup, StatePatch } from '../../shared/types.ts';
import type { OpInput } from './types.ts';
import { Replica } from './replica.ts';

let counter = 0;
const group = (command: string, ...ops: OpInput[]): OperationGroup =>
  ({ base_revision: 0, group_id: `g${++counter}`, command, ops: ops.map((op) => ({ ...op, op_id: `o${++counter}` })) });
const addLine = (x: number): OpInput => ({ type: 'add', entity: { type: 'line', layer: '0', x1: x, y1: 0, x2: x + 1, y2: 0 } });

describe('Replica', () => {
  it('shows a group at once with optimistic handles and replaces them when the server confirms', () => {
    const replica = new Replica(seedDrawing({}), 'asha');
    replica.submit(group('LINE', addLine(0)));
    assert.deepEqual(Object.keys(replica.visible.entities), ['new-1']);
    assert.equal(replica.pendingOps, 1);
    const [entry] = replica.pending;
    const patch: StatePatch = {
      revision: 1, next_handle: 2, entities_upsert: [line('L1', 0, 0, 1, 0)], entities_delete: [],
    };
    replica.settle(patch, { groupId: entry.group.group_id, results: [{ op_id: entry.group.ops[0].op_id, status: 'applied', handles: ['L1'], message: null }] });
    assert.deepEqual(Object.keys(replica.visible.entities), ['L1']);
    assert.equal(replica.pendingOps, 0);
  });

  it('renames an optimistic handle in later groups when the earlier group is confirmed', () => {
    const replica = new Replica(seedDrawing({}), 'asha');
    replica.submit(group('LINE', addLine(0)));
    replica.submit(group('MOVE', { type: 'move', handles: ['new-1'], dx: 5, dy: 0 }));
    const first = replica.pending[0];
    replica.settle(
      { revision: 1, next_handle: 2, entities_upsert: [line('L1', 0, 0, 1, 0)], entities_delete: [] },
      { groupId: first.group.group_id, results: [{ op_id: first.group.ops[0].op_id, status: 'applied', handles: ['L1'], message: null }] },
    );
    assert.deepEqual(replica.pending[0].group.ops[0], { ...replica.pending[0].group.ops[0], type: 'move', handles: ['L1'] });
    const moved = replica.visible.entities.L1;
    assert.equal(moved.type === 'line' && moved.x1, 5);
  });

  it('refuses a group the engine refuses and leaves the state alone', () => {
    const replica = new Replica(seedDrawing({ entities: [line('L1', 0, 0, 1, 0)] }), 'asha');
    assert.throws(() => replica.submit(group('LAYER', { type: 'layer_delete', name: '0' })), ApiError);
    assert.equal(replica.pending.length, 0);
    assert.equal(replica.pendingOps, 0);
  });

  it('keeps a group that another person made impossible queued but invisible', () => {
    const replica = new Replica(seedDrawing({ entities: [line('L1', 0, 0, 1, 0)] }), 'asha');
    replica.submit(group('MOVE', { type: 'move', handles: ['L1'], dx: 1, dy: 0 }));
    replica.settle({ revision: 1, next_handle: 2, entities_upsert: [], entities_delete: ['L1'] }, null);
    assert.deepEqual(Object.keys(replica.visible.entities), []);
    assert.equal(replica.pendingOps, 1);
  });

  it('drops the last group for an offline undo', () => {
    const replica = new Replica(seedDrawing({}), 'asha');
    replica.submit(group('LINE', addLine(0)));
    replica.submit(group('LINE', addLine(5)));
    assert.equal(replica.popLast()?.group.command, 'LINE');
    assert.equal(Object.keys(replica.visible.entities).length, 1);
    assert.equal(replica.pendingOps, 1);
  });
});
