/** The one place the trigger chain order and the chain figures are decided. */

export interface ChainNode {
  id: string;
  prerequisites: string[];
}

/**
 * Chain order: repeatedly take the earliest-created node whose prerequisites
 * have all been taken already. `nodes` arrives in creation order.
 */
export function chainOrder<T extends ChainNode>(nodes: T[]): T[] {
  const taken = new Set<string>();
  const remaining = [...nodes];
  const ordered: T[] = [];
  const known = new Set(nodes.map((n) => n.id));
  while (remaining.length > 0) {
    const index = remaining.findIndex((node) =>
      node.prerequisites.every((id) => !known.has(id) || taken.has(id)),
    );
    const pick = index === -1 ? 0 : index;
    const [node] = remaining.splice(pick, 1);
    taken.add(node.id);
    ordered.push(node);
  }
  return ordered;
}

/**
 * The number of nodes in the longest path that uses only links where the
 * earlier node has exactly one dependant and the later node has exactly one
 * prerequisite.
 */
export function longestRun(nodes: ChainNode[]): number {
  if (nodes.length === 0) return 0;
  const known = new Set(nodes.map((n) => n.id));
  const dependants = new Map<string, string[]>();
  const prereqs = new Map<string, string[]>();
  for (const node of nodes) {
    const kept = node.prerequisites.filter((id) => known.has(id));
    prereqs.set(node.id, kept);
    for (const id of kept) {
      const list = dependants.get(id) ?? [];
      list.push(node.id);
      dependants.set(id, list);
    }
  }
  const eligibleParent = new Map<string, string>();
  for (const node of nodes) {
    const kept = prereqs.get(node.id) ?? [];
    if (kept.length !== 1) continue;
    const parent = kept[0];
    if ((dependants.get(parent) ?? []).length === 1) eligibleParent.set(node.id, parent);
  }
  const memo = new Map<string, number>();
  const runTo = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    memo.set(id, 1);
    const parent = eligibleParent.get(id);
    const value = parent === undefined ? 1 : runTo(parent) + 1;
    memo.set(id, value);
    return value;
  };
  let best = 1;
  for (const node of nodes) best = Math.max(best, runTo(node.id));
  return best;
}

export function hasCycle(nodes: ChainNode[]): boolean {
  const prereqs = new Map(nodes.map((n) => [n.id, n.prerequisites]));
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    const seen = state.get(id);
    if (seen === 1) return true;
    if (seen === 2) return false;
    state.set(id, 1);
    for (const next of prereqs.get(id) ?? []) {
      if (prereqs.has(next) && visit(next)) return true;
    }
    state.set(id, 2);
    return false;
  };
  for (const node of nodes) {
    if (visit(node.id)) return true;
  }
  return false;
}
