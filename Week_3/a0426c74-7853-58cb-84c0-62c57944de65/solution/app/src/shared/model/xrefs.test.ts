import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../errors.ts';
import type { ModelSnapshot } from '../types.ts';
import { xrefCircularChain } from './index.ts';
import type { ServerLoaders } from './index.ts';
import { Harness, insert, layer, line } from './testing.ts';

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

const source: ModelSnapshot = {
  layers: [layer('0'), layer('Walls')],
  entities: [line('L1', 0, 0, 10, 0, 'Walls'), line('L2', 0, 50, 10, 50, 'Walls'), insert('I3', 'Gate', 5, 5)],
  blocks: [{ name: 'Gate', base: [0, 0], entities: [line('L9', 0, 0, 1, 0, 'Walls')], attributes: [] }],
  xrefs: [],
};
const sources: Record<string, string[]> = { host: ['src'], src: [], other: [] };
const loaders: ServerLoaders = {
  drawingId: 'src',
  xrefDirectory: { name: (id) => id.toUpperCase(), sources: (id) => sources[id] ?? [] },
  xrefSource: () => ({ version_id: 'v1', model: source }),
  versionModel: () => source,
  importedDrawing: () => ({ layers: [], blocks: [], entities: [] }),
};

const attach = { type: 'xref_attach', name: 'Site', source: 'other', x: 100, y: 0, scale: 2, rotation: 0 } as const;

test('attach copies the source model; clip, reload and bind', () => {
  const h = new Harness();
  h.env = { loaders };
  h.apply(A, [attach]);
  assert.deepEqual([h.state.xrefs.Site.version_id, h.state.xrefs.Site.clip, h.state.xrefs.Site.model.entities.length], ['v1', null, 3]);
  h.apply(A, [{ type: 'xref_clip', name: 'Site', rect: [130, 10, 90, -10] }], { command: 'XCLIP' });
  assert.deepEqual(h.state.xrefs.Site.clip, [90, -10, 130, 10]);
  h.apply(A, [{ type: 'xref_clip', name: 'Site', rect: null }], { command: 'XCLIP' });
  assert.equal(h.state.xrefs.Site.clip, null);
  h.undo(A);
  assert.deepEqual(h.state.xrefs.Site.clip, [90, -10, 130, 10]);
  h.env = { loaders: { ...loaders, xrefSource: () => ({ version_id: 'v2', model: { ...source, entities: source.entities.slice(0, 1) } }) } };
  h.apply(A, [{ type: 'xref_reload', name: 'Site' }], { command: 'XRELOAD' });
  assert.deepEqual([h.state.xrefs.Site.version_id, h.state.xrefs.Site.model.entities.length], ['v2', 1]);
  h.undo(A);
  assert.equal(h.state.xrefs.Site.version_id, 'v1');
  const out = h.apply(A, [{ type: 'xref_bind', name: 'Site' }]);
  assert.ok(!('Site' in out.state.xrefs));
  assert.ok('Site' in out.state.blocks && 'Site$Walls' in out.state.layers && 'Site$Gate' in out.state.blocks);
  const bound = out.state.entities[out.results[0].handles[0]];
  assert.ok(bound.type === 'insert' && bound.block === 'Site' && bound.x === 100 && bound.scale === 2);
  assert.deepEqual(out.state.blocks.Site.entities.map((e) => e.layer), ['Site$Walls', 'Site$Walls', 'Site$0']);
  const gate = out.state.blocks.Site.entities.find((e) => e.type === 'insert');
  assert.ok(gate?.type === 'insert' && gate.block === 'Site$Gate');
});

test('entities on an xref are read-only through the engine', () => {
  const h = new Harness();
  h.env = { loaders };
  h.apply(A, [attach]);
  assert.equal(refusal(() => h.apply(A, [{ type: 'move', handles: ['Site|L1'], dx: 1, dy: 0 }])).code, 'invalid');
});

test('attaching a drawing whose chain leads back is refused naming the chain', () => {
  const h = new Harness();
  h.env = { loaders };
  const error = refusal(() => h.apply(A, [{ ...attach, name: 'Back', source: 'host' }]));
  assert.deepEqual([error.code, error.message], ['invalid', 'Circular reference: SRC -> HOST -> SRC.']);
  assert.deepEqual(xrefCircularChain('src', 'src', loaders.xrefDirectory), ['SRC', 'SRC']);
  assert.equal(xrefCircularChain('src', 'other', loaders.xrefDirectory), null);
});

test('a second xref with the same name is refused', () => {
  const h = new Harness();
  h.env = { loaders };
  h.apply(A, [attach]);
  assert.equal(refusal(() => h.apply(A, [attach])).message, 'An xref named Site already exists.');
  assert.equal(refusal(() => h.apply(A, [{ type: 'xref_clip', name: 'Nope', rect: null }])).message, 'No xref named Nope.');
});
