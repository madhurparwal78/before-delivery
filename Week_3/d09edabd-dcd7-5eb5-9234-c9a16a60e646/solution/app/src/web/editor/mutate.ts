import type { Placement, TriggerNode, Version } from '../../shared/types';
import { editor } from './state';

/** Stored-state edits shared by the save queue, the live events and direct answers. */
export function putPlacement(placement: Placement): void {
  editor.set((s) => {
    const known = s.placements.find((p) => p.id === placement.id);
    if (known && known.version > placement.version) return {};
    return {
      placements: known ? s.placements.map((p) => (p.id === placement.id ? placement : p)) : [...s.placements, placement],
      sceneOrder: s.sceneOrder.includes(placement.id) ? s.sceneOrder : [...s.sceneOrder, placement.id],
    };
  });
}

export function removePlacement(id: string): void {
  editor.set((s) => ({
    placements: s.placements.filter((p) => p.id !== id),
    sceneOrder: s.sceneOrder.filter((other) => other !== id),
    selectedId: s.selectedId === id ? null : s.selectedId,
  }));
}

function inChainOrder(nodes: TriggerNode[], order: string[] | undefined): TriggerNode[] {
  if (!order) return nodes;
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...nodes].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}

export function putNode(node: TriggerNode, order?: string[]): void {
  editor.set((s) => {
    const known = s.nodes.find((n) => n.id === node.id);
    if (known && known.version > node.version) return { nodes: inChainOrder(s.nodes, order) };
    return { nodes: inChainOrder(known ? s.nodes.map((n) => (n.id === node.id ? node : n)) : [...s.nodes, node], order) };
  });
}

export function removeNode(id: string, order?: string[]): void {
  editor.set((s) => ({
    nodes: inChainOrder(s.nodes.filter((n) => n.id !== id), order),
    selectedNodeId: s.selectedNodeId === id ? null : s.selectedNodeId,
  }));
}

export function putVersion(version: Version): void {
  editor.set((s) => {
    const rest = s.versions.filter((v) => v.id !== version.id);
    return { versions: [...rest, version].sort((a, b) => b.number - a.number) };
  });
}
