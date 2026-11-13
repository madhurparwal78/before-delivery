import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as copy from '../copy.ts';
import { emptyDrawingState } from '../model/index.ts';
import { withIds } from '../model/testing.ts';
import type { BlockDef, DistributiveOmit, EntityDraft, Op, OperationGroup, OpResult } from '../types.ts';
import { ownAnnouncement, remoteAnnouncement } from './announce.ts';

const ops = (...specs: DistributiveOmit<Op, 'op_id'>[]): Op[] => withIds(specs);
const group = (command: string, list: Op[]): OperationGroup => ({ base_revision: 0, group_id: 'g', command, ops: list });
const applied = (...handles: string[][]): OpResult[] => handles.map((h, i) => ({ op_id: `r${i}`, status: 'applied', handles: h, message: null }));
const line: EntityDraft = { type: 'line', layer: '0', x1: 0, y1: 0, x2: 1, y2: 0 };

describe('remote announcements', () => {
  it('says moved <handle> for a move of one entity', () => {
    assert.equal(remoteAnnouncement('bram', ops({ type: 'move', handles: ['L1'], dx: 1, dy: 0 })), 'bram moved L1');
  });

  it('counts the distinct entities the explicit ops touched, singular and plural', () => {
    assert.equal(remoteAnnouncement('bram', ops({ type: 'add', entity: line })), copy.otherChanged('bram', 1));
    assert.equal(remoteAnnouncement('bram', ops({ type: 'delete', handles: ['L1', 'L2'] })), copy.otherChanged('bram', 2));
    assert.equal(remoteAnnouncement('bram', ops({ type: 'move', handles: ['L1', 'L2'], dx: 1, dy: 0 })), copy.otherChanged('bram', 2));
    assert.equal(remoteAnnouncement('bram', ops({ type: 'modify', handle: 'L1', set: { x2: 5 } }, { type: 'add', entity: line })), copy.otherChanged('bram', 2));
    assert.equal(remoteAnnouncement('bram', ops({ type: 'modify', handle: 'L1', set: { x2: 5 } }, { type: 'modify', handle: 'L1', set: { y2: 5 } })), copy.otherChanged('bram', 1));
  });

  it('says nothing for ops that touch no entity', () => {
    assert.equal(remoteAnnouncement('bram', ops({ type: 'layer_set', name: 'Walls', set: { locked: true } }, { type: 'parameter_set', name: 'd1', expression: '2' })), null);
  });
});

describe('own announcements', () => {
  const before = emptyDrawingState();

  it('names the kind and handle of one new entity and counts several', () => {
    assert.equal(ownAnnouncement(group('LINE', ops({ type: 'add', entity: line })), applied(['L1']), before), 'Line L1 added');
    assert.equal(ownAnnouncement(group('CIRCLE', ops({ type: 'add', entity: { type: 'circle', layer: '0', cx: 0, cy: 0, r: 1 } })), applied(['C4']), before), 'Circle C4 added');
    assert.equal(ownAnnouncement(group('LINE', ops({ type: 'add', entity: line }, { type: 'add', entity: line })), applied(['L1'], ['L2']), before), '2 entities added');
  });

  it('counts a trim as each modified entity once plus each added one, a circle replaced by its arc once', () => {
    const split = group('TRIM', ops({ type: 'modify', handle: 'L1', set: { x2: 5 } }, { type: 'add', entity: line }));
    assert.equal(ownAnnouncement(split, applied(['L1'], ['L9']), before), 'Trim: 2 entities changed');
    const circle = group('TRIM', ops({ type: 'add', entity: { type: 'arc', layer: '0', cx: 0, cy: 0, r: 1, start: 0, end: 90 } }, { type: 'delete', handles: ['C6'] }));
    assert.equal(ownAnnouncement(circle, applied(['A7'], ['C6']), before), copy.trimmed(1));
  });

  it('words the modify commands', () => {
    const move = group('MOVE', ops({ type: 'move', handles: ['L1', 'L2'], dx: 1, dy: 0 }));
    assert.equal(ownAnnouncement(move, applied(['L1', 'L2']), before), 'Moved 2 entities');
    assert.equal(ownAnnouncement({ ...move, command: 'NUDGE' }, applied(['L1', 'L2']), before), 'Moved 2 entities');
    assert.equal(ownAnnouncement(group('ERASE', ops({ type: 'delete', handles: ['L1'] })), applied(['L1']), before), 'Erased 1 entity');
    assert.equal(ownAnnouncement(group('ARRAY', ops({ type: 'add', entity: line }, { type: 'add', entity: line })), applied(['L2'], ['L3']), before), 'Arrayed: 2 copies added');
    assert.equal(ownAnnouncement(group('OFFSET', ops({ type: 'add', entity: line })), applied(['L2']), before), copy.offsetAdded(1));
    assert.equal(ownAnnouncement(group('EXTEND', ops({ type: 'modify', handle: 'L1', set: { x2: 9 } })), applied(['L1']), before), 'Extend: 1 entity changed');
  });

  it('says defined or redefined by whether the block existed, and counts what an explode made', () => {
    const define = group('BLOCK', ops({ type: 'block_define', name: 'Door', base: [0, 0], handles: ['L1'], attributes: [] }));
    assert.equal(ownAnnouncement(define, applied(['I2']), before), 'Block Door defined');
    const door: BlockDef = { name: 'Door', base: [0, 0], entities: [], attributes: [] };
    const existing = { ...before, blocks: { Door: door } };
    assert.equal(ownAnnouncement(define, applied(['I2']), existing), 'Block Door redefined');
    const explode = group('EXPLODE', ops({ type: 'explode', handle: 'I2' }));
    assert.equal(ownAnnouncement(explode, applied(['L5']), before), copy.exploded('I2', 1));
    assert.equal(ownAnnouncement(group('EXPLODE', ops({ type: 'explode', handle: 'I2' }, { type: 'explode', handle: 'I3' })), applied(['L5', 'L6'], ['L7']), before), '3 entities added');
  });

  it('has no announcement for the commands the brief gives none', () => {
    assert.equal(ownAnnouncement(group('PARAM', ops({ type: 'parameter_set', name: 'd1', expression: '2' })), applied([]), before), null);
  });
});
