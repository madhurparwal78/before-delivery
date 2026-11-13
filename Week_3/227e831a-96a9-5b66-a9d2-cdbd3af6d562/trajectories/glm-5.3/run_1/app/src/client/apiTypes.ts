/** The API types the client reads. Mirrors the server's published shapes. */

export interface WeightInput {
  value: number;
  unit: 'g' | 'oz' | 'lb';
}

export interface Photo {
  id: string;
  status: 'ready';
  url: string;
}

export interface Item {
  id: string;
  name: string;
  category: string;
  weightGrams: number;
  weightDisplay: string;
  unitsOwned: number;
  status: 'active' | 'retired';
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
  category: string;
  quantity: number;
  mode: 'base' | 'worn' | 'consumable';
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
  display: { base: string; worn: string; consumable: string; skinOut: string; goal: string; delta: string };
}

export interface CategoryEntry {
  category: string;
  subtotalGrams: number;
  baseGrams: number;
  subtotalDisplay: string;
  baseDisplay: string;
}

export interface TripList {
  id: string;
  name: string;
  state: 'planning' | 'packed' | 'walked';
  lines: Line[];
  categories: CategoryEntry[];
  totals: Totals;
}

export interface ListSummary {
  id: string;
  name: string;
  state: 'planning' | 'packed' | 'walked';
  totals: Totals;
}

export interface Profile {
  displayName: string;
  unit: 'g' | 'oz' | 'lb';
  goalGrams: number;
  goalDisplay: string;
  timeZone: string;
  paperSize: 'A4' | 'Letter';
}

export interface Share {
  id: string;
  token: string;
  url: string;
  expiresOn: string | null;
  expired: boolean;
  createdAt: string;
}

export interface PackSheet {
  id: string;
  listId: string;
  status: 'ready';
  paperSize: string;
  createdAt: string;
  bytes: number;
  current: boolean;
  url: string;
}

export interface ImportRow {
  row: number;
  name: string;
  category: string;
  outcome: 'matched' | 'created' | 'rejected';
  itemId: string | null;
  sameAsRow: number | null;
  reason: string | null;
}

export interface ImportRun {
  id: string;
  filename: string;
  bytes: number;
  uploadedAt: string;
  status: 'previewed' | 'committed';
  counts: { matched: number; created: number; rejected: number };
  rows: ImportRow[];
}

export interface SyncResult {
  opId: string | null;
  result: 'applied' | 'refused';
  reason: string | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}
