// Domain vocabulary and the API resource shapes shared by the server and the browser.
import type { Bounds, Outline, Point } from "./geometry";

export const TRADES = ["electrical", "plumbing", "tile", "paint", "carpentry", "hvac", "flooring"] as const;
export type Trade = (typeof TRADES)[number];

export const TRADE_LABELS: Record<Trade, string> = {
  electrical: "Electrical",
  plumbing: "Plumbing",
  tile: "Tile",
  paint: "Paint",
  carpentry: "Carpentry",
  hvac: "HVAC",
  flooring: "Flooring",
};

export function isTrade(value: unknown): value is Trade {
  return typeof value === "string" && (TRADES as readonly string[]).includes(value);
}

export function tradeLabel(trade: Trade | null): string {
  return trade === null ? "Crew" : TRADE_LABELS[trade];
}

export type Role = "owner" | "lead" | "trade" | "homeowner";

/** The owner and lead carpenter: they edit items, see costs and conflicts and run the walk. */
export function isCrew(role: Role): boolean {
  return role === "owner" || role === "lead";
}
/** A note's author may edit it, undo and redo on it; so may the owner and lead carpenter on any note they see. */
export function mayEditNote(role: Role, isAuthor: boolean): boolean {
  return isCrew(role) || isAuthor;
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  lead: "Lead carpenter",
  trade: "Trade",
  homeowner: "Homeowner",
};

const ITEM_STATUSES = ["open", "in_progress", "ready_for_check", "verified"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export const STATUS_LABELS: Record<ItemStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  ready_for_check: "Ready for check",
  verified: "Verified",
};

export type JobStatus = "active" | "walkthrough" | "closed_out";
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  active: "Active",
  walkthrough: "Walkthrough",
  closed_out: "Closed out",
};

export const ITEM_ACTIONS = ["start", "mark_done", "verify", "send_back", "reopen"] as const;
export type ItemAction = (typeof ITEM_ACTIONS)[number];

export const BULK_ACTIONS = ["start", "mark_done", "verify", "set_trade"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export type NoteAudience = "crew" | "everyone";
export type PhotoKind = "defect" | "completion";
export type PinStatus = "placed" | "unpinned" | "needs_review";

export type Pin = Point;

/** The item fields that can be edited, merged on sync and held in a conflict. */
export const EDITABLE_FIELDS = ["title", "room_id", "trade", "cost_note", "quantity", "unit_cost", "pin"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const FIELD_LABELS: Record<EditableField, string> = {
  title: "Title",
  room_id: "Room",
  trade: "Trade",
  cost_note: "Cost note",
  quantity: "Quantity",
  unit_cost: "Unit cost",
  pin: "Pin",
};

/** Fields only the owner and lead carpenter see or send. */
export const COST_FIELDS = ["cost_note", "quantity", "unit_cost"] as const;

export interface ItemFields {
  title: string;
  room_id: string;
  trade: Trade | null;
  cost_note: string | null;
  quantity: string | null;
  unit_cost: string | null;
  pin: Pin | null;
}

export type FieldValue = ItemFields[EditableField];

export interface Progress {
  verified: number;
  total: number;
  percent: number;
}

export interface RoomCounts {
  verified: number;
  total: number;
}

export interface Person {
  name: string;
  role: Role;
}

export interface LocalVisitTimes {
  starts_at: string;
  ends_at: string;
}

export interface Job {
  id: string;
  name: string;
  address: string;
  time_zone: string;
  status: JobStatus;
  progress: Progress;
  my_role: Role;
  my_trade: Trade | null;
  plan_url: string | null;
  plan_revision: number | null;
  access_codes_available: boolean;
  next_visit: LocalVisitTimes | null;
}

export interface Room {
  id: string;
  name: string;
  outline: Outline;
  bounds: Bounds;
  anchor: Point;
  counts: RoomCounts;
}

export interface Photo {
  id: string;
  kind: PhotoKind;
  content_type: string;
  bytes: number;
  url: string;
  uploaded_by: Person;
  created_at: string;
}

export interface Reply {
  id: string;
  body: string;
  audience: NoteAudience;
  author: Person;
  rev: number;
  created_at: string;
}

export interface Note extends Reply {
  replies: Reply[];
}

export interface NoteHistoryEntry {
  rev: number;
  kind: "create" | "edit" | "undo" | "redo";
  author: Person;
  body: string;
  created_at: string;
}

export interface Conflict {
  field: EditableField;
  server_value: FieldValue;
  server_by: string;
  phone_value: FieldValue;
  phone_by: string;
}

/** An item as one role sees it: costs and conflicts only for the crew, sent_back_reason not for homeowners. */
export interface Item {
  id: string;
  number: number;
  title: string;
  room_id: string;
  trade: Trade | null;
  status: ItemStatus;
  pin: Pin | null;
  pin_status: PinStatus;
  blocked_by: number[];
  cost_note?: string | null;
  quantity?: string | null;
  unit_cost?: string | null;
  line_total?: string;
  sent_back_reason?: string | null;
  conflicts?: Conflict[];
  created_by: Person;
  photos: Photo[];
  notes: Note[];
  updated_at: string;
}

export interface Member {
  id: string;
  name: string;
  role: Role;
  trade: Trade | null;
  email?: string;
  phone?: string | null;
}

export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export interface Recurrence {
  freq: "daily" | "weekly" | "every_n_days";
  weekdays?: Weekday[];
  interval?: number;
  until: string | null;
  count: number | null;
}

export type OccurrenceStatus = "scheduled" | "moved" | "cancelled";

export interface VisitOccurrence {
  date: string;
  starts_at: string;
  ends_at: string;
  starts_at_utc: string;
  ends_at_utc: string;
  status: OccurrenceStatus;
  active: boolean;
}

export interface Visit {
  id: string;
  member_id: string;
  member_name: string;
  starts_at: string;
  ends_at: string;
  starts_at_utc: string;
  ends_at_utc: string;
  recurrence: Recurrence | null;
  occurrences: VisitOccurrence[];
  active: boolean;
}

export interface AccessCard {
  lockbox_code: string;
  alarm_code: string;
  garage_code: string;
  house_note: string;
  visible_until: string | null;
}

export interface Reveal {
  name: string;
  role: Role;
  revealed_at: string;
}

export interface OutboxEntry {
  id: string;
  kind: "assignment" | "summary";
  to: string;
  subject: string;
  status: "queued" | "sent";
  created_at: string;
  sent_at: string | null;
}

export interface PlanRevision {
  revision: number;
  created_at: string;
  uploaded_by: Person;
  moved: number;
  needs_review: number;
}

export interface ChangeOrder {
  id: string;
  description: string;
  amount: string;
  status: "pending" | "approved";
  created_at: string;
  approved_at: string | null;
}

export interface Costs {
  as_of: string;
  by_room: { room_id: string; name: string; subtotal: string }[];
  by_trade: { trade: Trade | null; subtotal: string }[];
  items_subtotal: string;
  change_orders_total: string;
  contingency_percent: string;
  contingency: string;
  total: string;
}

export interface User {
  name: string;
  email: string;
  is_owner: boolean;
}

export type FieldChanges = Partial<{ [F in EditableField]: { from: ItemFields[F]; to: ItemFields[F] } }>;

interface OpBase {
  op_id: string;
  seq: number;
}

export type SyncOp =
  | (OpBase & { type: "create_item"; client_item_id: string; plan_revision?: number; fields: Partial<ItemFields> })
  | (OpBase & { type: "update_item"; item_id: string; plan_revision?: number; changes: FieldChanges })
  | (OpBase & { type: "item_action"; item_id: string; action: ItemAction; reason?: string | null })
  | (OpBase & {
      type: "add_note";
      item_id: string;
      client_note_id: string;
      body: string;
      audience: NoteAudience;
      parent_id?: string | null;
    })
  | (OpBase & { type: "edit_note"; item_id: string; note_id: string; base_rev: number; pos: number; delete: number; insert: string });

export interface ErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

export interface SyncResult {
  op_id: string;
  seq: number;
  outcome: "applied" | "duplicate" | "conflict" | "rejected";
  item: Item | null;
  error: ErrorBody | null;
}

export interface SyncResponse {
  results: SyncResult[];
  synced: number;
  conflicts: number;
}

function samePin(a: Pin | null, b: Pin | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y;
}

/** Field values compare by content: pins by their coordinates, everything else strictly. */
export function sameFieldValue(a: FieldValue | undefined, b: FieldValue | undefined): boolean {
  if (typeof a === "object" && typeof b === "object") return samePin(a ?? null, b ?? null);
  return (a ?? null) === (b ?? null);
}
