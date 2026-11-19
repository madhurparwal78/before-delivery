import type { StoredLink } from './schedule.js';

/**
 * The loop a new link from `from` to `to` would close: the path starts at the predecessor, goes to
 * the successor, then follows existing links back to the predecessor. Fewest links wins; ties are
 * broken by the lowest row numbers read in order. Null when the link closes no loop.
 */
export function findLoopPath(
  from: string,
  to: string,
  links: readonly StoredLink[],
  rowOf: Map<string, number>,
): string[] | null {
  const successors = new Map<string, string[]>();
  for (const link of links) {
    const list = successors.get(link.from);
    if (list) list.push(link.to);
    else successors.set(link.from, [link.to]);
  }
  for (const list of successors.values()) {
    list.sort((a, b) => (rowOf.get(a) ?? 0) - (rowOf.get(b) ?? 0));
  }

  const predecessors = new Map<string, string[]>();
  for (const link of links) {
    const list = predecessors.get(link.to);
    if (list) list.push(link.from);
    else predecessors.set(link.to, [link.from]);
  }

  // Shortest distance from each node to `from`, walking the links backwards from `from`.
  const distance = new Map<string, number>([[from, 0]]);
  let frontier = [from];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const previous of predecessors.get(node) ?? []) {
        if (!distance.has(previous)) {
          distance.set(previous, distance.get(node)! + 1);
          next.push(previous);
        }
      }
    }
    frontier = next;
  }

  const remaining = distance.get(to);
  if (remaining === undefined) return null;

  const path = [from, to];
  let current = to;
  let left = remaining;
  while (left > 0) {
    const step = (successors.get(current) ?? []).find((next) => distance.get(next) === left - 1)!;
    path.push(step);
    current = step;
    left -= 1;
  }
  return path;
}
