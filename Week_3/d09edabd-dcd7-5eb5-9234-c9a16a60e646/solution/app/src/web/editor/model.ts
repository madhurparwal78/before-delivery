import type { Placement } from '../../shared/types';

export type Mode = 'move' | 'rotate' | 'scale';
export type CameraLabel = 'Overview' | 'Walking in' | 'Player height';

const FIELD_KEYS = ['xMm', 'yMm', 'zMm', 'rotationDeg', 'widthMm', 'depthMm', 'heightMm', 'label'] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];
export type PlacementFields = Pick<Placement, FieldKey>;

/** One placement change the editor made, waiting in the save queue until the server has answered it. */
export type QueuedChange =
  | { opId: string; kind: 'update'; placementId: string; label: string; fields: Partial<PlacementFields>; baseVersion: number }
  | { opId: string; kind: 'delete'; placementId: string; label: string; baseVersion: number }
  | { opId: string; kind: 'move'; placementId: string; label: string; direction: 'up' | 'down' };

export const lockKey = (type: 'placement' | 'node', id: string): string => `${type}:${id}`;

/** Wraps degrees into 0..359. */
export const wrapDegrees = (deg: number): number => ((Math.round(deg) % 360) + 360) % 360;

/** The placements as drawn: the stored room with every waiting change applied on top, in order. */
export function drawPlacements(stored: Placement[], queue: readonly QueuedChange[], preview: { id: string; fields: Partial<PlacementFields> } | null): Placement[] {
  let drawn = stored;
  for (const change of queue) {
    if (change.kind === 'update') drawn = drawn.map((p) => (p.id === change.placementId ? { ...p, ...change.fields } : p));
    else if (change.kind === 'delete') drawn = drawn.filter((p) => p.id !== change.placementId);
  }
  return preview ? drawn.map((p) => (p.id === preview.id ? { ...p, ...preview.fields } : p)) : drawn;
}

/** The scene order as drawn: the stored order with every waiting move applied, each counted from the order so far. */
export function drawSceneOrder(stored: string[], queue: readonly QueuedChange[]): string[] {
  let order = stored;
  for (const change of queue) {
    if (change.kind === 'delete') order = order.filter((id) => id !== change.placementId);
    if (change.kind !== 'move') continue;
    order = movedInOrder(order, change.placementId, change.direction) ?? order;
  }
  return order;
}

/** The order after moving one place up or down, or null when it is already at that end. */
export function movedInOrder(order: string[], id: string, direction: 'up' | 'down'): string[] | null {
  const index = order.indexOf(id);
  const other = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || other < 0 || other >= order.length) return null;
  const next = [...order];
  [next[index], next[other]] = [next[other]!, next[index]!];
  return next;
}

export const newOpId = (): string => `op-${crypto.randomUUID().replaceAll('-', '')}`;
