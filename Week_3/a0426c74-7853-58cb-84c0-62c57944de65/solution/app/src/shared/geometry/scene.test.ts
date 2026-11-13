import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Entity, ModelSnapshot, Xref } from '../types.ts';
import { arc, assertClose, block, circle, dimension, drawing, hatch, insert, layer, line, pline } from './fixtures.ts';
import { buildScene, domEntities, findEntities, modelInput, queryRect, updateScene } from './scene.ts';

const ends = (e: Entity | undefined): number[] => (e?.type === 'line' ? [e.x1, e.y1, e.x2, e.y2] : []);

function xref(name: string, model: Partial<ModelSnapshot>, placement: Partial<Xref> = {}): Xref {
  return {
    name, source: 'src', x: 0, y: 0, scale: 1, rotation: 0, clip: null, version_id: null,
    model: { layers: [layer('0')], entities: [], blocks: [], xrefs: [], ...model }, ...placement,
  };
}

describe('scene entities', () => {
  it('lists model entities by handle number then xref entities by full id', () => {
    const site = xref('Site', { layers: [layer('0'), layer('Walls', 'red')], entities: [line('L2', 0, 50, 10, 50, 'Walls'), line('L1', 0, 0, 10, 0, 'Walls')] });
    const scene = buildScene(drawing([line('L10', 0, 0, 1, 1), line('L2', 0, 0, 1, 1), circle('C3', 5, 5, 1)], { xrefs: { Site: site } }));
    assert.deepEqual(scene.entities.map((e) => e.id), ['L2', 'C3', 'L10', 'Site|L2', 'Site|L1']);
    assert.deepEqual(scene.layers.map((l) => l.name), ['0', 'Site|0', 'Site|Walls']);
  });

  it('resolves ByLayer and explicit colour, linetype and lineweight', () => {
    const state = drawing([line('L1', 0, 0, 1, 0, 'Walls'), line('L2', 0, 0, 1, 0, 'Walls', { colour: 'blue', linetype: 'Dashed', lineweight: 0.7 })], {
      layers: { 0: layer('0'), Walls: layer('Walls', 'red', { linetype: 'Centre', lineweight: 0.5 }) },
    });
    const scene = buildScene(state);
    const [one, two] = [scene.byId.get('L1')!, scene.byId.get('L2')!];
    assert.deepEqual([one.colour, one.linetype, one.lineweight], ['red', 'Centre', 0.5]);
    assert.deepEqual([two.colour, two.linetype, two.lineweight], ['blue', 'Dashed', 0.7]);
  });

  it('hides off and frozen layers and keeps locked ones visible but not selectable', () => {
    const state = drawing([line('L1', 0, 0, 1, 0, 'Off'), line('L2', 0, 0, 1, 0, 'Frozen'), line('L3', 0, 0, 1, 0, 'Locked')], {
      layers: { 0: layer('0'), Off: layer('Off', 'white', { on: false }), Frozen: layer('Frozen', 'white', { frozen: true }), Locked: layer('Locked', 'white', { locked: true }) },
    });
    const scene = buildScene(state);
    assert.deepEqual(scene.entities.map((e) => [e.id, e.visible, e.selectable]), [['L1', false, false], ['L2', false, false], ['L3', true, false]]);
    assert.deepEqual(queryRect(scene, [-1, -1, 2, 2]).map((e) => e.id), ['L3']);
    assert.deepEqual(scene.bounds, [0, 0, 1, 0]);
  });

  it('gives an insert the extent of its block and ByBlock colour from the insert', () => {
    const state = drawing([insert('I1', 'Door', 10, 0, 2, 90, {}, 'Doors')], {
      layers: { 0: layer('0'), Doors: layer('Doors', 'green') },
      blocks: { Door: block('Door', [line('L50', 0, 0, 1, 0, '0', { colour: 'ByBlock' })]) },
    });
    const scene = buildScene(state);
    const [x1, y1, x2, y2] = scene.byId.get('I1')!.bounds;
    assertClose(x1, 10); assertClose(x2, 10); assertClose(y1, 0); assertClose(y2, 2);
    assert.equal(scene.byId.get('I1')!.colour, 'green');
  });
});

describe('xref entities', () => {
  const src = xref('Site', { layers: [layer('0'), layer('Walls', 'red')], entities: [line('L1', 0, 0, 10, 0, 'Walls'), line('L2', 0, 50, 10, 50, 'Walls')] }, { x: 100, y: 0, scale: 2 });

  it('applies the block insert transform and prefixes ids and layers', () => {
    const scene = buildScene(drawing([], { xrefs: { Site: src } }));
    const one = scene.byId.get('Site|L1')!;
    assert.deepEqual(ends(one.entity), [100, 0, 120, 0]);
    assert.equal(one.entity.layer, 'Site|Walls');
    assert.equal(one.colour, 'red');
    assert.equal(one.selectable, false);
    assert.equal(one.xref, 'Site');
  });

  it('rotates about the xref point', () => {
    const turned = xref('Site', { entities: [line('L1', 0, 0, 10, 0)] }, { x: 5, y: 5, rotation: 90 });
    assertClose(ends(buildScene(drawing([], { xrefs: { Site: turned } })).byId.get('Site|L1')!.entity)[2], 5);
    assertClose(ends(buildScene(drawing([], { xrefs: { Site: turned } })).byId.get('Site|L1')!.entity)[3], 15);
  });

  it('applies nested transforms in turn and names nested ids Outer|Inner|L1', () => {
    const inner = xref('Inner', { entities: [line('L1', 0, 0, 1, 0)] }, { x: 10, y: 0, scale: 3 });
    const outer = xref('Outer', { entities: [], xrefs: [inner] }, { x: 100, y: 100, scale: 2, rotation: 90 });
    const scene = buildScene(drawing([], { xrefs: { Outer: outer } }));
    const nested = scene.byId.get('Outer|Inner|L1')!;
    // inner: (0,0)-(1,0) -> (10,0)-(13,0) in the outer model; outer: scale 2, rotate 90 -> (0,20)-(0,26), then + (100,100)
    assert.deepEqual(ends(nested.entity).map((n) => Math.round(n * 1e6) / 1e6), [100, 120, 100, 126]);
    assert.equal(nested.entity.layer, 'Outer|Inner|0');
    assert.ok(scene.layers.some((l) => l.name === 'Outer|Inner|0'));
  });

  it('cuts at a clip: only entities wholly or partly inside stay visible', () => {
    const clipped = { ...src, clip: [90, -10, 130, 10] as Xref['clip'] };
    const scene = buildScene(drawing([], { xrefs: { Site: clipped } }));
    assert.equal(scene.byId.get('Site|L1')!.visible, true);
    assert.equal(scene.byId.get('Site|L2')!.visible, false);
    assert.deepEqual(scene.byId.get('Site|L1')!.clip?.rect, [90, -10, 130, 10]);
    assert.equal(scene.clips.length, 1);
    assert.deepEqual(scene.bounds, [100, 0, 120, 0]);
  });

  it('uses the xref’s own blocks for its inserts', () => {
    const withBlock = xref('Site', { entities: [insert('I1', 'Door', 0, 0)], blocks: [block('Door', [line('L50', 0, 0, 4, 0)])] });
    const scene = buildScene(drawing([], { xrefs: { Site: withBlock }, blocks: { Door: block('Door', [line('L51', 0, 0, 99, 0)]) } }));
    assert.deepEqual(scene.byId.get('Site|I1')!.bounds, [0, 0, 4, 0]);
  });

  it('builds a published model into a scene', () => {
    const model: ModelSnapshot = { layers: [layer('0')], entities: [line('L1', 0, 0, 3, 4)], blocks: [], xrefs: [src] };
    const scene = buildScene(modelInput(model));
    assert.deepEqual(scene.entities.map((e) => e.id), ['L1', 'Site|L1', 'Site|L2']);
    assert.equal(scene.dimStyles['Standard']?.precision, 2);
  });
});

describe('dependent entities', () => {
  const base = drawing([
    line('L1', 0, 0, 10, 0), line('L2', 20, 0, 30, 0), dimension('D3', 'aligned', [{ handle: 'L1', point: 'start' }, { handle: 'L2', point: 'end' }], 15, 2, 30),
    pline('P4', [[40, 0], [44, 0], [44, 4], [40, 4]], true), circle('C5', 42, 2, 1), { ...hatch('H6', 40.5, 0.5), boundary: ['P4', 'C5'] },
  ]);

  it('follows the entities a dimension and a hatch read', () => {
    const first = buildScene(base);
    const dimBefore = first.byId.get('D3')!;
    const hatchBefore = first.byId.get('H6')!;
    assert.deepEqual(dimBefore.bounds, [0, 0, 30, 2]);
    const moved = { ...base, entities: { ...base.entities, L2: line('L2', 20, 0, 50, 0) } };
    const second = updateScene(first, moved);
    assert.notEqual(second.byId.get('D3'), dimBefore);
    assert.deepEqual(second.byId.get('D3')!.bounds, [0, 0, 50, 2]);
    assert.equal(second.byId.get('H6'), hatchBefore);
    const withoutBoundary = { ...moved, entities: { ...moved.entities, P4: pline('P4', [[40, 0], [44, 0], [44, 4]], false) } };
    const third = updateScene(second, withoutBoundary);
    assert.notEqual(third.byId.get('H6'), hatchBefore);
    assert.deepEqual(third.byId.get('H6')!.prims, []);
  });

  it('keeps unchanged scene entities by identity and rebuilds only what changed', () => {
    const first = buildScene(base);
    const keep = first.byId.get('L1')!;
    const changed = { ...base, entities: { ...base.entities, C5: circle('C5', 52, 2, 1) } };
    const second = updateScene(first, changed);
    assert.equal(second.byId.get('L1'), keep);
    assert.notEqual(second.byId.get('C5'), keep);
    assert.deepEqual(second.byId.get('C5')!.bounds, [51, 1, 53, 3]);
    assert.ok(second.version > first.version);
  });

  it('adds, removes and reorders entities', () => {
    const first = buildScene(drawing([line('L1', 0, 0, 1, 1), line('L3', 0, 0, 1, 1)]));
    const second = updateScene(first, drawing([line('L1', 0, 0, 1, 1), line('L2', 0, 0, 1, 1), line('L3', 0, 0, 1, 1)]));
    assert.deepEqual(second.entities.map((e) => e.id), ['L1', 'L2', 'L3']);
    const { L1: _gone, ...rest } = drawing([line('L1', 0, 0, 1, 1), line('L2', 0, 0, 1, 1)]).entities;
    const third = updateScene(second, { ...drawing([]), entities: rest });
    assert.deepEqual(third.entities.map((e) => e.id), ['L2']);
    assert.deepEqual(queryRect(third, [-5, -5, 5, 5]).map((e) => e.id), ['L2']);
  });

  it('follows a layer change and a block redefinition', () => {
    const state = drawing([line('L1', 0, 0, 1, 0, 'Walls'), insert('I2', 'Door', 0, 0)], {
      layers: { 0: layer('0'), Walls: layer('Walls', 'red') }, blocks: { Door: block('Door', [line('L50', 0, 0, 1, 0)]) },
    });
    const first = buildScene(state);
    const next = { ...state, layers: { ...state.layers, Walls: layer('Walls', 'blue', { on: false }) }, blocks: { Door: block('Door', [line('L50', 0, 0, 5, 5)]) } };
    const second = updateScene(first, next);
    assert.equal(second.byId.get('L1')!.visible, false);
    assert.equal(second.byId.get('L1')!.colour, 'blue');
    assert.deepEqual(second.byId.get('I2')!.bounds, [0, 0, 5, 5]);
  });

  it('reloads an xref', () => {
    const first = buildScene(drawing([], { xrefs: { Site: xref('Site', { entities: [line('L1', 0, 0, 1, 0)] }) } }));
    const second = updateScene(first, drawing([], { xrefs: { Site: xref('Site', { entities: [line('L1', 0, 0, 1, 0), line('L2', 0, 5, 1, 5)] }) } }));
    assert.deepEqual(second.entities.map((e) => e.id), ['Site|L1', 'Site|L2']);
  });
});

describe('queries over many entities', () => {
  const many = Array.from({ length: 10_000 }, (_, i) => line(`L${i + 1}`, (i % 100) * 2, Math.floor(i / 100) * 2, (i % 100) * 2 + 1, Math.floor(i / 100) * 2));
  const state = drawing(many);

  it('finds entities by handle, layer or block ignoring case, in handle order', () => {
    const scene = buildScene(drawing([line('L2', 0, 0, 1, 0, 'Walls'), line('L1', 0, 0, 1, 0), insert('I3', 'Door', 5, 5)], { layers: { 0: layer('0'), Walls: layer('Walls') } }));
    assert.deepEqual(findEntities(scene, 'l1'), ['L1']);
    assert.deepEqual(findEntities(scene, 'WALLS'), ['L2']);
    assert.deepEqual(findEntities(scene, 'door'), ['I3']);
    assert.deepEqual(findEntities(scene, '0'), ['L1', 'I3']);
    assert.deepEqual(findEntities(scene, 'nothing'), []);
    assert.deepEqual(findEntities(scene, ''), []);
  });

  it('keeps the DOM to the ceiling of nearest entities plus the selected', () => {
    const scene = buildScene(state);
    const view = { zoom: 2, panX: 400, panY: 300 };
    const kept = domEntities(scene, view, { width: 800, height: 600 }, 200, 50, new Set(['L9999']));
    assert.equal(kept.length, 51);
    assert.ok(kept.some((e) => e.id === 'L9999'));
    const nearAll = domEntities(scene, view, { width: 800, height: 600 }, 200, 500, new Set());
    assert.equal(nearAll.length, 500);
  });

  it('builds, queries and updates 10 000 lines well within the time bounds', () => {
    // the best of several runs, so a busy machine does not fail the bound
    const fastest = (runs: number, task: () => void): number => Math.min(...Array.from({ length: runs }, () => {
      const started = performance.now();
      task();
      return performance.now() - started;
    }));
    let scene = buildScene(state);
    assert.ok(fastest(3, () => { scene = buildScene(state); }) < 1500, 'build');
    assert.ok(fastest(5, () => { for (let i = 0; i < 100; i++) queryRect(scene, [i, i, i + 3, i + 3]); }) / 100 < 1, 'query');
    let moved = 0;
    assert.ok(fastest(5, () => {
      moved += 1;
      scene = updateScene(scene, { ...state, entities: { ...state.entities, L77: line('L77', 500, 500, 501 + moved, 501) } });
    }) < 50, 'update');
    assert.deepEqual(scene.byId.get('L77')!.bounds, [500, 500, 506, 501]);
    assert.ok(fastest(5, () => findEntities(scene, 'l9999')) < 10, 'find');
  });

  it('includes arcs and bounds with arc extents', () => {
    const scene = buildScene(drawing([arc('A1', 0, 0, 5, 0, 90)]));
    assert.deepEqual(scene.byId.get('A1')!.bounds.map((n) => Math.round(n * 1e6) / 1e6), [0, 0, 5, 5]);
  });
});
