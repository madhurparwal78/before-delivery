// Cycle finding shared by `needs` and `extends`.

// Returns each cycle once. `order` is file order; `edges` lists a node's targets in written order.
export function findCycles(order: readonly string[], edges: ReadonlyMap<string, readonly string[]>): string[][] {
  const members = new Set(order);
  const targets = (node: string): string[] => (edges.get(node) ?? []).filter((target) => members.has(target));

  const reachable = (from: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [from];
    for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
      for (const target of targets(node)) {
        if (!seen.has(target)) {
          seen.add(target);
          stack.push(target);
        }
      }
    }
    return seen;
  };

  const reach = new Map(order.map((node) => [node, reachable(node)] as const));
  const done = new Set<string>();
  const cycles: string[][] = [];
  for (const start of order) {
    if (done.has(start) || !reach.get(start)?.has(start)) continue;
    const component = order.filter((node) => reach.get(start)?.has(node) && reach.get(node)?.has(start));
    for (const node of component) done.add(node);
    const inside = new Set(component);
    const path = walk(start, start, [start], new Set([start]), (node) => targets(node).filter((t) => inside.has(t)));
    if (path) cycles.push(path);
  }
  return cycles;
}

function walk(
  start: string,
  node: string,
  path: string[],
  visited: Set<string>,
  next: (node: string) => string[],
): string[] | null {
  for (const target of next(node)) {
    if (target === start) return [...path, start];
    if (visited.has(target)) continue;
    visited.add(target);
    const found = walk(start, target, [...path, target], visited, next);
    if (found) return found;
  }
  return null;
}
