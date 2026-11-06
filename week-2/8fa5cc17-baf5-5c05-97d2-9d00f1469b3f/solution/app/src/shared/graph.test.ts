import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceReheat,
  createLayout,
  jitter,
  layoutOrder,
  MAX_STEPS_PER_FRAME,
  nodeHash,
  nodeSize,
  pin,
  positionOf,
  REHEAT_STEPS,
  settle,
  startReheat,
  step,
  updateGraph,
  type LayoutEdge,
  type LayoutNode,
} from './graph.ts';

// Independent port of the reference layout, written as plainly as the reference itself.
function refFnv(text: string): number {
  let h = 2166136261;
  for (const b of new TextEncoder().encode(text)) h = Number((BigInt(h ^ b) * 16777619n) & 0xffffffffn) >>> 0;
  return h;
}

function refJitter(seed: number): number[] {
  let a = BigInt(seed >>> 0);
  const m = 0xffffffffn;
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    a = (a + 1831565813n) & m;
    let q = ((a ^ (a >> 15n)) * (a | 1n)) & m;
    q = ((q + (((q ^ (q >> 7n)) * (q | 61n)) & m)) & m) ^ q;
    out.push(Number((q ^ (q >> 14n)) & m) / 4294967296);
  }
  return out;
}

function refSettle(nodesIn: LayoutNode[], edgesIn: LayoutEdge[]): Map<string, number[]> {
  const key = (n: LayoutNode): [number, string, string] => [n.typeIndex, n.title.toLowerCase(), n.id.toLowerCase()];
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const nodes = [...nodesIn].sort((x, y) => {
    const a = key(x);
    const b = key(y);
    return a[0] - b[0] || cmp(a[1], b[1]) || cmp(a[2], b[2]);
  });
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const radius = nodes.map((n) => 6 + 4 * n.typeIndex);
  const members = new Map<number, LayoutNode[]>();
  for (const n of nodes) members.set(n.typeIndex, [...(members.get(n.typeIndex) ?? []), n]);
  const pos: number[][] = nodes.map(() => [0, 0, 0]);
  for (const [t, group] of members) {
    const R = 6 + 4 * t;
    group.forEach((n, j) => {
      const y = 1 - (2 * (j + 0.5)) / group.length;
      const rho = Math.sqrt(1 - y * y);
      const th = (j * 137.50776405 * Math.PI) / 180;
      const u = refJitter(refFnv(n.id.toLowerCase()));
      pos[idx.get(n.id) ?? 0] = [R * rho * Math.cos(th) + u[0] - 0.5, R * y + u[1] - 0.5, R * rho * Math.sin(th) + u[2] - 0.5];
    });
  }
  const edges = [...edgesIn]
    .sort((a, b) => cmp(a.id.toLowerCase(), b.id.toLowerCase()))
    .map((e) => [idx.get(e.from) ?? 0, idx.get(e.to) ?? 0]);
  const count = nodes.length;
  const accel = (P: number[][]): number[][] => {
    const acc = P.map(() => [0, 0, 0]);
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const [dx, dy, dz] = [P[j][0] - P[i][0], P[j][1] - P[i][1], P[j][2] - P[i][2]];
        const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const [ux, uy, uz] = L === 0 ? [1, 0, 0] : [dx / L, dy / L, dz / L];
        const m = Math.max(L, 0.5);
        const f = 40 / (m * m);
        acc[i][0] -= f * ux; acc[i][1] -= f * uy; acc[i][2] -= f * uz;
        acc[j][0] += f * ux; acc[j][1] += f * uy; acc[j][2] += f * uz;
      }
    }
    for (const [a, b] of edges) {
      const [dx, dy, dz] = [P[b][0] - P[a][0], P[b][1] - P[a][1], P[b][2] - P[a][2]];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const [ux, uy, uz] = L === 0 ? [1, 0, 0] : [dx / L, dy / L, dz / L];
      const f = 0.08 * (L - 6);
      acc[a][0] += f * ux; acc[a][1] += f * uy; acc[a][2] += f * uz;
      acc[b][0] -= f * ux; acc[b][1] -= f * uy; acc[b][2] -= f * uz;
    }
    for (let i = 0; i < count; i++) {
      const p = P[i];
      const L = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
      if (L > 0) {
        const f = -0.2 * (L - radius[i]);
        for (let k = 0; k < 3; k++) acc[i][k] += f * (p[k] / L);
      }
    }
    return acc;
  };
  const vel = nodes.map(() => [0, 0, 0]);
  let acc = accel(pos);
  for (let s = 0; s < 600; s++) {
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) pos[i][k] += vel[i][k] * 0.05 + 0.5 * acc[i][k] * 0.05 * 0.05;
    const next = accel(pos);
    let top = 0;
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) vel[i][k] = (vel[i][k] + 0.5 * (acc[i][k] + next[i][k]) * 0.05) * 0.92;
      top = Math.max(top, Math.sqrt(vel[i][0] ** 2 + vel[i][1] ** 2 + vel[i][2] ** 2));
    }
    acc = next;
    if (top < 0.002) break;
  }
  return new Map(nodes.map((n) => [n.id, pos[idx.get(n.id) ?? 0]]));
}

const ids = [
  '0b7e2c4a-9f1d-4c3e-8a55-1d2e3f4a5b6c',
  '1c8f3d5b-a02e-4d4f-9b66-2e3f4a5b6c7d',
  '2d904e6c-b13f-4e50-ac77-3f4a5b6c7d8e',
  '3ea15f7d-c240-4f61-bd88-4a5b6c7d8e9f',
  '4fb2608e-d351-4072-ce99-5b6c7d8e9fa0',
  '50c3719f-e462-4183-dfaa-6c7d8e9fa0b1',
  '61d482a0-f573-4294-e0bb-7d8e9fa0b1c2',
  '72e593b1-0684-43a5-f1cc-8e9fa0b1c2d3',
  '83f6a4c2-1795-44b6-02dd-9fa0b1c2d3e4',
];
const titles = ['Florilegium', 'the gathered margin', 'Chapter three argument', 'Advisor', 'Ödön', 'apple', 'Apple', 'Zeta', 'Reading by Lamplight'];
const sampleNodes: LayoutNode[] = ids.map((id, i) => ({ id, title: titles[i] ?? '', typeIndex: i % 3 }));
const sampleEdges: LayoutEdge[] = [
  { id: 'e3', from: ids[0] ?? '', to: ids[1] ?? '' },
  { id: 'e1', from: ids[2] ?? '', to: ids[5] ?? '' },
  { id: 'e2', from: ids[4] ?? '', to: ids[0] ?? '' },
  { id: 'e10', from: ids[7] ?? '', to: ids[8] ?? '' },
  { id: 'e4', from: ids[3] ?? '', to: ids[6] ?? '' },
];

test('node hash and jitter match the reference integer maths', () => {
  for (const id of [...ids, 'ABC-def', 'Ödön-ß-日本-😀']) {
    assert.equal(nodeHash(id), refFnv(id.toLowerCase()));
    assert.deepEqual(jitter(nodeHash(id)), refJitter(refFnv(id.toLowerCase())));
  }
  assert.equal(nodeHash(''), 2166136261);
  assert.equal(nodeHash('a'), 0xe40c292c);
});

test('layout order: type, then title ignoring case, then id', () => {
  const order = layoutOrder(sampleNodes).map((n) => n.title);
  assert.deepEqual(order, ['Advisor', 'Apple', 'Florilegium', 'the gathered margin', 'Zeta', 'Ödön', 'apple', 'Chapter three argument', 'Reading by Lamplight']);
  const tie = layoutOrder([
    { id: 'B-2', title: 'Same', typeIndex: 1 },
    { id: 'a-9', title: 'same', typeIndex: 1 },
    { id: 'c-1', title: 'Zed', typeIndex: 0 },
  ]).map((n) => n.id);
  assert.deepEqual(tie, ['c-1', 'a-9', 'B-2']);
});

test('settled positions match the reference within 1e-9', () => {
  const layout = createLayout(sampleNodes, sampleEdges);
  const steps = settle(layout, 600);
  assert.ok(steps > 1 && steps <= 600);
  const ref = refSettle(sampleNodes, sampleEdges);
  for (const [id, p] of ref) {
    const got = positionOf(layout, id);
    assert.ok(got !== undefined);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs((got[k] ?? NaN) - (p[k] ?? NaN)) <= 1e-9, `${id}[${k}]`);
  }
});

test('pinned nodes stay put with velocity 0 and still push others', () => {
  const free = createLayout(sampleNodes, sampleEdges);
  const pinned = createLayout(sampleNodes, sampleEdges);
  const id = ids[0] ?? '';
  pin(pinned, id, [30, 0, 0]);
  for (let i = 0; i < 50; i++) {
    step(free);
    step(pinned);
  }
  assert.deepEqual(positionOf(pinned, id), [30, 0, 0]);
  assert.deepEqual(pinned.vel[pinned.index.get(id) ?? -1], [0, 0, 0]);
  assert.notDeepEqual(positionOf(free, ids[1] ?? ''), positionOf(pinned, ids[1] ?? ''));
});

test('updateGraph keeps positions, seeds new nodes, and reports set changes', () => {
  const layout = createLayout(sampleNodes, sampleEdges);
  settle(layout, 600);
  const before = positionOf(layout, ids[0] ?? '');
  assert.ok(before !== undefined);
  const kept: number[] = [...before];
  assert.equal(updateGraph(layout, sampleNodes, [...sampleEdges].reverse()), false);
  const extra: LayoutNode = { id: 'a4c7e000-0000-4000-8000-000000000001', title: 'New', typeIndex: 0 };
  const grown = [...sampleNodes, extra];
  assert.equal(updateGraph(layout, grown, sampleEdges), true);
  assert.deepEqual(positionOf(layout, ids[0] ?? ''), kept);
  const fresh = createLayout(grown, sampleEdges);
  assert.deepEqual(positionOf(layout, extra.id), positionOf(fresh, extra.id));
  assert.equal(updateGraph(layout, grown, sampleEdges.slice(1)), true);
  assert.equal(layout.edges.length, sampleEdges.length - 1);
  assert.deepEqual(layout.edges.map((e) => e.id), ['e1', 'e10', 'e2', 'e4']);
});

test('reheat runs one step per 16 ms with at most 8 per frame, all at once under reduced motion', () => {
  const layout = createLayout(sampleNodes, sampleEdges);
  let r = advanceReheat(layout, startReheat(), 40, false);
  assert.deepEqual(r, { remaining: REHEAT_STEPS - 2, carryMs: 8 });
  r = advanceReheat(layout, r, 1000, false);
  assert.equal(r.remaining, REHEAT_STEPS - 2 - MAX_STEPS_PER_FRAME);
  const reduced = createLayout(sampleNodes, sampleEdges);
  const done = advanceReheat(reduced, startReheat(), 0, true);
  assert.equal(done.remaining, 0);
  const direct = createLayout(sampleNodes, sampleEdges);
  settle(direct, REHEAT_STEPS);
  assert.deepEqual(reduced.pos, direct.pos);
});

test('node size', () => {
  assert.equal(nodeSize(0), 0.6);
  assert.equal(nodeSize(1), 0.6 + 0.15);
  assert.equal(nodeSize(12), 2.4);
  assert.equal(nodeSize(100), 2.4);
});
