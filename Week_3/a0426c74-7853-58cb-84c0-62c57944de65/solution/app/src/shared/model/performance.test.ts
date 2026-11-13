import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyGroup, applyPatch, applyRestore, seedDrawing } from './index.ts';
import { withIds } from './testing.ts';

const state = seedDrawing({ generate: { lines: 10000, spacing: 2 }, constraints: [] });

function mean(runs: number, work: () => void): number {
  work();
  const start = performance.now();
  for (let i = 0; i < runs; i += 1) work();
  return (performance.now() - start) / runs;
}

test('a one-op group on 10 000 entities takes a few milliseconds', () => {
  const group = { base_revision: 0, group_id: 'g', command: 'MOVE', ops: withIds([{ type: 'move', handles: ['L5000'], dx: 1, dy: 0 }]) };
  const outcome = applyGroup(state, group, { username: 'asha' });
  assert.equal(Object.keys(outcome.state.entities).length, 10000);
  assert.equal(outcome.state.entities.L1, state.entities.L1, 'untouched entities are shared');
  const applyMs = mean(50, () => applyGroup(state, group, { username: 'asha' }));
  const patchMs = mean(50, () => applyPatch(state, outcome.patch));
  const undoMs = mean(50, () => applyRestore(outcome.state, outcome.changes, 'undo', { username: 'asha' }));
  console.log(`10k entities: group ${applyMs.toFixed(2)} ms, patch ${patchMs.toFixed(2)} ms, restore ${undoMs.toFixed(2)} ms`);
  assert.ok(applyMs < 15 && patchMs < 15 && undoMs < 15);
});

test('adding one entity to 10 000 entities with a hatch and a dimension present stays fast', () => {
  const seeded = seedDrawing({
    generate: { lines: 10000, spacing: 2 },
    entities: [{ type: 'pline', handle: 'P1', layer: '0', points: [[-5, -5], [-1, -5], [-1, -1], [-5, -1]], closed: true }, { type: 'hatch', handle: 'H2', layer: '0', seed_x: -3, seed_y: -3 }],
  });
  const group = { base_revision: 0, group_id: 'g', command: 'LINE', ops: withIds([{ type: 'add', entity: { type: 'line', layer: '0', x1: 0, y1: 1, x2: 1, y2: 1 } }]) };
  const ms = mean(20, () => applyGroup(seeded, group, { username: 'asha' }));
  console.log(`10k entities with a hatch, add: ${ms.toFixed(2)} ms`);
  assert.ok(ms < 50);
});
