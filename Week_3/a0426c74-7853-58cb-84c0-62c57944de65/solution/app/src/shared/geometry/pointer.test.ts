import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Entity, Point } from '../types.ts';
import { arc, assertClose, assertPoint, circle, drawing, layer, line, pline } from './fixtures.ts';
import { pickEntity, selectInWindow, windowMode } from './pick.ts';
import { type DraftingAids, findSnap, resolvePointer } from './snap.ts';
import { buildScene } from './scene.ts';
import { pinchView, panToReveal, screenToWorld, viewWorldRect, wheelZoom, worldToScreen, zoomAllView } from './view.ts';

const view = { zoom: 10, panX: 100, panY: 300 };
const sceneOf = (...entities: Entity[]) => buildScene(drawing(entities));
const worldAt = (sx: number, sy: number): Point => screenToWorld(view, [sx, sy]);

describe('snaps', () => {
  const scene = sceneOf(line('L1', 0, 0, 10, 0), line('L2', 10.4, -2, 10.4, 2), line('L3', 20, 5, 25, 5), line('L4', 25.4, 5, 30, 5));

  it('lets an endpoint beat a nearer midpoint, and the closer endpoint win', () => {
    const first = findSnap(scene, worldAt(203, 300), view, [0, 0]);
    assert.deepEqual([first?.kind, first?.point], ['endpoint', [10, 0]]);
    const second = findSnap(scene, worldAt(353, 250), view, [0, 0]);
    assert.deepEqual([second?.kind, second?.point], ['endpoint', [25.4, 5]]);
  });

  it('finds a midpoint and ignores candidates beyond the 10 px aperture', () => {
    const mid = findSnap(scene, worldAt(150, 294), view, [0, 0]);
    assert.deepEqual([mid?.kind, mid?.point], ['midpoint', [5, 0]]);
    assert.equal(findSnap(scene, worldAt(150, 288), view, [0, 0]), null);
  });

  it('scales the aperture with zoom', () => {
    assert.equal(findSnap(scene, [5, 1.5], { zoom: 5, panX: 0, panY: 0 }, [0, 0])?.kind, 'midpoint');
    assert.equal(findSnap(scene, [5, 1.5], { zoom: 20, panX: 0, panY: 0 }, [0, 0]), null);
  });

  it('breaks a tie of priority by screen distance, then the lower handle number', () => {
    const tied = sceneOf(line('L9', 0, 0, 1, 1), line('L2', 0, 0, 5, -5));
    assert.equal(findSnap(tied, [0, 0], view, [3, 3])?.id, 'L2');
  });

  it('snaps to centres, intersections, perpendicular feet, tangent points and the nearest point', () => {
    const shapes = sceneOf(circle('C1', 0, 0, 5), line('L2', -10, 0, 8, 0), line('L3', 3, -10, 3, 30));
    assert.equal(findSnap(shapes, [0.2, 0.1], view, [0, 0])?.kind, 'centre');
    const cross = findSnap(shapes, [3.05, 0.05], view, [20, 20]);
    assert.deepEqual([cross?.kind, cross?.point], ['intersection', [3, 0]]);
    const foot = findSnap(sceneOf(line('L1', 0, 0, 10, 0)), [4.02, 0.5], view, [4, 8]);
    assert.deepEqual([foot?.kind, foot?.point], ['perpendicular', [4, 0]]);
    const tangent = findSnap(sceneOf(circle('C1', 0, 0, 5)), [2.55, 4.3], view, [10, 0]);
    assert.equal(tangent?.kind, 'tangent');
    assertPoint(tangent!.point, [2.5, 4.330127], 1e-5);
    assert.equal(findSnap(sceneOf(circle('C1', 0, 0, 5)), [0, 5.05], view, [0, 0])?.kind, 'nearest');
  });

  it('snaps to arc ends and midpoints, polyline vertices and xref entities, never to hidden layers', () => {
    const arcs = sceneOf(arc('A1', 0, 0, 5, 0, 90));
    assert.deepEqual(findSnap(arcs, [5.02, 0.02], view, [0, 0])?.point, [5, 0]);
    const polyline = sceneOf(pline('P1', [[0, 0], [4, 0], [4, 3]], false));
    assert.deepEqual(findSnap(polyline, [4.03, 0.03], view, [0, 0])?.point, [4, 0]);
    const hidden = buildScene(drawing([line('L1', 0, 0, 10, 0, 'Off')], { layers: { 0: layer('0'), Off: layer('Off', 'white', { on: false }) } }));
    assert.equal(findSnap(hidden, [10, 0], view, [0, 0]), null);
  });
});

describe('xref entities in the pointer layer', () => {
  const site = { name: 'Site', source: 's', x: 0, y: 0, scale: 1, rotation: 0, clip: null, version_id: null, model: { layers: [layer('Walls')], entities: [line('L1', 0, 0, 10, 0, 'Walls')], blocks: [], xrefs: [] } };
  const scene = buildScene(drawing([], { xrefs: { Site: site } }));

  it('snaps to them but neither picks nor selects them', () => {
    const snap = findSnap(scene, worldAt(201, 300), view, [0, 0]);
    assert.deepEqual([snap?.kind, snap?.point, snap?.id], ['endpoint', [10, 0], 'Site|L1']);
    assert.equal(pickEntity(scene, [5, 0], view), null);
    assert.deepEqual(selectInWindow(scene, [-1, -1], [11, 1]).ids, []);
  });
});

describe('pointer points', () => {
  const scene = sceneOf(line('L1', 0, 0, 10, 0));
  const aids = (on: Partial<DraftingAids>): DraftingAids => ({ snap: false, ortho: false, grid: false, polar: false, ...on });
  const last: Point = [0, -10];

  it('lets an object snap win outright', () => {
    const result = resolvePointer(scene, [10.02, 0.02], view, aids({ snap: true, grid: true, ortho: true }), last);
    assert.deepEqual(result.point, [10, 0]);
    assert.equal(result.snap?.kind, 'endpoint');
  });

  it('keeps the larger of dx and dy under Ortho, then Grid rounds only the coordinate that differs', () => {
    assertPoint(resolvePointer(scene, [7.3, -7.9], view, aids({ ortho: true }), last).point, [7.3, -10]);
    assertPoint(resolvePointer(scene, [7.3, -7.9], view, aids({ ortho: true, grid: true }), last).point, [7, -10]);
    assertPoint(resolvePointer(scene, [0.4, -2.2], view, aids({ ortho: true, grid: true }), last).point, [0, -2]);
  });

  it('turns a direction within 5 degrees of a multiple of 45 under Polar, then Grid rounds the distance on diagonals', () => {
    const diagonal = resolvePointer(scene, [3.1, -6.7], view, aids({ polar: true, grid: true }), last).point;
    assertPoint(diagonal, [5 / Math.SQRT2, -10 + 5 / Math.SQRT2]);
    const ungridded = resolvePointer(scene, [3.1, -6.7], view, aids({ polar: true }), last).point;
    const length = Math.hypot(3.1, 3.3);
    assertPoint(ungridded, [length / Math.SQRT2, -10 + length / Math.SQRT2]);
  });

  it('rounds both coordinates when Polar finds no multiple of 45 within 5 degrees', () => {
    assertPoint(resolvePointer(scene, [3.4, -8.9], view, aids({ polar: true, grid: true }), last).point, [3, -9]);
    assertPoint(resolvePointer(scene, [3.4, -8.9], view, aids({ grid: true }), last).point, [3, -9]);
    assertPoint(resolvePointer(scene, [3.4, -8.9], view, aids({ polar: true }), last).point, [3.4, -8.9]);
  });

  it('keeps the other coordinate when Polar turns onto an axis, in every direction', () => {
    assertPoint(resolvePointer(scene, [-6.2, -9.8], view, aids({ polar: true, grid: true }), last).point, [-6, -10]);
    assertPoint(resolvePointer(scene, [0.2, -3.4], view, aids({ polar: true, grid: true }), last).point, [0, -3]);
    assertPoint(resolvePointer(scene, [0.2, -16.6], view, aids({ polar: true, grid: true }), last).point, [0, -17]);
  });
});

describe('picking and windows', () => {
  const scene = buildScene(drawing([line('L1', 0, 0, 10, 0), line('L2', 0, 5, 10, 5), line('L3', 20, 0, 35, 0), line('L4', 0, 9, 10, 9, 'Locked'), line('L5', 0, 12, 10, 12, 'Frozen')], {
    layers: { 0: layer('0'), Locked: layer('Locked', 'white', { locked: true }), Frozen: layer('Frozen', 'white', { frozen: true }) },
  }));

  it('picks the nearest selectable entity within the aperture', () => {
    assert.equal(pickEntity(scene, [5, 0.5], view)?.id, 'L1');
    assert.equal(pickEntity(scene, [5, 2.5], view), null);
    assert.equal(pickEntity(scene, [5, 9], view), null);
    assert.equal(pickEntity(scene, [5, 12], view), null);
  });

  it('selects wholly inside for a window dragged left to right', () => {
    assert.equal(windowMode([-1, 6], [11, -1]), 'window');
    assert.deepEqual(selectInWindow(scene, [-1, 6], [11, -1]), { mode: 'window', ids: ['L1', 'L2'] });
    assert.deepEqual(selectInWindow(scene, [-1, 6], [5, -1]).ids, []);
  });

  it('selects whatever it touches for a crossing dragged right to left', () => {
    assert.equal(windowMode([25, -3], [15, 1]), 'crossing');
    assert.deepEqual(selectInWindow(scene, [25, -3], [15, 1]), { mode: 'crossing', ids: ['L3'] });
    assert.deepEqual(selectInWindow(scene, [11, 6], [-1, -1]).ids, ['L1', 'L2']);
  });

  it('does not select what a crossing box only overlaps in bounds', () => {
    const diagonal = buildScene(drawing([line('L1', 0, 0, 10, 10)]));
    assert.deepEqual(selectInWindow(diagonal, [9, 1], [6, 4]).ids, []);
    assert.deepEqual(selectInWindow(diagonal, [6, 4], [4, 6]).ids, ['L1']);
  });
});

describe('view formulas', () => {
  it('maps world to screen with Y up', () => {
    assert.deepEqual(worldToScreen(view, [5, 2]), [150, 280]);
    assert.deepEqual(screenToWorld(view, [150, 280]), [5, 2]);
    assert.deepEqual(viewWorldRect(view, { width: 200, height: 100 }), [-10, 20, 10, 30]);
  });

  it('zooms the wheel by 1.2 about the pointer', () => {
    const zoomed = wheelZoom({ zoom: 1, panX: 0, panY: 0 }, [100, 50], -1);
    assertClose(zoomed.zoom, 1.2);
    assertClose(zoomed.panX, -20);
    assertClose(zoomed.panY, -10);
    assertClose(wheelZoom({ zoom: 1.2, panX: -20, panY: -10 }, [100, 50], 1).zoom, 1);
  });

  it('follows the pinch worked example', () => {
    const start = { distance: 100, midpoint: [150, 100] as Point, view: { zoom: 1, panX: 0, panY: 0 } };
    assert.deepEqual(pinchView(start, 200, [150, 100]), { zoom: 2, panX: -150, panY: -100 });
    assert.deepEqual(pinchView(start, 300, [200, 150]), { zoom: 3, panX: -250, panY: -150 });
    assert.equal(pinchView(start, 100000, [150, 100]).zoom, 50);
    assert.equal(pinchView(start, 1, [150, 100]).zoom, 0.05);
  });

  it('fits the bounds with 24 px on each side, centred (ZOOMALL)', () => {
    const fitted = zoomAllView([0, 0, 100, 50], { width: 548, height: 300 }, view);
    assert.equal(fitted.zoom, 5);
    assert.deepEqual([fitted.panX, fitted.panY], [24, 150 + 125]);
    assert.deepEqual(zoomAllView(null, { width: 10, height: 10 }, view), view);
    assert.equal(zoomAllView([5, 5, 5, 5], { width: 100, height: 100 }, view).zoom, view.zoom);
  });

  it('pans by the least amount to put a box 48 px inside each edge', () => {
    const pane = { width: 800, height: 600 };
    const outside = panToReveal([100, 100, 110, 110], { zoom: 1, panX: 0, panY: 0 }, pane, 48);
    const [left, top] = worldToScreen(outside, [100, 110]);
    const [right, bottom] = worldToScreen(outside, [110, 100]);
    assert.ok(left >= 48 - 1e-9 && right <= 752 + 1e-9 && top >= 48 - 1e-9 && bottom <= 552 + 1e-9);
    assert.equal(outside.zoom, 1);
    const inside = { zoom: 1, panX: 400, panY: 300 };
    assert.equal(panToReveal([0, 0, 10, 10], inside, pane, 48), inside);
    assert.deepEqual(panToReveal([900, 0, 910, 10], { zoom: 1, panX: 0, panY: 300 }, pane, 48), { zoom: 1, panX: -158, panY: 300 });
  });
});
