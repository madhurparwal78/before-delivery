import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelSnapshot, Sheet } from '../types.ts';
import { compareModels, documentCollections, emptyDrawingState, flagMarkups, parsePlotfold, seedDrawing, serializeCanonical, stateFromDocument, buildSnapshot } from './index.ts';
import type { ParsedDrawing, ServerLoaders } from './index.ts';
import { Harness, add, circle, dimension, hatch, insert, layer, line, pline } from './testing.ts';
import { ApiError } from '../errors.ts';

const A = 'asha';

function modelOf(h: Harness): ModelSnapshot {
  const { layers, entities, blocks, xrefs } = documentCollections(h.state);
  return { layers, entities, blocks, xrefs };
}

function loadersFor(extra: Partial<ServerLoaders>): ServerLoaders {
  return {
    drawingId: 'd', xrefDirectory: { name: (id) => id, sources: () => [] },
    xrefSource: () => ({ version_id: null, model: { layers: [], entities: [], blocks: [], xrefs: [] } }),
    versionModel: () => ({ layers: [], entities: [], blocks: [], xrefs: [] }), importedDrawing: () => ({ layers: [], blocks: [], entities: [] }),
    ...extra,
  };
}

function parsed(text: string): ParsedDrawing {
  const result = parsePlotfold(text);
  assert.ok(result.ok);
  return result.drawing;
}

test('a seeded drawing keeps its handles, computes derived values and counts on from the highest number', () => {
  const state = seedDrawing({
    layers: [layer('Walls', { colour: 'red' })],
    blocks: [{ name: 'Door', base: [0, 0], entities: [line('L50', 0, 0, 1, 0)], attributes: [{ tag: 'MARK', default: 'A1' }] }],
    entities: [line('L1', 0, 0, 10, 0, 'Walls'), insert('I2', 'Door', 5, 5), dimension('D3', 'aligned', [{ handle: 'L1', point: 'start' }, { handle: 'L1', point: 'end' }]),
      pline('P4', [[0, 0], [10, 0], [10, 10], [0, 10]], true), hatch('H5', 5, 5)],
    layer_states: [{ name: 'Base' }],
  });
  assert.equal(state.revision, 0);
  assert.equal(state.next_handle, 51);
  assert.deepEqual(state.entities.I2.type === 'insert' && state.entities.I2.attributes, { MARK: 'A1' });
  assert.ok(state.entities.D3.type === 'dimension' && state.entities.D3.value === 10 && state.entities.D3.associative && state.entities.D3.author === null);
  assert.ok(state.entities.H5.type === 'hatch' && state.entities.H5.area === 100 && state.entities.H5.associative);
  assert.deepEqual(state.layer_states.Base.layers.map((l) => l.name), ['0', 'Walls']);
});

test('generate adds horizontal unit lines on layer 0 in rows of 100', () => {
  const state = seedDrawing({ entities: [line('L7', 0, 0, 1, 1)], generate: { lines: 250, spacing: 2 } });
  assert.equal(Object.keys(state.entities).length, 251);
  const first = state.entities.L8;
  const wrapped = state.entities.L108;
  assert.ok(first.type === 'line' && first.x1 === 0 && first.y1 === 0 && first.x2 === 1 && first.layer === '0');
  assert.ok(wrapped.type === 'line' && wrapped.x1 === 0 && wrapped.y1 === 2);
  assert.equal(state.next_handle, 258);
});

test('a seed with bad records is refused', () => {
  assert.throws(() => seedDrawing({ entities: [line('L1', 0, 0, 1, 1, 'Nowhere')] }), ApiError);
  assert.throws(() => seedDrawing({ parameters: [{ name: 'd1', expression: 'd2' }] }), ApiError);
});

test('seeded constraints are solved at once', () => {
  const state = seedDrawing({ entities: [line('L1', 0, 0, 4, 1)], constraints: [{ kind: 'horizontal', refs: [{ handle: 'L1', point: null }] }] });
  const l1 = state.entities.L1;
  assert.ok(l1.type === 'line' && Math.abs(l1.y1 - l1.y2) < 1e-4);
  assert.equal(state.constraints[0].id, 'K1');
});

test('documents carry entities in handle order and parameters with values; they load back into the same state', () => {
  const state = seedDrawing({ entities: [line('L10', 0, 0, 1, 1), line('L2', 0, 0, 1, 1)], parameters: [{ name: 'd1', expression: '2*3' }] });
  const doc = documentCollections(state);
  assert.deepEqual(doc.entities.map((e) => e.handle), ['L2', 'L10']);
  assert.deepEqual(doc.parameters, [{ name: 'd1', expression: '2*3', value: 6 }]);
  assert.deepEqual(stateFromDocument({ revision: state.revision, next_handle: state.next_handle, ...doc }), state);
});

test('RESTORE brings back deleted entities with their handles, removes added ones and reverts changed ones, as one undoable group', () => {
  const h = new Harness({ entities: [line('L1', 0, 0, 10, 0), line('L2', 0, 10, 10, 10), line('L3', 0, 20, 10, 20)] });
  const version = modelOf(h);
  h.apply(A, [{ type: 'modify', handle: 'L2', set: { x2: 12 } }]);
  h.apply(A, [{ type: 'delete', handles: ['L3'] }]);
  const extra = h.apply(A, [add(line('x', 0, 40, 5, 40))]).results[0].handles[0];
  const revision = h.state.revision;
  h.env = { loaders: loadersFor({ versionModel: () => version }) };
  const out = h.apply(A, [{ type: 'version_restore', version: 'v1' }], { command: 'RESTORE' });
  assert.equal(out.state.revision, revision + 1);
  assert.deepEqual(Object.keys(out.state.entities).sort(), ['L1', 'L2', 'L3']);
  assert.ok(!(extra in out.state.entities));
  assert.deepEqual(out.state.entities.L2, version.entities[1]);
  assert.ok(out.state.next_handle > Number(extra.slice(1)), 'handles are never reused');
  h.undo(A);
  assert.ok(extra in h.entities && !('L3' in h.entities));
});

test('IMPORT merges layers and blocks with new names, gives new handles in file order, and is one group', () => {
  const merge = 'plotfold 1\nlayer "Walls" white Continuous 0.25 on thawed unlocked\nlayer "Kerb" red Dashed 0.5 on thawed unlocked\n'
    + 'line L1 "Walls" 0 0 10 0\nline L2 "Kerb" 0 5 10 5\ncircle C3 "0" 5 5 2\npline P4 "0" open 0 0 1 1\n';
  const h = new Harness({ layers: [layer('Walls')], entities: [line('L1', 0, 0, 1, 1)] });
  h.env = { loaders: loadersFor({ importedDrawing: () => parsed(merge) }) };
  const out = h.apply(A, [{ type: 'import_merge', import_id: 'i1' }], { command: 'IMPORT' });
  assert.deepEqual(out.results[0].handles, ['L2', 'L3', 'C4', 'P5']);
  assert.deepEqual(Object.keys(out.state.layers).sort(), ['0', 'Kerb', 'Walls', 'Walls (2)']);
  assert.equal(out.state.entities.L2.layer, 'Walls (2)');
  assert.equal(out.state.revision, h.state.revision);
  h.undo(A);
  assert.deepEqual(Object.keys(h.entities), ['L1']);
  assert.ok(!('Kerb' in h.state.layers));
});

test('IMPORT carries blocks, attribute values, dimensions and hatches across with their references remapped', () => {
  const text = [
    'plotfold 1', 'block "Door" 0 0', 'attr MARK "A1"', 'line L50 "0" 0 0 1 0', 'end',
    'line L1 "0" 0 0 10 0', 'insert I2 "0" "Door" 5 5 2 90', 'attr MARK "B7"',
    'dim D3 "0" aligned "Standard" L1:start L1:end', 'pline P4 "0" closed 20 0 30 0 30 10 20 10', 'hatch H5 "0" 25 5', ''].join('\n');
  const h = new Harness({ blocks: [{ name: 'Door', base: [0, 0], entities: [line('L90', 0, 0, 2, 0)], attributes: [] }], entities: [line('L1', 0, 0, 1, 1)] });
  h.env = { loaders: loadersFor({ importedDrawing: () => parsed(text) }) };
  const out = h.apply(A, [{ type: 'import_merge', import_id: 'i1' }], { command: 'IMPORT' });
  const e = out.state.entities;
  assert.ok('Door (2)' in out.state.blocks && out.state.blocks['Door (2)'].attributes[0].default === 'A1');
  const insertHandle = out.results[0].handles.find((handle) => e[handle].type === 'insert') ?? '';
  const made = e[insertHandle];
  assert.ok(made.type === 'insert' && made.block === 'Door (2)' && made.attributes.MARK === 'B7');
  const dim = Object.values(e).find((x) => x.type === 'dimension');
  assert.ok(dim?.type === 'dimension' && dim.refs[0].handle !== 'L1' && dim.value === 10 && dim.associative);
  const patch = Object.values(e).find((x) => x.type === 'hatch');
  assert.ok(patch?.type === 'hatch' && patch.area === 100 && patch.associative);
});

test('canonical text is stable through import, merge and export', () => {
  const canon = 'plotfold 1\nlayer "Walls" red Dashed 0.5 on thawed unlocked\nblock "Door" 0 0\nattr MARK "A1"\nattr NOTE "n"\nline L1 "0" 0 0 1 0\nend\n'
    + 'line L2 "Walls" 0 0 10 0\ncircle C3 "0" 5 5 2\narc A4 "Walls" 0 0 5 0 90\npline P5 "0" closed 0 0 4 0 4 3\n'
    + 'insert I6 "0" "Door" 5 5 2 90\nattr MARK "B7"\nattr NOTE "n"\ndim D7 "0" aligned "Standard" L2:start L2:end\nhatch H8 "0" 3 1\n';
  const h = new Harness();
  h.env = { loaders: loadersFor({ importedDrawing: () => parsed(canon) }) };
  h.apply(A, [{ type: 'import_merge', import_id: 'i' }], { command: 'IMPORT' });
  assert.equal(serializeCanonical(h.state), canon.replace('L1 "0"', 'L1 "0"'));
});

test('an empty drawing exports just the header', () => {
  assert.equal(serializeCanonical(emptyDrawingState()), 'plotfold 1\n');
});

test('compare: counts, tolerance, block redefinition and xref reload', () => {
  const h = new Harness({
    blocks: [{ name: 'Door', base: [0, 0], entities: [line('L50', 0, 0, 1, 0)], attributes: [] }],
    entities: [line('L1', 0, 0, 10, 0), line('L2', 0, 10, 10, 10), line('L3', 0, 20, 10, 20), insert('I4', 'Door', 50, 0)],
  });
  const earlier = modelOf(h);
  h.apply(A, [{ type: 'modify', handle: 'L2', set: { x2: 12 } }]);
  h.apply(A, [{ type: 'delete', handles: ['L3'] }, { type: 'move', handles: ['L1'], dx: 0.0005, dy: 0 }]);
  const picked = h.apply(A, [add(line('x', 0, 40, 5, 40))]).results[0].handles[0];
  const redefined = h.apply(A, [{ type: 'block_define', name: 'Door', base: [0, 0], handles: [picked], attributes: [] }]);
  h.apply(A, [{ type: 'delete', handles: redefined.results[0].handles }]);
  h.apply(A, [add(line('x', 0, 60, 5, 60))]);
  const result = compareModels(earlier, modelOf(h));
  assert.deepEqual([result.added, result.removed, result.changed], [1, 1, 2]);
  const diff = Object.fromEntries(result.entities.map((x) => [x.id, x.diff]));
  assert.deepEqual([diff.L1, diff.L2, diff.L3, diff.I4], ['same', 'changed', 'removed', 'changed']);
  const flags = flagMarkups([{ x1: 0, y1: 9, x2: 10, y2: 11 }, { x1: 100, y1: 100, x2: 101, y2: 101 }], earlier, modelOf(h));
  assert.deepEqual(flags, ['geometry-changed', null]);
});

test('compare counts an xref reload and flags a markup over it', () => {
  const h = new Harness({ entities: [line('L1', 0, 50, 10, 50)] });
  const source = (entities: ModelSnapshot['entities']): ModelSnapshot => ({ layers: [layer('0')], entities, blocks: [], xrefs: [] });
  let published = source([line('L1', 0, 0, 10, 0)]);
  h.env = { loaders: loadersFor({ xrefSource: () => ({ version_id: 'v', model: published }) }) };
  h.apply(A, [{ type: 'xref_attach', name: 'Site', source: 'src', x: 0, y: 0, scale: 1, rotation: 0 }]);
  const earlier = modelOf(h);
  published = source([line('L1', 0, 0, 10, 0), line('L2', 0, 5, 3, 5)]);
  h.apply(A, [{ type: 'xref_reload', name: 'Site' }], { command: 'XRELOAD' });
  h.apply(A, [{ type: 'modify', handle: 'L1', set: { x2: 12 } }]);
  const result = compareModels(earlier, modelOf(h));
  assert.deepEqual([result.added, result.removed, result.changed], [1, 0, 1]);
  assert.deepEqual(result.entities.filter((x) => x.diff !== 'same'), [{ id: 'L1', diff: 'changed' }, { id: 'Site|L2', diff: 'added' }]);
  assert.deepEqual(flagMarkups([{ x1: 0, y1: 4, x2: 3, y2: 6 }, { x1: 0, y1: 49, x2: 10, y2: 51 }, { x1: 500, y1: 500, x2: 501, y2: 501 }], earlier, modelOf(h)), ['geometry-changed', 'geometry-changed', null]);
});

test('a published snapshot holds the sheet and the model in handle order', () => {
  const h = new Harness({ entities: [line('L10', 0, 0, 1, 1), line('L2', 0, 0, 1, 1)] });
  const sheet: Sheet = { id: 's', drawing_id: 'd', name: 'Plot plan', size: 'A3', number: 1, locked: false, locked_by: null, creator: A, attributes: {}, viewports: [] };
  const snapshot = buildSnapshot(h.state, sheet);
  assert.deepEqual(snapshot.model.entities.map((e) => e.handle), ['L2', 'L10']);
  assert.equal(snapshot.sheet, sheet);
});

test('circles keep their handle type letters', () => {
  const h = new Harness();
  assert.equal(h.apply(A, [add(circle('x', 0, 0, 1))]).results[0].handles[0], 'C1');
});
