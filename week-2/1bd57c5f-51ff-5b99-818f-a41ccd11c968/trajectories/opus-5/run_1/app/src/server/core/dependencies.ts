/** The blocked-by graph: each item maps to the items it waits on. */
export type BlockerGraph = Map<string, string[]>;

export const MAX_BLOCKERS = 10;

export function wouldCycle(graph: BlockerGraph, itemId: string, blockers: string[]): boolean {
  if (blockers.includes(itemId)) return true;
  const next: BlockerGraph = new Map(graph);
  next.set(itemId, blockers);
  const seen = new Set<string>();
  const stack: string[] = [...blockers];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === itemId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const blocker of next.get(current) ?? []) stack.push(blocker);
  }
  return false;
}

/** Every item that waits on the given item, directly or through any chain. */
export function transitiveDependents(graph: BlockerGraph, itemId: string): Set<string> {
  const dependents = new Map<string, string[]>();
  for (const [item, blockers] of graph) {
    for (const blocker of blockers) {
      const list = dependents.get(blocker) ?? [];
      list.push(item);
      dependents.set(blocker, list);
    }
  }
  const out = new Set<string>();
  const stack = [...(dependents.get(itemId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (out.has(current)) continue;
    out.add(current);
    for (const next of dependents.get(current) ?? []) stack.push(next);
  }
  return out;
}
