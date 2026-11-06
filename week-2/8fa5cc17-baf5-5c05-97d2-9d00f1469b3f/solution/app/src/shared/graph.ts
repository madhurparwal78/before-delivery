// Link graph layout: node hash, jitter generator, seeded start on type shells, forces,
// velocity-Verlet integration, settling, reheat and pinning. All arithmetic is 64-bit float
// in the order the brief gives.

import type { Vec3 } from './camera.ts';
import { compareIds, compareText } from './query.ts';

export const SHELL_BASE = 6;
export const SHELL_STEP = 4;
export const GOLDEN_ANGLE_DEG = 137.50776405;
export const REPULSION = 40;
export const REPULSION_MIN_DISTANCE = 0.5;
export const SPRING_K = 0.08;
export const SPRING_LENGTH = 6;
export const SHELL_K = 0.2;
export const STEP = 0.05;
export const DAMPING = 0.92;
export const REST_SPEED = 0.002;
export const INITIAL_STEPS = 600;
export const REHEAT_STEPS = 400;
export const REHEAT_MS = 16;
export const MAX_STEPS_PER_FRAME = 8;
export const NODE_SIZE_BASE = 0.6;
export const NODE_SIZE_PER_BACKLINK = 0.15;
export const NODE_SIZE_MAX = 2.4;
/** opacity of nodes and edges outside the chosen share scope, and the labels' scope factor */
export const OUT_OF_SCOPE_OPACITY = 0.25;
/** longest gap between graph refetches while a share scope is chosen */
export const SCOPE_REFRESH_MS = 5000;

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const JITTER_INCREMENT = 1831565813;
const TWO_32 = 4294967296;

export interface LayoutNode {
  id: string;
  title: string;
  /** position of the node's type in library order */
  typeIndex: number;
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
}

export interface Layout {
  /** node ids in layout order */
  order: string[];
  /** node id → index into order, radius, pos, vel and acc */
  index: Map<string, number>;
  radius: number[];
  pos: Vec3[];
  vel: Vec3[];
  acc: Vec3[];
  /** link edges in ascending id order, with both ends present */
  edges: LayoutEdge[];
  pinned: Set<string>;
}

export function nodeSize(backlinks: number): number {
  return Math.min(NODE_SIZE_MAX, NODE_SIZE_BASE + NODE_SIZE_PER_BACKLINK * backlinks);
}

export function shellRadius(typeIndex: number): number {
  return SHELL_BASE + SHELL_STEP * typeIndex;
}

function utf8(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** 32-bit FNV-1a of the UTF-8 bytes of the lowercase id, unsigned. */
export function nodeHash(id: string): number {
  let h = FNV_OFFSET;
  for (const b of utf8(id.toLowerCase())) h = Math.imul(h ^ b, FNV_PRIME) >>> 0;
  return h;
}

/** The first `count` outputs of the jitter generator seeded with `seed`, each in [0, 1). */
export function jitter(seed: number, count = 3): number[] {
  let a = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    a = (a + JITTER_INCREMENT) >>> 0;
    let q = Math.imul(a ^ (a >>> 15), a | 1) >>> 0;
    q = ((q + Math.imul(q ^ (q >>> 7), q | 61)) ^ q) >>> 0;
    out.push(((q ^ (q >>> 14)) >>> 0) / TWO_32);
  }
  return out;
}

/** Layout order: type in library order, then title ignoring case, then id. */
export function layoutOrder(nodes: readonly LayoutNode[]): LayoutNode[] {
  return [...nodes].sort(
    (a, b) =>
      a.typeIndex - b.typeIndex ||
      compareText(a.title, b.title) ||
      compareIds(a.id, b.id),
  );
}

/** Seeded start of every node, by id: its shell point plus jitter. */
export function seededStart(nodes: readonly LayoutNode[]): Map<string, Vec3> {
  const groups = new Map<number, LayoutNode[]>();
  for (const node of layoutOrder(nodes)) {
    const group = groups.get(node.typeIndex);
    if (group === undefined) groups.set(node.typeIndex, [node]);
    else group.push(node);
  }
  const out = new Map<string, Vec3>();
  for (const [typeIndex, group] of groups) {
    const r = shellRadius(typeIndex);
    const n = group.length;
    group.forEach((node, j) => {
      const y = 1 - (2 * (j + 0.5)) / n;
      const rho = Math.sqrt(1 - y * y);
      const theta = (j * GOLDEN_ANGLE_DEG * Math.PI) / 180;
      const [u1 = 0, u2 = 0, u3 = 0] = jitter(nodeHash(node.id));
      out.set(node.id, [r * rho * Math.cos(theta) + u1 - 0.5, r * y + u2 - 0.5, r * rho * Math.sin(theta) + u3 - 0.5]);
    });
  }
  return out;
}

function sortedEdges(edges: readonly LayoutEdge[], index: Map<string, number>): LayoutEdge[] {
  return edges
    .filter((e) => index.has(e.from) && index.has(e.to))
    .sort((a, b) => compareIds(a.id, b.id));
}

/** Accelerations (mass 1) for the given positions: repulsion, then springs, then shells. */
export function accelerations(layout: Layout, pos: readonly Vec3[]): Vec3[] {
  const count = pos.length;
  const acc: Vec3[] = pos.map((): Vec3 => [0, 0, 0]);
  for (let i = 0; i < count; i++) {
    const pi = pos[i];
    const ai = acc[i];
    if (pi === undefined || ai === undefined) continue;
    for (let j = i + 1; j < count; j++) {
      const pj = pos[j];
      const aj = acc[j];
      if (pj === undefined || aj === undefined) continue;
      const dx = pj[0] - pi[0];
      const dy = pj[1] - pi[1];
      const dz = pj[2] - pi[2];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const [ux, uy, uz] = l === 0 ? [1, 0, 0] : [dx / l, dy / l, dz / l];
      const m = Math.max(l, REPULSION_MIN_DISTANCE);
      const f = REPULSION / (m * m);
      ai[0] -= f * ux;
      ai[1] -= f * uy;
      ai[2] -= f * uz;
      aj[0] += f * ux;
      aj[1] += f * uy;
      aj[2] += f * uz;
    }
  }
  for (const edge of layout.edges) {
    const a = layout.index.get(edge.from);
    const b = layout.index.get(edge.to);
    if (a === undefined || b === undefined) continue;
    const pa = pos[a];
    const pb = pos[b];
    const aa = acc[a];
    const ab = acc[b];
    if (pa === undefined || pb === undefined || aa === undefined || ab === undefined) continue;
    const dx = pb[0] - pa[0];
    const dy = pb[1] - pa[1];
    const dz = pb[2] - pa[2];
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const [ux, uy, uz] = l === 0 ? [1, 0, 0] : [dx / l, dy / l, dz / l];
    const f = SPRING_K * (l - SPRING_LENGTH);
    aa[0] += f * ux;
    aa[1] += f * uy;
    aa[2] += f * uz;
    ab[0] -= f * ux;
    ab[1] -= f * uy;
    ab[2] -= f * uz;
  }
  for (let i = 0; i < count; i++) {
    const p = pos[i];
    const ai = acc[i];
    const r = layout.radius[i];
    if (p === undefined || ai === undefined || r === undefined) continue;
    const l = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
    if (l > 0) {
      const f = -SHELL_K * (l - r);
      ai[0] += f * (p[0] / l);
      ai[1] += f * (p[1] / l);
      ai[2] += f * (p[2] / l);
    }
  }
  return acc;
}

function build(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], previous: Layout | null): Layout {
  const ordered = layoutOrder(nodes);
  const order = ordered.map((n) => n.id);
  const index = new Map(order.map((id, i) => [id, i]));
  const start = seededStart(nodes);
  const pos: Vec3[] = [];
  const vel: Vec3[] = [];
  for (const id of order) {
    const at = previous?.index.get(id);
    const oldPos = at === undefined ? undefined : previous?.pos[at];
    const oldVel = at === undefined ? undefined : previous?.vel[at];
    const seeded = start.get(id) ?? [0, 0, 0];
    pos.push(oldPos === undefined ? seeded : [oldPos[0], oldPos[1], oldPos[2]]);
    vel.push(oldVel === undefined ? [0, 0, 0] : [oldVel[0], oldVel[1], oldVel[2]]);
  }
  const pinned = new Set([...(previous?.pinned ?? [])].filter((id) => index.has(id)));
  const layout: Layout = {
    order,
    index,
    radius: ordered.map((n) => shellRadius(n.typeIndex)),
    pos,
    vel,
    acc: [],
    edges: sortedEdges(edges, index),
    pinned,
  };
  layout.acc = accelerations(layout, pos);
  return layout;
}

/** A layout at its seeded start, velocities 0, accelerations computed. */
export function createLayout(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): Layout {
  return build(nodes, edges, null);
}

/** One integrator step; returns the largest speed among unpinned nodes. */
export function step(layout: Layout): number {
  const { pos, vel, acc, order, pinned } = layout;
  const free = order.map((id) => !pinned.has(id));
  pos.forEach((p, i) => {
    const v = vel[i];
    const a = acc[i];
    if (!free[i] || v === undefined || a === undefined) return;
    for (let k = 0; k < 3; k++) p[k] += v[k] * STEP + 0.5 * a[k] * STEP * STEP;
  });
  const next = accelerations(layout, pos);
  let top = 0;
  vel.forEach((v, i) => {
    if (!free[i]) {
      v[0] = 0;
      v[1] = 0;
      v[2] = 0;
      return;
    }
    const a = acc[i];
    const n = next[i];
    if (a === undefined || n === undefined) return;
    for (let k = 0; k < 3; k++) v[k] = (v[k] + 0.5 * (a[k] + n[k]) * STEP) * DAMPING;
    top = Math.max(top, Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]));
  });
  layout.acc = next;
  return top;
}

/** Steps until rest or `maxSteps`; returns the number of steps run. */
export function settle(layout: Layout, maxSteps: number = INITIAL_STEPS): number {
  for (let n = 1; n <= maxSteps; n++) {
    if (step(layout) < REST_SPEED) return n;
  }
  return maxSteps;
}

function edgeKey(e: LayoutEdge): string {
  return `${e.id}\u0000${e.from}\u0000${e.to}`;
}

/**
 * Applies a refetched graph in place: existing nodes keep position and velocity, new nodes take
 * their seeded start, removed nodes and their pins drop. Returns whether the node or edge set changed.
 */
export function updateGraph(layout: Layout, nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): boolean {
  const next = build(nodes, edges, layout);
  const sameNodes = next.order.length === layout.order.length && next.order.every((id) => layout.index.has(id));
  const oldEdges = new Set(layout.edges.map(edgeKey));
  const sameEdges = next.edges.length === layout.edges.length && next.edges.every((e) => oldEdges.has(edgeKey(e)));
  Object.assign(layout, next);
  return !(sameNodes && sameEdges);
}

export interface Reheat {
  /** steps still allowed; 0 once at rest or exhausted */
  remaining: number;
  /** page-clock time not yet spent on steps */
  carryMs: number;
}

export function startReheat(): Reheat {
  return { remaining: REHEAT_STEPS, carryMs: 0 };
}

/** Runs the steps due after `elapsedMs` of page-clock time (all of them under reduced motion). */
export function advanceReheat(layout: Layout, reheat: Reheat, elapsedMs: number, reducedMotion: boolean): Reheat {
  let remaining = reheat.remaining;
  let carryMs = reheat.carryMs + elapsedMs;
  let due = reducedMotion ? remaining : Math.min(MAX_STEPS_PER_FRAME, Math.floor(carryMs / REHEAT_MS), remaining);
  if (!reducedMotion) carryMs -= due * REHEAT_MS;
  while (due > 0) {
    due--;
    remaining--;
    if (step(layout) < REST_SPEED) remaining = 0;
    if (remaining === 0) break;
  }
  return { remaining, carryMs: remaining === 0 ? 0 : carryMs };
}

export function positionOf(layout: Layout, id: string): Vec3 | undefined {
  const i = layout.index.get(id);
  return i === undefined ? undefined : layout.pos[i];
}

/** Pins a node at `at` (or where it is) with velocity 0. */
export function pin(layout: Layout, id: string, at?: Vec3): void {
  const i = layout.index.get(id);
  if (i === undefined) return;
  layout.pinned.add(id);
  const p = layout.pos[i];
  const v = layout.vel[i];
  if (p !== undefined && at !== undefined) {
    p[0] = at[0];
    p[1] = at[1];
    p[2] = at[2];
  }
  if (v !== undefined) {
    v[0] = 0;
    v[1] = 0;
    v[2] = 0;
  }
  layout.acc = accelerations(layout, layout.pos);
}

export function unpin(layout: Layout, id: string): void {
  layout.pinned.delete(id);
}
