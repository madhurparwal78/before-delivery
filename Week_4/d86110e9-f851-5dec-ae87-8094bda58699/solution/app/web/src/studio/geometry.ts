import type { GraphEdge, GraphNode, NodeKind } from '../types';

export const COLUMNS = 24;
export const ROWS = 12;
/** Cell edge length in pixels; a step node is two thirds of it, 96 pixels square. */
export const CELL = 144;
const NODE = 96;

export const PORTS: Record<NodeKind, readonly string[]> = {
  form: ['out'], schedule: ['out'], webhook: ['out'], row_added: ['out'], manual: ['out'],
  set: ['out', 'error'], filter: ['out'], branch: ['true', 'false'], loop: ['each', 'done'], wait: ['out'],
  send_email: ['out', 'error'], add_row: ['out', 'error'], update_row: ['out', 'error'], call_webhook: ['out', 'error'],
};

export const KIND_LABEL: Record<NodeKind, string> = {
  form: 'Form', schedule: 'Schedule', webhook: 'Webhook', row_added: 'Row added', manual: 'Manual',
  set: 'Set values', filter: 'Filter', branch: 'Branch', loop: 'Loop', wait: 'Wait',
  send_email: 'Send email', add_row: 'Add row', update_row: 'Update row', call_webhook: 'Call webhook',
};

/** Add-step toolbar order and the letter key of each kind. */
export const TOOLBAR: Array<{ kind: NodeKind; label: string; key: string }> = [
  { kind: 'set', label: 'Set values', key: 's' },
  { kind: 'filter', label: 'Filter', key: 'f' },
  { kind: 'branch', label: 'Branch', key: 'b' },
  { kind: 'loop', label: 'Loop', key: 'l' },
  { kind: 'wait', label: 'Wait', key: 'w' },
  { kind: 'send_email', label: 'Send email', key: 'e' },
  { kind: 'add_row', label: 'Add row', key: 'a' },
  { kind: 'update_row', label: 'Update row', key: 'u' },
  { kind: 'call_webhook', label: 'Call webhook', key: 'h' },
];

interface Rect {
  x: number;
  y: number;
  size: number;
}

export function nodeRect(col: number, row: number): Rect {
  return { x: (col - 1) * CELL + (CELL - NODE) / 2, y: (row - 1) * CELL + Math.round(CELL * 0.07), size: NODE };
}

export function inPortAt(col: number, row: number): { x: number; y: number } {
  const r = nodeRect(col, row);
  return { x: r.x, y: r.y + r.size / 2 };
}

export function outPortAt(kind: NodeKind, port: string, col: number, row: number): { x: number; y: number } {
  const r = nodeRect(col, row);
  const ports = PORTS[kind];
  const index = Math.max(0, ports.indexOf(port));
  const fraction = ports.length === 1 ? 0.5 : 0.3 + (0.4 * index) / (ports.length - 1);
  return { x: r.x + r.size, y: r.y + r.size * fraction };
}

export function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const reach = Math.max(28, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + reach} ${y1}, ${x2 - reach} ${y2}, ${x2} ${y2}`;
}

function numericId(id: string): number {
  return id === 'trigger' ? 0 : Number(id.slice(1));
}

/** Canvas Tab order: the trigger, then each port's edges depth first, then unconnected steps by id. */
export function executionOrder(trigger: GraphNode, steps: GraphNode[], edges: GraphEdge[]): string[] {
  const kinds = new Map<string, NodeKind>([[trigger.id, trigger.kind], ...steps.map((step) => [step.id, step.kind] as [string, NodeKind])]);
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id) || !kinds.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const port of PORTS[kinds.get(id) as NodeKind]) {
      edges.filter((edge) => edge.from === id && edge.port === port).sort((a, b) => a.order - b.order).forEach((edge) => visit(edge.to));
    }
  };
  visit(trigger.id);
  [...steps].sort((a, b) => numericId(a.id) - numericId(b.id)).forEach((step) => visit(step.id));
  return order;
}

/** Outgoing edges of a step in port order, then edge order. */
export function outgoing(kind: NodeKind, id: string, edges: GraphEdge[]): GraphEdge[] {
  return PORTS[kind].flatMap((port) => edges.filter((edge) => edge.from === id && edge.port === port).sort((a, b) => a.order - b.order));
}

/** The nearest step in a direction from a position, or null when none lies that way. */
export function nearestInDirection(from: { col: number; row: number }, others: GraphNode[], key: string): GraphNode | null {
  let best: GraphNode | null = null;
  let bestScore = Infinity;
  for (const node of others) {
    const dc = node.col - from.col;
    const dr = node.row - from.row;
    const [primary, across] = key === 'ArrowRight' ? [dc, dr] : key === 'ArrowLeft' ? [-dc, dr] : key === 'ArrowDown' ? [dr, dc] : [-dr, dc];
    if (primary <= 0) continue;
    const score = primary + 2 * Math.abs(across);
    if (score < bestScore) {
      best = node;
      bestScore = score;
    }
  }
  return best;
}
