import type { ChainFigures, TriggerNode } from './types.js';

export interface NodeLike {
  id: string;
  title: string;
  kind: TriggerNode['kind'];
  placementId: string | null;
  answer: string | null;
  prerequisites: string[];
  createdAt?: number | Date;
}

/**
 * Chain order: repeatedly take the earliest-created node whose prerequisites
 * have all been taken already, until every node is taken. Ties by creation
 * order, then by id for stability across processes.
 */
export function chainOrder<T extends NodeLike>(nodes: T[]): T[] {
  const time = (n: NodeLike) => {
    const c = (n as { createdAt?: number | Date }).createdAt;
    if (c instanceof Date) return c.getTime();
    if (typeof c === 'number') return c;
    return Number.MAX_SAFE_INTEGER;
  };
  const pending = [...nodes];
  const taken = new Set<string>();
  const out: T[] = [];
  while (pending.length) {
    let best = -1;
    for (let i = 0; i < pending.length; i++) {
      const n = pending[i];
      if (n.prerequisites.every((p) => taken.has(p))) {
        if (best < 0 || time(n) < time(pending[best]) || (time(n) === time(pending[best]) && n.id < pending[best].id)) {
          best = i;
        }
      }
    }
    if (best < 0) break; // defensive: loop-free graphs always finish
    const [n] = pending.splice(best, 1);
    taken.add(n.id);
    out.push(n);
  }
  // Any leftovers (impossible with validated graphs) keep list order.
  out.push(...pending);
  return out;
}

/** prerequisites must be same-room nodes, never the node itself. */
export function prerequisitesValid(nodeId: string, prereq: string[], ids: Set<string>): boolean {
  if (prereq.includes(nodeId)) return false;
  return prereq.every((p) => ids.has(p) && p !== nodeId);
}

/** Would adding edges create a directed loop? (prereq edges point prerequisite -> dependant) */
export function createsLoop(nodes: NodeLike[], nodeId: string, prereq: string[]): boolean {
  const map = new Map<string, string[]>();
  for (const n of nodes) map.set(n.id, n.id === nodeId ? prereq : n.prerequisites);
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    const s = state.get(id);
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    for (const p of map.get(id) ?? []) if (visit(p)) return true;
    state.set(id, 2);
    return false;
  };
  for (const n of nodes) if (visit(n.id)) return true;
  return false;
}

/**
 * longestRun: the number of nodes in the longest path that uses only links
 * where the earlier node has exactly one dependant and the later node has
 * exactly one prerequisite. 1 for a lone node, 0 for an empty graph.
 */
export function longestRun(nodes: NodeLike[]): number {
  if (!nodes.length) return 0;
  const dependants = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const n of nodes) {
    dependants.set(n.id, []);
    inDeg.set(n.id, n.prerequisites.length);
    for (const p of n.prerequisites) dependants.get(p)?.push(n.id);
  }
  // A link p -> n is usable when p has exactly one dependant and n exactly one prerequisite.
  const singleDep = new Set<string>();
  for (const n of nodes) {
    const deps = dependants.get(n.id) ?? [];
    if (deps.length === 1) singleDep.add(n.id);
  }
  const longestTo = new Map<string, number>();
  const order = chainOrder(nodes);
  let best = 0;
  for (const n of order) {
    const prev =
      n.prerequisites.length === 1 && singleDep.has(n.prerequisites[0])
        ? longestTo.get(n.prerequisites[0]) ?? 1
        : 0;
    const len = prev + 1;
    longestTo.set(n.id, len);
    if (len > best) best = len;
  }
  return best;
}

/** Which nodes are solved, and which are currently available. */
export function availability(nodes: NodeLike[], solvedIds: Iterable<string>): Map<string, boolean> {
  const solved = new Set(solvedIds);
  const out = new Map<string, boolean>();
  for (const n of nodes) out.set(n.id, !solved.has(n.id) && n.prerequisites.every((p) => solved.has(p)));
  return out;
}

/** Fire-on-own pass: every lock/cue whose prerequisites are all solved. */
export function fireable(nodes: NodeLike[], solvedIds: Set<string>): NodeLike[] {
  return nodes.filter(
    (n) => (n.kind === 'lock' || n.kind === 'cue') && !solvedIds.has(n.id) && n.prerequisites.every((p) => solvedIds.has(p))
  );
}

export function figuresFor(nodes: NodeLike[], nonDoorCount: number, solvedCount: number): ChainFigures {
  return { solved: solvedCount, total: nodes.length, longestRun: longestRun(nodes), props: nonDoorCount };
}
