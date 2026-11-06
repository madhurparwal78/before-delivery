import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrowEnds, defaultPosition, formatTransform, nudge, snap, validCoord, wheelDeltaPx, wheelZoom, type BoardView } from './board.ts';

test('snap rounds to the grid at the current zoom and holds the limits', () => {
  assert.equal(snap(16, 30, 1), 48);
  assert.equal(snap(16, 27, 1), 40);
  assert.equal(snap(16, 20, 2), 24);
  assert.equal(snap(0, -4, 1), 0);
  assert.equal(snap(0, -5, 1), -8);
  assert.equal(snap(7990, 500, 1), 8000);
  assert.equal(snap(-7990, -500, 0.25), -8000);
});

test('nudge and stored coordinate validity', () => {
  assert.equal(nudge(16, 1, false), 24);
  assert.equal(nudge(16, -1, true), -24);
  assert.equal(nudge(8000, 1, true), 8000);
  assert.ok(validCoord(-8000) && validCoord(8000) && validCoord(0));
  assert.ok(!validCoord(8008) && !validCoord(12) && !validCoord(8.5));
});

test('default placement', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(defaultPosition), [
    { x: 16, y: 16 },
    { x: 272, y: 16 },
    { x: 528, y: 16 },
    { x: 784, y: 16 },
    { x: 16, y: 208 },
    { x: 272, y: 400 },
  ]);
});

test('wheel zoom keeps the board point under the pointer and clamps', () => {
  let view: BoardView = { z: 1, tx: 30, ty: 20 };
  const [px, py] = [500, 300];
  for (const delta of [-400, -1200, 3000]) {
    const z2 = Math.max(0.25, Math.min(4, view.z * 2 ** (-delta / 400)));
    const want = { z: z2, tx: px - ((px - view.tx) * z2) / view.z, ty: py - ((py - view.ty) * z2) / view.z };
    view = wheelZoom(view, delta, px, py);
    assert.deepEqual(view, want);
  }
  assert.equal(view.z, 0.25);
  assert.equal(wheelDeltaPx(3, 1, 700), 48);
  assert.equal(wheelDeltaPx(-1, 2, 700), -700);
  assert.equal(wheelDeltaPx(12.5, 0, 700), 12.5);
});

test('transform shows exactly four decimals, never negative zero', () => {
  assert.equal(formatTransform(1, 0, 0), '1.0000,0.0000,0.0000');
  assert.equal(formatTransform(0.25, -1e-7, 123.456789), '0.2500,0.0000,123.4568');
});

// Reference choice: smallest distance, then earliest from side, then earliest to side.
function refArrow(a: [number, number], b: [number, number]): number[] {
  const mids = (x: number, y: number): [number, number][] => [[x + 120, y], [x + 240, y + 80], [x + 120, y + 160], [x, y + 80]];
  const all = mids(...a).flatMap((p, i) => mids(...b).map((q, j) => ({ d: Math.hypot(q[0] - p[0], q[1] - p[1]), i, j, p, q })));
  all.sort((u, v) => u.d - v.d || u.i - v.i || u.j - v.j);
  const best = all[0];
  return best === undefined ? [] : [...best.p, ...best.q];
}

test('arrow ends pick the closest midpoint pair with the stated tie order', () => {
  assert.deepEqual(arrowEnds({ x: 16, y: 16 }, { x: 272, y: 16 }), [256, 96, 272, 96]);
  // Same card: every side meets itself at distance 0, so top-to-top wins.
  assert.deepEqual(arrowEnds({ x: 0, y: 0 }, { x: 0, y: 0 }), [120, 0, 120, 0]);
  // Diagonal: right→top and bottom→left are equally far; right comes before bottom.
  assert.deepEqual(arrowEnds({ x: 0, y: 0 }, { x: 240, y: 160 }), [240, 80, 360, 160]);
  const cases: [[number, number], [number, number]][] = [
    [[0, 0], [400, 0]], [[0, 0], [0, 400]], [[400, 400], [0, 0]], [[0, 0], [120, 80]], [[-80, 40], [160, -120]], [[0, 0], [360, 240]],
  ];
  for (const [a, b] of cases) assert.deepEqual(arrowEnds({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }), refArrow(a, b));
});
