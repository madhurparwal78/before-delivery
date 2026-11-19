import { PORTS } from './kinds.js';
import type { AnyNode, Content, Edge } from './model.js';

export function nodes(content: Content): AnyNode[] {
  return [content.trigger, ...content.steps];
}

export function nodeOf(content: Content, id: string): AnyNode | undefined {
  return id === 'trigger' ? content.trigger : content.steps.find((step) => step.id === id);
}

export function edgesFrom(content: Content, id: string, port: string): Edge[] {
  return content.edges.filter((edge) => edge.from === id && edge.port === port).sort((a, b) => a.order - b.order);
}

export function hasPort(content: Content, id: string, port: string): boolean {
  const node = nodeOf(content, id);
  return node !== undefined && PORTS[node.kind].includes(port);
}

/** Every step id reachable from the given starting ids by following edges, the starting ids included. */
export function reachable(content: Content, starts: readonly string[]): Set<string> {
  const seen = new Set<string>(starts);
  const pending = [...starts];
  while (pending.length > 0) {
    const id = pending.pop() as string;
    for (const edge of content.edges) {
      if (edge.from === id && !seen.has(edge.to)) {
        seen.add(edge.to);
        pending.push(edge.to);
      }
    }
  }
  return seen;
}

/** Steps that run inside a loop's each part, whatever the loop and however deep. */
export function loopBodyIds(content: Content): Set<string> {
  const body = new Set<string>();
  for (const step of content.steps) {
    if (step.kind !== 'loop') continue;
    const starts = edgesFrom(content, step.id, 'each').map((edge) => edge.to);
    for (const id of reachable(content, starts)) body.add(id);
  }
  return body;
}

export function numericId(id: string): number {
  return id === 'trigger' ? 0 : Number(id.slice(1));
}

/** Steps in depth-first order from the trigger, ports taken in their declared order. */
export function depthFirstOrder(content: Content): string[] {
  const order: string[] = [];
  const visit = (id: string): void => {
    const node = nodeOf(content, id);
    if (node === undefined) return;
    for (const port of PORTS[node.kind]) {
      for (const edge of edgesFrom(content, id, port)) {
        order.push(edge.to);
        visit(edge.to);
      }
    }
  };
  visit('trigger');
  return order;
}
