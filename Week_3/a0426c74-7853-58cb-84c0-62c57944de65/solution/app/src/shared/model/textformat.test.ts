import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyDrawingState, isPlotfoldText, parsePlotfold, previewImport, serializeCanonical } from './index.ts';
import type { ParsedDrawing } from './index.ts';
import { applyGroup } from './index.ts';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const BROKEN = 'plotfold 1\nlayer "Walls" white Continuous 0.25 on thawed unlocked\nline L1 "Walls" 0 0 1 1\nline L2 "Walls" 0 0 10\n'
  + 'circle C2 "Nope" 0 0 1\narc A3 "0" 0 0 x 0 90\nwidget 1 2\nend\nline L1 "0" 0 0 1 1\n'
  + 'pline P4 "0" open 0 0 1\nattr TAG "v"\ninsert I5 "0" "Missing" 0 0 1 0\nblock "B" 0 0\n';
const BROKEN_LINES = ['Line 4: line needs 4 numbers, got 3', 'Line 5: layer "Nope" is not defined', 'Line 6: "x" is not a number',
  'Line 7: unknown record "widget"', 'Line 8: end has no block', 'Line 9: handle L1 is used twice',
  'Line 10: pline needs an even count of at least 4 numbers, got 3', 'Line 11: attr has nothing to attach to',
  'Line 12: block "Missing" is not defined', 'Line 13: block "B" has no end'];
const MERGE = 'plotfold 1\nlayer "Walls" white Continuous 0.25 on thawed unlocked\nlayer "Kerb" red Dashed 0.5 on thawed unlocked\n'
  + 'line L1 "Walls" 0 0 10 0\nline L2 "Kerb" 0 5 10 5\ncircle C3 "0" 5 5 2\npline P4 "0" open 0 0 1 1\n';
const CANON = 'plotfold 1\nlayer "Walls" red Dashed 0.5 on thawed unlocked\nline L1 "Walls" 0 0 10 0\n'
  + 'circle C2 "0" 5 5 2\narc A3 "Walls" 0 0 5 0 90\npline P4 "0" closed 0 0 4 0 4 3\n';

function parsed(text: string): ParsedDrawing {
  const result = parsePlotfold(text);
  assert.ok(result.ok, result.ok ? '' : result.errors.join('\n'));
  return result.drawing;
}

test('the broken sample gives the published errors in order, one per line', () => {
  const result = parsePlotfold(BROKEN);
  assert.deepEqual(result, { ok: false, errors: BROKEN_LINES });
});

test('at most 20 errors, top to bottom', () => {
  const text = `plotfold 1\n${Array.from({ length: 30 }, () => 'widget').join('\n')}\n`;
  const result = parsePlotfold(text);
  assert.ok(!result.ok);
  assert.equal(result.errors.length, 20);
  assert.equal(result.errors[19], 'Line 21: unknown record "widget"');
});

test('upload type rule: UTF-8 whose first line is plotfold 1', () => {
  assert.ok(isPlotfoldText(encode('plotfold 1\n')));
  assert.ok(isPlotfoldText(encode('plotfold 1')));
  assert.ok(!isPlotfoldText(encode('plotfold 2\n')));
  assert.ok(!isPlotfoldText(encode('plotfold 1 \n')));
  assert.ok(!isPlotfoldText(new Uint8Array([...encode('plotfold 1\n'), 0xff, 0xfe, 10])));
  assert.ok(!isPlotfoldText(new Uint8Array([0xef, 0xbb, 0xbf, ...encode('plotfold 1\n')])));
  assert.ok(!isPlotfoldText(encode('plotfold 1\nlayer "A\0B" white Continuous 0.25 on thawed unlocked\n')), 'PostgreSQL cannot store a null character');
});

test('blank lines and comments are ignored; names unescape quotes', () => {
  const drawing = parsed('plotfold 1\n\n# a comment\nlayer "A \\"b\\"" red Dashed 0.5 on frozen locked\n');
  assert.equal(drawing.layers[0].name, 'A "b"');
  assert.deepEqual([drawing.layers[0].frozen, drawing.layers[0].locked, drawing.layers[0].on], [true, true, true]);
});

test('blocks keep their attribute defaults, inserts keep their values, nested blocks must be defined above', () => {
  const drawing = parsed([
    'plotfold 1', 'block "Door" 1 2', 'attr MARK "A1"', 'line L1 "0" 0 0 1 0', 'end',
    'block "Outer" 0 0', 'insert I2 "0" "Door" 5 5 2 90', 'attr MARK "B7"', 'end',
    'insert I3 "0" "Outer" 0 0 1 0', ''].join('\n'));
  assert.deepEqual(drawing.blocks[0].attributes, [{ tag: 'MARK', default: 'A1' }]);
  assert.deepEqual(drawing.blocks[0].base, [1, 2]);
  const nested = drawing.blocks[1].entities[0];
  assert.equal(nested.type === 'insert' && nested.attributes.MARK, 'B7');
  const selfInsert = parsePlotfold('plotfold 1\nblock "A" 0 0\ninsert I1 "0" "A" 0 0 1 0\nend\n');
  assert.deepEqual(selfInsert, { ok: false, errors: ['Line 3: block "A" is not defined'] });
});

test('an attr after a plain entity attaches to nothing outside a block, and to the block inside one', () => {
  const outside = parsePlotfold('plotfold 1\nline L1 "0" 0 0 1 1\nattr T "x"\n');
  assert.deepEqual(outside, { ok: false, errors: ['Line 3: attr has nothing to attach to'] });
  assert.deepEqual(parsed('plotfold 1\nblock "A" 0 0\nline L1 "0" 0 0 1 1\nattr T "x"\nend\n').blocks[0].attributes, [{ tag: 'T', default: 'x' }]);
});

test('dimensions and hatches parse their references and seed', () => {
  const drawing = parsed('plotfold 1\nline L1 "0" 0 0 10 0\ndim D2 "0" aligned "Standard" L1:start L1:end\nhatch H3 "0" 1 2\n');
  const dim = drawing.entities[1];
  assert.equal(dim.type, 'dimension');
  assert.deepEqual(dim.type === 'dimension' && dim.refs, [{ handle: 'L1', point: 'start' }, { handle: 'L1', point: 'end' }]);
  assert.deepEqual(drawing.entities[2].type === 'hatch' && [drawing.entities[2].seed_x, drawing.entities[2].seed_y], [1, 2]);
});

test('preview: the merge renames taken layers and blocks to the lowest free <name> (k)', () => {
  const state = applyGroup(emptyDrawingState(), {
    base_revision: 0, group_id: 'g', command: 'LAYER',
    ops: [{ op_id: 'a', type: 'layer_add', name: 'Walls', colour: 'white', linetype: 'Continuous', lineweight: 0.25 },
      { op_id: 'b', type: 'layer_add', name: 'Walls (2)', colour: 'white', linetype: 'Continuous', lineweight: 0.25 }],
  }, { username: 'asha' }).state;
  const preview = previewImport(state, parsed(MERGE));
  assert.deepEqual(preview.adds, { entities: 4, layers: 2, blocks: 0 });
  assert.deepEqual(preview.renames, [{ from: 'Walls', to: 'Walls (3)' }]);
  assert.deepEqual(previewImport(emptyDrawingState(), parsed(CANON)).adds, { entities: 4, layers: 1, blocks: 0 });
});

test('canonical text round-trips byte for byte through a merge', () => {
  // The merge itself is tested in engine.test.ts; here the serialization of a state built from canonical text.
  const drawing = parsed(CANON);
  const state = applyGroup(emptyDrawingState(), {
    base_revision: 0, group_id: 'g', command: 'IMPORT', ops: [{ op_id: 'm', type: 'import_merge', import_id: 'i' }],
  }, {
    username: 'asha',
    loaders: {
      drawingId: 'd', xrefDirectory: { name: (id) => id, sources: () => [] },
      xrefSource: () => ({ version_id: null, model: { layers: [], entities: [], blocks: [], xrefs: [] } }),
      versionModel: () => ({ layers: [], entities: [], blocks: [], xrefs: [] }), importedDrawing: () => drawing,
    },
  }).state;
  assert.equal(serializeCanonical(state), CANON);
});
