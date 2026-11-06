import { Author, OpDto } from '../../shared/api';
import { Graph, SceneNode } from '../../shared/graph';
import { el } from '../dom';

export function nodeName(graph: Graph, nodeId: string | null): string {
  if (nodeId === null) return '';
  return graph.nodes.find((node) => node.id === nodeId)?.name ?? nodeId;
}

export function presenceItems(
  entries: { author: Author; selection: string | null }[],
  graph: Graph,
  self: Author | null,
): HTMLElement[] {
  return entries.map((entry) => {
    const suffix = entry.author.kind === 'agent' ? ' (agent)' : '';
    const selected = entry.selection ? ` · ${nodeName(graph, entry.selection)}` : '';
    const isSelf =
      self !== null && entry.author.kind === self.kind && entry.author.id === self.id;
    return el('li', {
      class: isSelf ? 'presence-self' : null,
      text: `${entry.author.name}${suffix}${selected}`,
    });
  });
}

export interface TreeRow {
  node: SceneNode;
  depth: number;
}

export function flattenTree(graph: Graph, collapsed: Set<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const children = (parentId: string | null): SceneNode[] =>
    graph.nodes.filter((node) => node.parentId === parentId);
  const walk = (node: SceneNode, depth: number): void => {
    rows.push({ node, depth });
    if (collapsed.has(node.id)) return;
    for (const child of children(node.id)) walk(child, depth + 1);
  };
  for (const root of children(null)) walk(root, 0);
  return rows;
}

export function authorWord(author: Author): string {
  return author.kind === 'agent' ? 'agent' : 'person';
}

/** The node an operation names, for the rewind announcement. */
export function announcedNodeId(op: OpDto): string | null {
  const payload = op.payload;
  if (op.type === 'node.add') {
    const node = payload.node as { id?: string } | undefined;
    return typeof node?.id === 'string' ? node.id : null;
  }
  if (op.type === 'state.override.set') {
    return typeof payload.nodeId === 'string' ? payload.nodeId : null;
  }
  if (
    op.type === 'node.remove' ||
    op.type === 'node.rename' ||
    op.type === 'node.reparent' ||
    op.type === 'transform.set' ||
    op.type === 'material.layer.add' ||
    op.type === 'material.layer.set' ||
    op.type === 'material.layer.remove'
  ) {
    return typeof payload.id === 'string' ? payload.id : null;
  }
  return null;
}
