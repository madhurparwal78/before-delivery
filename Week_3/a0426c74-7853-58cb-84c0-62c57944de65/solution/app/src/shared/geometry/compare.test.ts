import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Entity, ModelSnapshot, Xref } from '../types.ts';
import { block, insert, layer, line } from './fixtures.ts';
import { diffModels, markupFlags } from './compare.ts';

const model = (entities: Entity[], extra: Partial<ModelSnapshot> = {}): ModelSnapshot => ({ layers: [layer('0')], entities, blocks: [], xrefs: [], ...extra });
const door = block('Door', [line('L50', 0, 0, 1, 0)]);
const diffOf = (entry: ModelSnapshot['entities'], later: ModelSnapshot['entities'], extra: Partial<ModelSnapshot> = {}, laterExtra: Partial<ModelSnapshot> = extra) =>
  diffModels(model(entry, extra), model(later, laterExtra));
const state = (d: ReturnType<typeof diffModels>): Record<string, string> => Object.fromEntries(d.result.entities.map((e) => [e.id, e.diff]));

describe('compare', () => {
  it('counts added, removed and changed with the 0.001 rule', () => {
    const before = [line('L1', 0, 0, 10, 0), line('L2', 0, 10, 10, 10), line('L3', 0, 20, 10, 20)];
    const after = [line('L1', 0.0005, 0, 10, 0), line('L2', 0, 10, 12, 10), line('L9', 0, 40, 5, 40)];
    const d = diffOf(before, after);
    assert.deepEqual([d.result.added, d.result.removed, d.result.changed], [1, 1, 1]);
    assert.deepEqual(state(d), { L1: 'same', L2: 'changed', L9: 'added', L3: 'removed' });
  });

  it('treats a number differing by more than 0.001 as changed', () => {
    assert.equal(state(diffOf([line('L1', 0, 0, 10, 0)], [line('L1', 0, 0, 10.0011, 0)]))['L1'], 'changed');
  });

  it('treats any other field as a change: layer, colour, pline points', () => {
    assert.equal(state(diffOf([line('L1', 0, 0, 1, 0)], [line('L1', 0, 0, 1, 0, 'Walls')], { layers: [layer('0'), layer('Walls')] }))['L1'], 'changed');
    assert.equal(state(diffOf([line('L1', 0, 0, 1, 0)], [line('L1', 0, 0, 1, 0, '0', { colour: 'red' })]))['L1'], 'changed');
  });

  it('ignores who created an entity', () => {
    assert.equal(state(diffOf([line('L1', 0, 0, 1, 0, '0', { author: 'asha' })], [line('L1', 0, 0, 1, 0, '0', { author: 'bram' })]))['L1'], 'same');
  });

  it('counts an insert whose block definition differs as changed', () => {
    const moved = block('Door', [line('L60', 300, 300, 302, 300)], [300, 300]);
    const d = diffOf([insert('I4', 'Door', 50, 0)], [insert('I4', 'Door', 50, 0)], { blocks: [door] }, { blocks: [moved] });
    assert.deepEqual(state(d), { I4: 'changed' });
    assert.equal(state(diffOf([insert('I4', 'Door', 50, 0)], [insert('I4', 'Door', 50, 0)], { blocks: [door] }))['I4'], 'same');
  });

  it('sees a nested block change through the outer block', () => {
    const outer = block('Outer', [insert('I51', 'Door', 0, 0)]);
    const d = diffOf([insert('I1', 'Outer', 0, 0)], [insert('I1', 'Outer', 0, 0)], { blocks: [outer, door] }, { blocks: [outer, block('Door', [line('L50', 0, 0, 5, 5)])] });
    assert.equal(state(d)['I1'], 'changed');
  });

  it('matches xref entities by <xref name>|<handle>, so a reload counts', () => {
    const site = (lines: Entity[]): Xref => ({ name: 'Site', source: 's', x: 0, y: 0, scale: 1, rotation: 0, clip: null, version_id: null, model: model(lines) });
    const d = diffOf([], [], { xrefs: [site([line('L1', 0, 0, 10, 0)])] }, { xrefs: [site([line('L1', 0, 0, 10, 0), line('L2', 0, 20, 5, 20)])] });
    assert.deepEqual(state(d), { 'Site|L1': 'same', 'Site|L2': 'added' });
    assert.equal(d.result.added, 1);
  });
});

describe('compare scenarios from the brief', () => {
  const doorBlock = block('Door', [line('L50', 0, 0, 1, 0)]);
  const redefined = block('Door', [line('L61', 0, 40, 5, 40)]);

  it('counts one added, one removed and two changed across edits, a tiny move, a block redefinition and a new line', () => {
    const before = [line('L1', 0, 0, 10, 0), line('L2', 0, 10, 10, 10), line('L3', 0, 20, 10, 20), insert('I4', 'Door', 50, 0)];
    const after = [line('L1', 0.0005, 0, 10.0005, 0), line('L2', 0, 10, 12, 10), insert('I4', 'Door', 50, 0), line('L9', 0, 60, 5, 60)];
    const d = diffOf(before, after, { blocks: [doorBlock] }, { blocks: [redefined] });
    assert.deepEqual([d.result.added, d.result.removed, d.result.changed], [1, 1, 2]);
    assert.deepEqual(state(d), { L1: 'same', L2: 'changed', I4: 'changed', L9: 'added', L3: 'removed' });
  });

  it('counts a block redefinition and an xref reload: added 1, removed 0, changed 1', () => {
    const site = (lines: Entity[]): Xref => ({ name: 'Site', source: 's', x: 0, y: 0, scale: 1, rotation: 0, clip: null, version_id: null, model: model(lines, { layers: [layer('0')] }) });
    const base = [line('L1', 200, 0, 210, 0), insert('I4', 'Door', 50, 0)];
    const d = diffOf(base, base, { blocks: [doorBlock], xrefs: [site([line('L1', 0, 0, 10, 0)])] }, { blocks: [redefined], xrefs: [site([line('L1', 0, 0, 10, 0), line('L2', 0, 20, 5, 20)])] });
    assert.deepEqual([d.result.added, d.result.removed, d.result.changed], [1, 0, 1]);
    assert.equal(markupFlags([{ x1: 49, y1: -1, x2: 52, y2: 1 }, { x1: 500, y1: 500, x2: 501, y2: 501 }], d)[0], 'geometry-changed');
    assert.equal(markupFlags([{ x1: 500, y1: 500, x2: 501, y2: 501 }], d)[0], null);
  });

  it('flags the cloud and the arrow but not the far text markup after L1 is shortened', () => {
    const d = diffOf([line('L1', 0, 0, 10, 0)], [line('L1', 0, 0, 9, 0)]);
    const flags = markupFlags([{ x1: 0, y1: -1, x2: 10, y2: 1 }, { x1: -3, y1: -2, x2: 0, y2: 0 }, { x1: 100, y1: 100, x2: 101, y2: 101 }], d);
    assert.deepEqual(flags, ['geometry-changed', 'geometry-changed', null]);
  });
});

describe('markup flags', () => {
  const d = diffOf([line('L1', 0, 0, 10, 0)], [line('L1', 0, 0, 9, 0), line('L2', 50, 50, 51, 51)]);

  it('flags a markup whose box meets a changed entity box, touching included', () => {
    const flags = markupFlags([
      { x1: 0, y1: -1, x2: 10, y2: 1 }, { x1: -3, y1: -2, x2: 0, y2: 0 }, { x1: 100, y1: 100, x2: 101, y2: 101 }, { x1: 10, y1: 2, x2: 4, y2: -2 }, { x1: 51, y1: 51, x2: 60, y2: 60 },
    ], d);
    assert.deepEqual(flags, ['geometry-changed', 'geometry-changed', null, 'geometry-changed', 'geometry-changed']);
  });

  it('leaves a markup over unchanged geometry unflagged', () => {
    assert.deepEqual(markupFlags([{ x1: 0, y1: 5, x2: 10, y2: 6 }], d), [null]);
  });

  it('flags a markup over a block redefinition', () => {
    const moved = block('Door', [line('L60', 300, 300, 302, 300)], [300, 300]);
    const redefined = diffOf([insert('I4', 'Door', 50, 0)], [insert('I4', 'Door', 50, 0)], { blocks: [door] }, { blocks: [moved] });
    assert.deepEqual(markupFlags([{ x1: 49, y1: -1, x2: 52, y2: 1 }, { x1: 500, y1: 500, x2: 501, y2: 501 }], redefined), ['geometry-changed', null]);
  });
});
