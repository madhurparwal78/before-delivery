import type { Tag, Transform } from './domain';
import { PASS_THROUGH as PASS_THROUGH_MAP, MAX_HOPS, MAX_COLUMNS } from './domain';
import type { LineageEdgeBody, LineageReachedEntry } from './api';

export interface TColumn {
  id: string;
  asset: string;
  direct: ReadonlySet<Tag>;
  suppressed: ReadonlySet<Tag>;
}
export interface TEdge {
  id: string;
  from: string;
  to: string;
  transform: Transform;
}
export interface TGraph {
  columns: Map<string, TColumn>;
  out: Map<string, TEdge[]>;
  inn: Map<string, TEdge[]>;
}

export function buildGraph(columns: TColumn[], edges: TEdge[]): TGraph {
  const colMap = new Map(columns.map((c) => [c.id, c]));
  const out = new Map<string, TEdge[]>();
  const inn = new Map<string, TEdge[]>();
  for (const c of columns) {
    out.set(c.id, []);
    inn.set(c.id, []);
  }
  for (const e of edges) {
    if (!colMap.has(e.from) || !colMap.has(e.to)) continue;
    out.get(e.from)!.push(e);
    inn.get(e.to)!.push(e);
  }
  for (const list of out.values()) list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const list of inn.values()) list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { columns: colMap, out, inn };
}
const PASS_THROUGH = PASS_THROUGH_MAP;
const TAGS: readonly Tag[] = ['Confidential', 'PII'];

interface PrunedGraph {
  index: Map<string, number>;
  nodes: string[];
  adj: number[][];
  radj: number[][];
  holderOf: number[];
  holderIds: string[];
}

function prune(g: TGraph, tag: Tag): PrunedGraph {
  const index = new Map<string, number>();
  const nodes: string[] = [];
  for (const c of g.columns.values()) {
    if (c.suppressed.has(tag)) continue;
    index.set(c.id, nodes.length);
    nodes.push(c.id);
  }
  const adj: number[][] = nodes.map(() => []);
  const radj: number[][] = nodes.map(() => []);
  for (const [from, list] of g.out) {
    const fi = index.get(from);
    if (fi === undefined) continue;
    for (const e of list) {
      if (!PASS_THROUGH[e.transform]) continue;
      const ti = index.get(e.to);
      if (ti === undefined) continue;
      adj[fi].push(ti);
      radj[ti].push(fi);
    }
  }
  const holderOf = nodes.map(() => -1);
  const holderIds: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (g.columns.get(nodes[i]!)!.direct.has(tag)) {
      holderOf[i] = holderIds.length;
      holderIds.push(nodes[i]!);
    }
  }
  return { index, nodes, adj, radj, holderOf, holderIds };
}

/** Iterative Tarjan SCC; result is in topological order (sources of the condensation first). */
function sccTopological(p: PrunedGraph): number[][] {
  const n = p.nodes.length;
  const num = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const emitted: number[][] = [];
  let counter = 0;
  const frames: Array<[number, number]> = [];
  for (let s = 0; s < n; s++) {
    if (num[s] !== -1) continue;
    num[s] = low[s] = counter++;
    stack.push(s);
    onStack[s] = 1;
    frames.push([s, 0]);
    while (frames.length > 0) {
      const top = frames[frames.length - 1]!;
      const u = top[0];
      const edges = p.adj[u]!;
      if (top[1] < edges.length) {
        const v = edges[top[1]]!;
        top[1] += 1;
        if (num[v] === -1) {
          num[v] = low[v] = counter++;
          stack.push(v);
          onStack[v] = 1;
          frames.push([v, 0]);
        } else if (onStack[v] && num[v] < low[u]) {
          low[u] = num[v];
        }
      } else {
        frames.pop();
        if (low[u] === num[u]) {
          const members: number[] = [];
          let w: number;
          do {
            w = stack.pop()!;
            onStack[w] = 0;
            members.push(w);
          } while (w !== u);
          emitted.push(members);
        }
        if (frames.length > 0) {
          const parent = frames[frames.length - 1]![0];
          if (low[u] < low[parent]) low[parent] = low[u];
        }
      }
    }
  }
  return emitted.reverse();
}

/**
 * Reach and effective tags with suppression, decided once (DP-30, DP-32, DP-34).
 * For each tag the suppressor columns are removed and pass-through edges kept;
 * a holder's tag reaches exactly the columns reachable from it in that graph,
 * including through cycles. SCCs give cycle-insensitive propagation in one pass.
 */
export class EffectiveIndex {
  private readonly sccSets = new Map<Tag, Uint32Array[]>();
  private readonly sccOfNode = new Map<Tag, Int32Array>();
  private readonly nodeIndex = new Map<Tag, Map<string, number>>();
  private readonly holderBit = new Map<Tag, Map<string, number>>();
  private readonly holderIds = new Map<Tag, string[]>();
  private readonly holderSet = new Map<Tag, ReadonlySet<string>>();

  constructor(graph: TGraph) {
    const words = (n: number) => Math.ceil(n / 32);
    for (const tag of TAGS) {
      const p = prune(graph, tag);
      const comps = sccTopological(p);
      const sccOf = new Int32Array(p.nodes.length);
      const sets: Uint32Array[] = comps.map(() => new Uint32Array(Math.max(1, words(p.holderIds.length))));
      comps.forEach((members, ci) => {
        for (const m of members) sccOf[m] = ci;
      });
      for (let ci = 0; ci < comps.length; ci++) {
        const set = sets[ci]!;
        for (const m of comps[ci]!) {
          const h = p.holderOf[m]!;
          if (h >= 0) set[h >>> 5] |= 1 << (h & 31);
        }
      }
      // comps are topological: predecessors' bits flow into successors
      for (let ci = 0; ci < comps.length; ci++) {
        const set = sets[ci]!;
        for (const m of comps[ci]!) {
          for (const pred of p.radj[m]!) {
            const pci = sccOf[pred]!;
            if (pci === ci) continue;
            const pset = sets[pci]!;
            for (let w = 0; w < set.length; w++) set[w] |= pset[w]!;
          }
        }
      }
      this.sccSets.set(tag, sets);
      this.sccOfNode.set(tag, sccOf);
      this.nodeIndex.set(tag, p.index);
      this.holderBit.set(tag, new Map(p.holderIds.map((id, i) => [id, i])));
      this.holderIds.set(tag, p.holderIds);
      this.holderSet.set(tag, new Set(p.holderIds));
    }
  }

  holderReaches(tag: Tag, holder: string, col: string): boolean {
    const bit = this.holderBit.get(tag)?.get(holder);
    if (bit === undefined) return false;
    const idx = this.nodeIndex.get(tag)?.get(col);
    if (idx === undefined) return false;
    const set = this.sccSets.get(tag)![this.sccOfNode.get(tag)![idx]!]!;
    return (set[bit >>> 5]! & (1 << (bit & 31))) !== 0;
  }

  isHolder(tag: Tag, col: string): boolean {
    return this.holderSet.get(tag)?.has(col) ?? false;
  }

  hasAnyHolder(tag: Tag, col: string): boolean {
    const idx = this.nodeIndex.get(tag)?.get(col);
    if (idx === undefined) return false;
    const set = this.sccSets.get(tag)![this.sccOfNode.get(tag)![idx]!]!;
    for (let w = 0; w < set.length; w++) if (set[w]! !== 0) return true;
    return false;
  }

  /** Effective tags sorted alphabetically (Confidential before PII). */
  effectiveOf(col: string): Tag[] {
    const out: Tag[] = [];
    for (const tag of TAGS) if (this.hasAnyHolder(tag, col)) out.push(tag);
    return out;
  }

  /** Sorted set of direct-holder columns reaching the column, per effective tag. */
  sourcesOf(col: string): Partial<Record<Tag, string[]>> {
    const out: Partial<Record<Tag, string[]>> = {};
    for (const tag of TAGS) {
      if (!this.hasAnyHolder(tag, col)) continue;
      const ids: string[] = [];
      const holderIds = this.holderIds.get(tag)!;
      const idx = this.nodeIndex.get(tag)!.get(col)!;
      const set = this.sccSets.get(tag)![this.sccOfNode.get(tag)![idx]!]!;
      for (let i = 0; i < holderIds.length; i++) {
        if ((set[i >>> 5]! & (1 << (i & 31))) !== 0) ids.push(holderIds[i]!);
      }
      ids.sort();
      out[tag] = ids;
    }
    return out;
  }
}

/**
 * Whether `tag`, held directly by `holder`, reaches `target` walking `direction`,
 * ignoring a suppression recorded at `ignoreAt` when given.
 */
export function reachesAlong(
  graph: TGraph,
  tag: Tag,
  holder: string,
  target: string,
  direction: 'downstream' | 'upstream',
  ignoreAt?: string
): boolean {
  if (!graph.columns.has(holder) || !graph.columns.has(target)) return false;
  if (holder === target) return true;
  const step = (u: string): TEdge[] => (direction === 'downstream' ? graph.out.get(u) ?? [] : graph.inn.get(u) ?? []);
  const nextOf = (e: TEdge): string => (direction === 'downstream' ? e.to : e.from);
  const seen = new Set<string>([holder]);
  const queue = [holder];
  let qi = 0;
  while (qi < queue.length) {
    const u = queue[qi++]!;
    for (const e of step(u)) {
      if (!PASS_THROUGH[e.transform]) continue;
      const v = nextOf(e);
      if (!graph.columns.has(v) || seen.has(v)) continue;
      if (v !== target && v !== ignoreAt && graph.columns.get(v)!.suppressed.has(tag)) continue;
      if (v === target) return true;
      seen.add(v);
      queue.push(v);
    }
  }
  return false;
}

export interface TraversalResult {
  reached: LineageReachedEntry[];
  edges: LineageEdgeBody[];
  cycles: Array<{ from: string; to: string }>;
  truncated: boolean;
}

export interface TraversalContext {
  graph: TGraph;
  focusTags: Tag[];
  focusSources: Partial<Record<Tag, string[]>>;
  /** Fills carried/sealed/source info for one reached column. */
  describe(column: string): { carried: Tag[]; sealed: Tag[]; sources: Partial<Record<Tag, string[]>> };
}

/** Breadth-first lineage traversal with the published bounds (DP-39, DP-40). */
export function traverse(ctx: TraversalContext, focus: string, direction: 'downstream' | 'upstream'): TraversalResult {
  const { graph } = ctx;
  const downstream = direction === 'downstream';
  const step = (u: string): TEdge[] => (downstream ? graph.out.get(u) ?? [] : graph.inn.get(u) ?? []);
  const nextOf = (e: TEdge): string => (downstream ? e.to : e.from);

  const hopOf = new Map<string, number>([[focus, 0]]);
  const reached: LineageReachedEntry[] = [];
  const edgeMap = new Map<string, LineageEdgeBody>();
  const cycles: Array<{ from: string; to: string }> = [];
  const cycleKeys = new Set<string>();
  let truncated = false;

  const recordEdge = (e: TEdge, u: string, v: string) => {
    const key = `${e.from}|${e.to}`;
    if (edgeMap.has(key)) return;
    const cycleCandidate = v === focus || (hopOf.has(v) && hopOf.get(v)! <= hopOf.get(u)!);
    let kind: LineageEdgeBody['kind'];
    if (cycleCandidate && pathBack(graph, v, u, downstream)) {
      kind = 'cycle';
      if (!cycleKeys.has(key)) {
        cycleKeys.add(key);
        cycles.push({ from: e.from, to: e.to });
      }
    } else if (!PASS_THROUGH[e.transform]) {
      kind = 'seal';
    } else {
      kind = 'flow';
    }
    edgeMap.set(key, { from: e.from, to: e.to, transform: e.transform, kind });
  };

  let frontier: string[] = [focus];
  for (let hop = 1; hop <= MAX_HOPS && frontier.length > 0; hop++) {
    const found: string[] = [];
    const next: string[] = [];
    for (const u of frontier) {
      for (const e of step(u)) {
        const v = nextOf(e);
        if (!graph.columns.has(v)) continue;
        if (v === focus) {
          recordEdge(e, u, v);
          continue;
        }
        if (!hopOf.has(v)) {
          hopOf.set(v, hop);
          found.push(v);
          next.push(v);
        }
        recordEdge(e, u, v);
      }
    }
    found.sort();
    let cutHere = false;
    for (const v of found) {
      if (reached.length >= MAX_COLUMNS) {
        truncated = true;
        cutHere = true;
        break;
      }
      reached.push({ column: v, asset: graph.columns.get(v)!.asset, hop, carried_tags: [], sealed_tags: [], tag_sources: {} });
    }
    if (cutHere) {
      frontier = [];
      break;
    }
    if (hop === MAX_HOPS && next.length > 0) truncated = true;
    frontier = next;
  }

  for (const entry of reached) {
    const ex = ctx.describe(entry.column);
    entry.carried_tags = ex.carried;
    entry.sealed_tags = ex.sealed;
    entry.tag_sources = ex.sources;
  }

  const kept = new Set<string>([focus, ...reached.map((r) => r.column)]);
  const edges = [...edgeMap.values()].filter((e) => kept.has(e.from) && kept.has(e.to));
  const edgeKeys = new Set(edges.map((e) => `${e.from}|${e.to}`));
  return { reached, edges, cycles: cycles.filter((c) => edgeKeys.has(`${c.from}|${c.to}`)), truncated };
}

/** A path, walked in the traversal direction, from `v` back to `u` (any edge kinds). */
function pathBack(graph: TGraph, v: string, u: string, downstream: boolean): boolean {
  if (v === u) return true;
  const step = (x: string): TEdge[] => (downstream ? graph.out.get(x) ?? [] : graph.inn.get(x) ?? []);
  const nextOf = (e: TEdge): string => (downstream ? e.to : e.from);
  const seen = new Set<string>([v]);
  const queue = [v];
  let qi = 0;
  while (qi < queue.length) {
    const x = queue[qi++]!;
    for (const e of step(x)) {
      const y = nextOf(e);
      if (y === u) return true;
      if (!graph.columns.has(y) || seen.has(y)) continue;
      seen.add(y);
      queue.push(y);
    }
  }
  return false;
}
