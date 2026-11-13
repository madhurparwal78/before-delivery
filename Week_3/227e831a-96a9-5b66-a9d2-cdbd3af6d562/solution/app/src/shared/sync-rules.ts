import type { CarryMode, ListState, SyncOp, SyncOpType, SyncReason } from './api-types'
import { wholeNumber } from './numbers'

const OP_TYPES: readonly SyncOpType[] = ['pack', 'set_quantity', 'set_mode', 'unpack']
const OP_FIELDS = new Set(['opId', 'listId', 'itemId', 'type', 'quantity', 'fromQuantity', 'mode'])

export function isCarryMode(value: unknown): value is CarryMode {
  return value === 'base' || value === 'worn' || value === 'consumable'
}

type ParsedOp = { valid: true; op: SyncOp } | { valid: false; opId: string | null }

function present(value: unknown): boolean {
  return value !== undefined
}

/** `invalid_op`: a missing, invalid or unknown field. */
export function parseOp(raw: unknown): ParsedOp {
  const record = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const opId = typeof record.opId === 'string' ? record.opId : null
  const invalid: ParsedOp = { valid: false, opId }
  if (Object.keys(record).some((key) => !OP_FIELDS.has(key))) return invalid
  const { listId, itemId, type } = record
  if (opId === null || opId.length < 1 || opId.length > 64) return invalid
  if (typeof listId !== 'string' || typeof itemId !== 'string') return invalid
  if (!OP_TYPES.includes(type as SyncOpType)) return invalid
  const quantity = wholeNumber(record.quantity)
  const fromQuantity = wholeNumber(record.fromQuantity)
  if (present(record.quantity) && (quantity === null || quantity < 1)) return invalid
  if (present(record.fromQuantity) && (fromQuantity === null || fromQuantity < 1)) return invalid
  if (present(record.mode) && !isCarryMode(record.mode)) return invalid
  if (type !== 'set_quantity' && present(record.fromQuantity)) return invalid
  if (type === 'set_quantity' && (quantity === null || fromQuantity === null)) return invalid
  if (type === 'set_mode' && !present(record.mode)) return invalid
  const op: SyncOp = { opId, listId, itemId, type: type as SyncOpType }
  if (quantity !== null) op.quantity = quantity
  if (fromQuantity !== null) op.fromQuantity = fromQuantity
  if (isCarryMode(record.mode)) op.mode = record.mode
  return { valid: true, op }
}

interface OpContext {
  list: { state: ListState } | null
  item: { unitsOwned: number } | null
  line: { quantity: number } | null
}

type LineAction =
  | { kind: 'insert'; quantity: number; mode: CarryMode }
  | { kind: 'update'; quantity?: number; mode?: CarryMode }
  | { kind: 'delete' }

type OpDecision = { result: 'applied'; action: LineAction } | { result: 'refused'; reason: SyncReason }

function refuse(reason: SyncReason): OpDecision {
  return { result: 'refused', reason }
}

/** The refusal order for a well-formed op, against current state. */
export function decideOp(op: SyncOp, context: OpContext): OpDecision {
  const { list, item, line } = context
  if (list === null) return refuse('unknown_list')
  if (item === null) return refuse('unknown_item')
  if (list.state !== 'planning') return refuse('list_not_editable')
  const changesQuantity = op.type === 'pack' || op.type === 'set_quantity'
  if (changesQuantity && item.unitsOwned === 0) return refuse('item_retired')
  if (op.type === 'pack' && line !== null) return refuse('already_packed')
  if (op.type !== 'pack' && line === null) return refuse('not_packed')
  if (op.type === 'set_quantity' && line !== null && op.fromQuantity !== line.quantity) return refuse('line_changed')
  const quantity = op.type === 'pack' ? (op.quantity ?? 1) : op.quantity
  if (changesQuantity && quantity !== undefined && quantity > item.unitsOwned) return refuse('quantity_exceeds_owned')
  if (op.type === 'pack') return { result: 'applied', action: { kind: 'insert', quantity: quantity ?? 1, mode: op.mode ?? 'base' } }
  if (op.type === 'unpack') return { result: 'applied', action: { kind: 'delete' } }
  if (op.type === 'set_mode') return { result: 'applied', action: { kind: 'update', mode: op.mode } }
  return { result: 'applied', action: { kind: 'update', quantity } }
}

interface RefusalNames {
  itemName: string | null
  listName: string | null
  listState: ListState | null
  unitsOwned: number | null
}

/** One sentence for a refused change; `<name>` is the item, else the list, else "that change". */
export function refusalSentence(reason: SyncReason | null, names: RefusalNames): string {
  const name = names.itemName ?? names.listName ?? 'that change'
  if (reason === 'item_retired') return `Not synced: ${name} is no longer in your closet.`
  if (reason === 'quantity_exceeds_owned') return `Not synced: you own only ${names.unitsOwned ?? 0} of ${name}.`
  if (reason === 'list_not_editable') return `Not synced: ${names.listName ?? name} is ${names.listState ?? 'planning'} and can't be edited.`
  if (reason === 'line_changed') return `Not synced: ${name} was changed on another device.`
  return `Not synced: ${name} had already changed.`
}

export function syncSummary(applied: number, total: number, refusals: readonly string[]): string {
  return [`Back online. Synced ${applied} of ${total} changes.`, ...refusals].join(' ')
}

export const SYNC_MIN_OPS = 1
export const SYNC_MAX_OPS = 200
