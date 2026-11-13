import type { Stats } from '../../shared/format.js';

interface GraphNode {
  id: string;
  prerequisites: string[];
}

/**
 * Chain order: repeatedly take the earliest-created node whose prerequisites have all been taken.
 * The input is in creation order. This one order drives the node cards, N stepping, the cue timeline and choke-point ties.
 */
export function chainOrder<T extends GraphNode>(nodes: T[]): T[] {
  const taken = new Set<string>();
  const ordered: T[] = [];
  while (ordered.length < nodes.length) {
    const next = nodes.find((node) => !taken.has(node.id) && node.prerequisites.every((id) => taken.has(id)));
    if (!next) break;
    taken.add(next.id);
    ordered.push(next);
  }
  return ordered;
}

/** True when giving `nodeId` these prerequisites would make a loop. */
export function wouldLoop(nodes: GraphNode[], nodeId: string, prerequisites: string[]): boolean {
  const dependencies = new Map(nodes.map((node) => [node.id, node.id === nodeId ? prerequisites : node.prerequisites]));
  const seen = new Set<string>();
  const stack = [...prerequisites];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === nodeId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(dependencies.get(id) ?? []));
  }
  return false;
}

/**
 * The nodes in the longest path that uses only links where the earlier node has exactly one dependant
 * and the later node has exactly one prerequisite. 0 for an empty graph.
 */
function longestRun(nodes: GraphNode[]): number {
  const dependants = new Map<string, number>();
  for (const node of nodes) for (const id of node.prerequisites) dependants.set(id, (dependants.get(id) ?? 0) + 1);
  const run = new Map<string, number>();
  let longest = 0;
  for (const node of chainOrder(nodes)) {
    const [only] = node.prerequisites;
    const linked = node.prerequisites.length === 1 && only !== undefined && dependants.get(only) === 1;
    const length = 1 + (linked ? (run.get(only) ?? 0) : 0);
    run.set(node.id, length);
    longest = Math.max(longest, length);
  }
  return longest;
}

/** The chain figures of a room: the one place they are computed. */
export function chainStats(nodes: GraphNode[], solvedNodeIds: ReadonlySet<string>, propCount: number): Stats {
  return {
    solved: nodes.filter((node) => solvedNodeIds.has(node.id)).length,
    total: nodes.length,
    longestRun: longestRun(nodes),
    props: propCount,
  };
}
