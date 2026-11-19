import type { GraphEdge, RunStep } from '../types';

/** Steps that run inside a loop's each part, however deep. */
export function loopBodyIds(edges: GraphEdge[], steps: RunStep[]): Set<string> {
  const body = new Set<string>();
  const pending = steps.filter((step) => step.kind === 'loop').flatMap((loop) => edges.filter((edge) => edge.from === loop.id && edge.port === 'each').map((edge) => edge.to));
  while (pending.length > 0) {
    const id = pending.pop() as string;
    if (body.has(id)) continue;
    body.add(id);
    edges.filter((edge) => edge.from === id).forEach((edge) => pending.push(edge.to));
  }
  return body;
}
