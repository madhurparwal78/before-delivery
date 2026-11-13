import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { screenToWorld, worldToScreen } from '../../shared/geometry/index.ts';
import type { Point } from '../../shared/types.ts';
import { layer, line } from '../../shared/model/testing.ts';
import { FakeServer, openStore, settle } from './testing.ts';
import type { DrawingStore } from './drawingStore.ts';

const VIEW = { zoom: 10, panX: 100, panY: 300 };

async function opened(seed: ConstructorParameters<typeof FakeServer>[0] = {}): Promise<{ store: DrawingStore; server: FakeServer }> {
  const server = new FakeServer(seed);
  server.document = () => ({ ...FakeServer.prototype.document.call(server), view: { zoom: VIEW.zoom, pan_x: VIEW.panX, pan_y: VIEW.panY } });
  const { store } = openStore(server);
  store.setPaneSize(800, 600);
  await store.open();
  await settle();
  store.toggleAid('snap');
  return { store, server };
}

const screen = (x: number, y: number): Point => worldToScreen(VIEW, [x, y]);
const selected = (store: DrawingStore): string[] => [...store.getSnapshot().selection].sort();

function drag(store: DrawingStore, from: Point, to: Point, shift = false): void {
  store.pointerDown(from, 0, shift);
  store.pointerMove([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]);
  store.pointerMove(to);
  store.pointerUp(to, shift);
}

describe('selection by pointer', () => {
  it('selects what a left-to-right window holds and what a right-to-left crossing touches, adding to the selection', async () => {
    const { store } = await opened({ entities: [line('L1', 0, 0, 10, 0), line('L2', 0, 5, 10, 5), line('L3', 20, 0, 35, 0)] });
    store.pointerDown(screen(-1, 6), 0, false);
    store.pointerMove(screen(11, -1));
    assert.equal(store.getSnapshot().window?.mode, 'window');
    store.pointerUp(screen(11, -1), false);
    assert.deepEqual(selected(store), ['L1', 'L2']);
    assert.equal(store.getSnapshot().window, null);
    store.pointerDown(screen(25, -3), 0, false);
    store.pointerMove(screen(15, 1));
    assert.equal(store.getSnapshot().window?.mode, 'crossing');
    store.pointerUp(screen(15, 1), false);
    assert.deepEqual(selected(store), ['L1', 'L2', 'L3']);
  });

  it('removes with Shift, toggles with a click, and ignores clicks on empty space', async () => {
    const { store } = await opened({ entities: [line('L1', 0, 0, 10, 0), line('L3', 20, 0, 35, 0)] });
    drag(store, screen(-1, 6), screen(40, -1));
    assert.deepEqual(selected(store), ['L1', 'L3']);
    drag(store, screen(-1, 6), screen(11, -1), true);
    assert.deepEqual(selected(store), ['L3']);
    store.pointerDown(screen(5, 0), 0, false);
    store.pointerUp(screen(5, 0), false);
    assert.deepEqual(selected(store), ['L1', 'L3']);
    store.pointerDown(screen(27, 0), 0, false);
    store.pointerUp(screen(27, 0), false);
    assert.deepEqual(selected(store), ['L1']);
    store.pointerDown(screen(100, 100), 0, false);
    store.pointerUp(screen(100, 100), false);
    assert.deepEqual(selected(store), ['L1']);
  });

  it('never selects entities on a locked layer', async () => {
    const { store } = await opened({ layers: [layer('Walls', { locked: true })], entities: [line('L1', 0, 0, 10, 0, 'Walls')] });
    drag(store, screen(-1, 1), screen(11, -1));
    assert.deepEqual(selected(store), []);
  });

  it('updates the snap candidate on every move', async () => {
    const { store } = await opened({ entities: [line('L1', 0, 0, 10, 0), line('L2', 10.4, -2, 10.4, 2)] });
    store.toggleAid('snap');
    store.pointerMove([203, 300]);
    assert.deepEqual([store.getSnapshot().hover.snap?.kind, store.getSnapshot().hover.snap?.point], ['endpoint', [10, 0]]);
    store.pointerMove([150, 294]);
    assert.equal(store.getSnapshot().hover.snap?.kind, 'midpoint');
    store.pointerMove([150, 288]);
    assert.equal(store.getSnapshot().hover.snap, null);
  });
});

describe('grips and nudges', () => {
  it('shows grips for the selection and makes one GRIP group of a drag', async () => {
    const { store, server } = await opened({ entities: [line('L1', 0, 0, 10, 0)] });
    store.toggleAid('snap');
    store.pointerDown(screen(5, 0), 0, false);
    store.pointerUp(screen(5, 0), false);
    const grips = store.getSnapshot().grips.map(({ grip }) => [grip.kind, grip.x, grip.y]);
    assert.deepEqual(grips, [['end', 0, 0], ['end', 10, 0], ['mid', 5, 0]]);
    drag(store, screen(10, 0), screen(12, 3));
    await settle();
    assert.deepEqual(server.posts.map((post) => post.command), ['GRIP']);
    const moved = store.getSnapshot().state.entities.L1;
    assert.equal(moved.type === 'line' && moved.x2, 12);
    assert.equal(moved.type === 'line' && moved.y2, 3);
  });

  it('restores the grip when the drag is refused', async () => {
    const { store } = await opened({ entities: [line('L1', 0, 0, 10, 0)], constraints: [{ kind: 'fixed', refs: [{ handle: 'L1', point: null }] }] });
    store.toggleAid('snap');
    store.selectOnly('L1');
    drag(store, screen(10, 0), screen(14, 3));
    const moved = store.getSnapshot().state.entities.L1;
    assert.equal(moved.type === 'line' && moved.x2, 10);
    assert.deepEqual(store.getSnapshot().grips.find(({ grip }) => grip.index === 1 && grip.kind === 'end')?.grip.x, 10);
  });
});

describe('the camera', () => {
  it('zooms about the pointer by 1.2 per wheel step and pans with the middle button', async () => {
    const { store } = await opened({ entities: [line('L1', 0, 0, 10, 0)] });
    const before = screenToWorld(store.getSnapshot().view, [300, 200]);
    store.wheel([300, 200], -120);
    assert.ok(Math.abs(store.getSnapshot().view.zoom - 12) < 1e-9);
    const after = screenToWorld(store.getSnapshot().view, [300, 200]);
    assert.ok(Math.abs(before[0] - after[0]) < 1e-9 && Math.abs(before[1] - after[1]) < 1e-9);
    store.wheel([300, 200], 120);
    assert.ok(Math.abs(store.getSnapshot().view.zoom - 10) < 1e-9);
    const { panX, panY } = store.getSnapshot().view;
    store.pointerDown([10, 10], 1, false);
    store.pointerMove([30, 25]);
    store.pointerUp([30, 25], false);
    assert.deepEqual([store.getSnapshot().view.panX - panX, store.getSnapshot().view.panY - panY], [20, 15]);
    assert.equal(store.getSnapshot().window, null);
  });

  it('fits the whole drawing with 24 px on each side, centred, and marks the move for the pane to animate', async () => {
    const { store } = await opened({ entities: [line('L1', 0, 0, 100, 50)] });
    const from = store.getSnapshot().view;
    store.zoomAll();
    const { view, zoomAll } = store.getSnapshot();
    const zoom = Math.min((800 - 48) / 100, (600 - 48) / 50);
    assert.ok(Math.abs(view.zoom - zoom) < 1e-9);
    assert.ok(Math.abs(view.panX - (400 - 50 * zoom)) < 1e-9 && Math.abs(view.panY - (300 + 25 * zoom)) < 1e-9);
    assert.deepEqual(zoomAll, { token: 1, from });
  });

  it('pans an entity to 48 px inside the pane edges and selects it with Find', async () => {
    const { store } = await opened({ entities: [line('L1', 0, 0, 10, 0), line('L7', 500, 500, 510, 500)] });
    store.setFindQuery('l7');
    assert.deepEqual(store.getSnapshot().find.matches, ['L7']);
    store.nextMatch();
    assert.deepEqual(selected(store), ['L7']);
    const [left, top] = worldToScreen(store.getSnapshot().view, [500, 500]);
    assert.ok(left >= 48 - 1e-6 && left <= 800 - 48 && top <= 600 - 48 + 1e-6 && top >= 48 - 1e-6);
    assert.equal(store.getSnapshot().dom.some((entity) => entity.id === 'L7'), true);
    store.setFindQuery('nothing_here');
    assert.deepEqual(store.getSnapshot().find.matches, []);
    store.nextMatch();
  });

  it('keeps only the nearest entities in the DOM set plus every selected one', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => line(`L${i + 1}`, (i % 6) * 2, Math.floor(i / 6) * 2, (i % 6) * 2 + 1, Math.floor(i / 6) * 2));
    const server = new FakeServer({ entities: [...lines, line('L99', 5000, 5000, 5001, 5000)] });
    const { store } = openStore(server);
    store.setPaneSize(800, 600);
    await store.open();
    await settle();
    store.zoomAll();
    store.moveView({ zoom: 10, panX: 100, panY: 300 });
    assert.ok(store.getSnapshot().dom.length <= 30);
    assert.equal(store.getSnapshot().dom.some((entity) => entity.id === 'L99'), false);
    store.selectOnly('L99');
    assert.equal(store.getSnapshot().dom.some((entity) => entity.id === 'L99'), true);
    assert.equal(store.getSnapshot().scene.entities.length, 31);
  });
});

describe('aids and measuring', () => {
  it('turns Polar off when Ortho goes on and the other way round, and announces', async () => {
    const server = new FakeServer();
    const { store, spy } = openStore(server);
    store.toggleAid('ortho');
    store.toggleAid('polar');
    assert.deepEqual(store.getSnapshot().aids, { snap: true, ortho: false, grid: false, polar: true });
    store.toggleAid('ortho');
    assert.equal(store.getSnapshot().aids.polar, false);
    assert.deepEqual(spy.announced, ['Ortho on', 'Polar on', 'Ortho on']);
  });

  it('measures from a long-press point to the next tap in the DIST format', async () => {
    const { store } = await opened({ entities: [line('L1', 0, 0, 10, 0)] });
    store.startMeasure([0, 0]);
    assert.equal(store.getSnapshot().measuring, true);
    store.finishMeasure([0, -10]);
    assert.equal(store.getSnapshot().prompt, 'DIST: 10 units, angle 270 degrees');
    assert.equal(store.getSnapshot().measuring, false);
  });
});
