import type { Category } from './categories.js';
import type { DisplayUnit } from './weights.js';

export type CarryMode = 'base' | 'worn' | 'consumable';
export type ListState = 'planning' | 'packed' | 'walked';
export type ItemStatus = 'active' | 'retired';
export type PaperSize = 'A4' | 'Letter';

export interface Profile {
  displayName: string;
  unit: DisplayUnit;
  goalGrams: number;
  goalDisplay: string;
  timeZone: string;
  paperSize: PaperSize;
}

export interface Photo {
  id: string;
  status: 'ready';
  url: string;
}

export interface Item {
  id: string;
  name: string;
  category: Category;
  weightGrams: number;
  weightDisplay: string;
  unitsOwned: number;
  status: ItemStatus;
  priceCents: number | null;
  notes: string;
  photo: Photo | null;
  packedInLists: number;
  version: number;
}

export interface Line {
  id: string;
  itemId: string;
  name: string;
  category: Category;
  quantity: number;
  mode: CarryMode;
  unitWeightGrams: number;
  lineWeightGrams: number;
  baseGrams: number;
  wornGrams: number;
  consumableGrams: number;
  carryNote: string;
  weightDisplay: string;
  inCloset: boolean;
}

export interface Totals {
  baseGrams: number;
  wornGrams: number;
  consumableGrams: number;
  skinOutGrams: number;
  goalGrams: number;
  deltaGrams: number;
  display: {
    base: string;
    worn: string;
    consumable: string;
    skinOut: string;
    goal: string;
    delta: string;
  };
}

export interface CategoryEntry {
  category: Category;
  subtotalGrams: number;
  baseGrams: number;
  subtotalDisplay: string;
  baseDisplay: string;
}

export interface TripList {
  id: string;
  name: string;
  state: ListState;
  lines: Line[];
  categories: CategoryEntry[];
  totals: Totals;
}

export interface ListSummary {
  id: string;
  name: string;
  state: ListState;
  totals: Totals;
}

export interface Share {
  id: string;
  token: string;
  url: string;
  expiresOn: string | null;
  expired: boolean;
  createdAt: string;
}

export interface SharedList {
  listName: string;
  state: ListState;
  hikerName: string;
  lines: Array<Omit<Line, 'id' | 'itemId' | 'inCloset'>>;
  categories: CategoryEntry[];
  totals: Totals;
}

export interface PackSheet {
  id: string;
  listId: string;
  status: 'ready';
  paperSize: PaperSize;
  createdAt: string;
  bytes: number;
  current: boolean;
  url: string;
}

export type ImportRowOutcome = 'matched' | 'created' | 'rejected';
export type ImportRowReason =
  | 'missing_name'
  | 'unknown_category'
  | 'invalid_weight'
  | 'unknown_unit'
  | 'invalid_qty';

export interface ImportRow {
  row: number;
  name: string;
  category: string;
  outcome: ImportRowOutcome;
  itemId: string | null;
  sameAsRow: number | null;
  reason: ImportRowReason | null;
}

export interface ImportRun {
  id: string;
  filename: string;
  bytes: number;
  uploadedAt: string;
  status: 'previewed' | 'committed';
  counts: { matched: number; created: number; rejected: number };
  rows?: ImportRow[];
}

export type SyncOpType = 'pack' | 'set_quantity' | 'set_mode' | 'unpack';

export interface SyncOp {
  opId: string;
  listId: string;
  itemId: string;
  type: SyncOpType;
  quantity?: number;
  fromQuantity?: number;
  mode?: CarryMode;
}

export type SyncRefusal =
  | 'unknown_list'
  | 'unknown_item'
  | 'list_not_editable'
  | 'item_retired'
  | 'quantity_exceeds_owned'
  | 'already_packed'
  | 'not_packed'
  | 'line_changed'
  | 'invalid_op'
  | 'op_id_reused';

export interface SyncResult {
  opId: string | null;
  result: 'applied' | 'refused';
  reason: SyncRefusal | null;
}

export interface SyncResponse {
  results: SyncResult[];
  lists: ListSummary[];
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}
