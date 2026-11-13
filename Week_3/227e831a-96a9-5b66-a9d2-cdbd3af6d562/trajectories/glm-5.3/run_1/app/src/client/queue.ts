/**
 * The on-device queue of offline packing changes. One op per hiker input,
 * never merged, kept across reloads, replayed in order through POST /api/sync.
 */

import type { CarryMode } from '../domain/types.js';

export type OpType = 'pack' | 'set_quantity' | 'set_mode' | 'unpack';

export interface QueuedOp {
  readonly opId: string;
  readonly listId: string;
  readonly itemId: string;
  readonly type: OpType;
  readonly quantity?: number;
  readonly fromQuantity?: number;
  readonly mode?: CarryMode;
  /** Input order, so the queue replays exactly as the hiker made these. */
  readonly seq: number;
}

const STORE_KEY = 'skinout.queue.v1';

let queue: QueuedOp[] = load();
let seq = queue.reduce((max, op) => Math.max(max, op.seq), 0);

function load(): QueuedOp[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as QueuedOp[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(queue));
  } catch {
    // A full store keeps this session's queue in memory only.
  }
}

export function newOpId(): string {
  seq += 1;
  return `op-${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

export function enqueue(op: Omit<QueuedOp, 'opId' | 'seq'>): QueuedOp {
  const queued: QueuedOp = { ...op, opId: newOpId(), seq };
  queue = [...queue, queued];
  save();
  return queued;
}

export function pending(): readonly QueuedOp[] {
  return queue;
}

export function clear(): void {
  queue = [];
  save();
}

export function opsForSync(): unknown[] {
  return queue.map((op) => {
    const out: Record<string, unknown> = { opId: op.opId, listId: op.listId, itemId: op.itemId, type: op.type };
    if (op.quantity !== undefined) out.quantity = op.quantity;
    if (op.fromQuantity !== undefined) out.fromQuantity = op.fromQuantity;
    if (op.mode !== undefined) out.mode = op.mode;
    return out;
  });
}

/** The last queued set_quantity op on one line, for fromQuantity chaining. */
export function lastQueuedQuantity(listId: string, itemId: string): number | null {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const op = queue[index]!;
    if (op.listId === listId && op.itemId === itemId && op.type === 'set_quantity') {
      return op.quantity ?? null;
    }
  }
  return null;
}
