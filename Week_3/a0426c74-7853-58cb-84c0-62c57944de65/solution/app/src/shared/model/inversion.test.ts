import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DrawingState, ModelSnapshot } from '../types.ts';
import { applyPatch, parsePlotfold } from './index.ts';
import type { ServerLoaders } from './index.ts';
import { Harness, add, arc, circle, dimension, hatch, insert, layer, line, pline } from './testing.ts';
import type { OpInput } from './testing.ts';

const A = 'asha';

const site: ModelSnapshot = {
  layers: [layer('0'), layer('Walls')], entities: [line('L1', 0, 0, 10, 0, 'Walls')],
  blocks: [], xrefs: [],
};
const parsedImport = parsePlotfold('plotfold 1\nlayer "Kerb" red Dashed 0.5 on thawed unlocked\nline L1 "Kerb" 0 0 4 0\ncircle C2 "0" 1 1 1\n');
assert.ok(parsedImport.ok);
let loads = 0;
const loaders: ServerLoaders = {
  drawingId: 'host', xrefDirectory: { name: (id) => id, sources: () => [] },
  xrefSource: () => ({ version_id: `v${(loads += 1)}`, model: site }),
  versionModel: () => ({ layers: [layer('0')], entities: [line('L1', 0, 0, 10, 0)], blocks: [], xrefs: [] }),
  importedDrawing: () => parsedImport.drawing,
};

const model = (state: DrawingState): unknown => ({ ...state, revision: 0, next_handle: 0 });

const steps: [string, OpInput[]][] = [
  ['LINE', [add(line('x', 20, 0, 30, 0)), add(circle('x', 5, 5, 2)), add(arc('x', 0, 0, 3, 0, 90)), add(pline('x', [[0, 0], [1, 1]], false))]],
  ['MOVE', [{ type: 'move', handles: ['L1', 'C2'], dx: 1, dy: 1 }]],
  ['PROPERTIES', [{ type: 'modify', handle: 'L1', set: { colour: 'red', x2: 12 } }]],
  ['DIMLINEAR', [add(dimension('x', 'aligned', [{ handle: 'L1', point: 'start' }, { handle: 'L1', point: 'end' }]))]],
  ['HATCH', [add(hatch('x', 50.5, 0.5))]],
  ['LAYER', [{ type: 'layer_add', name: 'Beams', colour: 'blue', linetype: 'Dashed', lineweight: 0.5 }]],
  ['LAYER', [{ type: 'layer_set', name: 'Beams', set: { frozen: true, rename: 'Joists' } }]],
  ['LAYERSTATE', [{ type: 'layer_state_save', name: 'Base' }]],
  ['LAYER', [{ type: 'layer_set', name: 'Joists', set: { colour: 'green' } }]],
  ['LAYERSTATE', [{ type: 'layer_state_restore', name: 'Base' }]],
  ['LAYER', [{ type: 'layer_delete', name: 'Joists' }]],
  ['DIMSTYLE', [{ type: 'dim_style_set', name: 'Metric', precision: 1, prefix: '~', suffix: 'mm', scale: 25.4, text_height_mm: 3 }]],
  ['PARAM', [{ type: 'parameter_set', name: 'd1', expression: '5' }]],
  ['CONSTRAIN', [{ type: 'constraint_add', kind: 'fixed', refs: [{ handle: 'L1', point: 'start' }] }]],
  ['CONSTRAIN', [{ type: 'constraint_add', kind: 'length', refs: [{ handle: 'L1', point: null }], expression: 'd1' }]],
  ['PARAM', [{ type: 'parameter_set', name: 'd1', expression: '7' }]],
  ['CONSTRAIN', [{ type: 'constraint_delete', id: 'K2' }]],
  ['PARAM', [{ type: 'parameter_delete', name: 'd1' }]],
  ['BLOCK', [{ type: 'block_define', name: 'Door', base: [0, 0], handles: ['L1'], attributes: [{ tag: 'MARK', default: 'A1' }] }]],
  ['INSERT', [add(insert('x', 'Door', 10, 10, 2, 90))]],
  ['PROPERTIES', [{ type: 'modify', handle: 'I11', set: { attributes: { MARK: 'B7' } } }]],
  ['EXPLODE', [{ type: 'explode', handle: 'I11' }]],
  ['PURGE', [{ type: 'purge' }]],
  ['XATTACH', [{ type: 'xref_attach', name: 'Site', source: 'src', x: 100, y: 0, scale: 2, rotation: 0 }]],
  ['XCLIP', [{ type: 'xref_clip', name: 'Site', rect: [90, -10, 130, 10] }]],
  ['XRELOAD', [{ type: 'xref_reload', name: 'Site' }]],
  ['XBIND', [{ type: 'xref_bind', name: 'Site' }]],
  ['IMPORT', [{ type: 'import_merge', import_id: 'i1' }]],
  ['RESTORE', [{ type: 'version_restore', version: 'v1' }]],
  ['ERASE', [{ type: 'delete', handles: ['L1'] }]],
];

test('every kind of group is exactly inverted by undo and repeated by redo, and its patch equals its state', () => {
  const h = new Harness({ layers: [layer('Walls')], entities: [line('L1', 0, 0, 10, 0), circle('C2', 5, 5, 2), pline('P3', [[50, 0], [51, 0], [51, 1], [50, 1]], true)] });
  h.env = { loaders };
  for (const [command, ops] of steps) {
    const before = h.state;
    const out = h.apply(A, ops, { command });
    const after = h.state;
    assert.deepEqual(applyPatch(before, out.patch), out.state, `patch of ${command} ${ops[0].type}`);
    h.undo(A);
    assert.deepEqual(model(h.state), model(before), `undo of ${command} ${ops[0].type}`);
    h.undo(A, 'redo');
    assert.deepEqual(model(h.state), model(after), `redo of ${command} ${ops[0].type}`);
    assert.equal(h.state.revision, before.revision + ops.length + 2, 'undo and redo are one revision each');
  }
});
