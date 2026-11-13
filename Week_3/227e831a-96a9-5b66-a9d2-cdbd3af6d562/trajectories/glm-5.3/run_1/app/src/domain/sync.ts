import type { CarryMode, Category, ListState } from './types.js';

/**
 * Sync refusal order and the share-link time rule, each decided in one place.
 */

export type SyncRefusal =
  | 'op_id_reused'
  | 'invalid_op'
  | 'unknown_list'
  | 'unknown_item'
  | 'list_not_editable'
  | 'item_retired'
  | 'already_packed'
  | 'not_packed'
  | 'line_changed'
  | 'quantity_exceeds_owned';

export type SyncOpType = 'pack' | 'set_quantity' | 'set_mode' | 'unpack';

export interface SyncOp {
  readonly opId: string;
  readonly listId: string;
  readonly itemId: string;
  readonly type: SyncOpType;
  readonly quantity?: number;
  readonly fromQuantity?: number;
  readonly mode?: CarryMode;
}

/** Op shape: the only fields an op may carry, by type. */
const OP_FIELDS: Readonly<Record<SyncOpType, readonly string[]>> = {
  pack: ['opId', 'listId', 'itemId', 'type', 'quantity', 'mode'],
  set_quantity: ['opId', 'listId', 'itemId', 'type', 'quantity', 'fromQuantity'],
  set_mode: ['opId', 'listId', 'itemId', 'type', 'mode'],
  unpack: ['opId', 'listId', 'itemId', 'type'],
};

/**
 * Checks an op against the Op shape. Returns a reason when the op is invalid,
 * or null when it is well formed. This is the one `invalid_op` decision.
 */
export function invalidOpReason(op: unknown): SyncRefusal | null {
  if (typeof op !== 'object' || op === null) return 'invalid_op';
  const record = op as Record<string, unknown>;
  const type = record['type'];
  if (typeof type !== 'string') return 'invalid_op';
  const allowed = OP_FIELDS[type as SyncOpType];
  if (allowed === undefined) return 'invalid_op';
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) return 'invalid_op';
  }
  const opId = record['opId'];
  if (typeof opId !== 'string' || opId.length < 1 || opId.length > 64) return 'invalid_op';
  if (typeof record['listId'] !== 'string' || typeof record['itemId'] !== 'string') return 'invalid_op';
  switch (type) {
    case 'pack': {
      if ('quantity' in record && record['quantity'] !== undefined) {
        if (typeof record['quantity'] !== 'number' || !Number.isInteger(record['quantity']) || record['quantity'] < 1) return 'invalid_op';
      }
      if ('mode' in record && record['mode'] !== undefined) {
        if (record['mode'] !== 'base' && record['mode'] !== 'worn' && record['mode'] !== 'consumable') return 'invalid_op';
      }
      return null;
    }
    case 'set_quantity': {
      if (typeof record['quantity'] !== 'number' || !Number.isInteger(record['quantity']) || record['quantity'] < 1) return 'invalid_op';
      if (typeof record['fromQuantity'] !== 'number' || !Number.isInteger(record['fromQuantity']) || record['fromQuantity'] < 1) return 'invalid_op';
      return null;
    }
    case 'set_mode': {
      if (record['mode'] !== 'base' && record['mode'] !== 'worn' && record['mode'] !== 'consumable') return 'invalid_op';
      return null;
    }
    case 'unpack':
      return null;
    default:
      return 'invalid_op';
  }
}

/** An op is identical to a remembered one when every field it may carry is equal. */
export function sameOp(a: SyncOp, b: SyncOp): boolean {
  if (a.opId !== b.opId || a.listId !== b.listId || a.itemId !== b.itemId || a.type !== b.type) return false;
  if (a.quantity !== b.quantity) return false;
  if (a.fromQuantity !== b.fromQuantity) return false;
  if (a.mode !== b.mode) return false;
  return true;
}
