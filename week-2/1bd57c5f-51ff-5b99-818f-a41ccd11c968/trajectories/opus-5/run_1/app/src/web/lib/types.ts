import type { ItemStatus, JobRole, JobStatus, PinStatus, Trade } from '../../shared/domain.js';

export type Point = { x: number; y: number };

export type Job = {
  id: string;
  name: string;
  address: string;
  time_zone: string;
  status: JobStatus;
  progress: { verified: number; total: number; percent: number };
  my_role: JobRole;
  my_trade: Trade | null;
  plan_url: string | null;
  plan_revision: number | null;
  access_codes_available: boolean;
  next_visit: { starts_at: string; ends_at: string } | null;
};

export type Room = {
  id: string;
  name: string;
  outline: Point[];
  bounds: { x: number; y: number; w: number; h: number };
  anchor: Point;
  counts: { verified: number; total: number };
};

export type Note = {
  id: string;
  body: string;
  audience: 'crew' | 'everyone';
  author: { name: string; role: JobRole };
  rev: number;
  created_at: string;
  replies?: Note[];
};

export type Photo = {
  id: string;
  kind: 'defect' | 'completion';
  content_type: string;
  bytes: number;
  url: string;
  uploaded_by: { name: string; role: JobRole };
  created_at: string;
};

export type Conflict = {
  field: string;
  server_value: unknown;
  server_by: string;
  phone_value: unknown;
  phone_by: string;
};

export type Item = {
  id: string;
  number: number;
  title: string;
  room_id: string;
  trade: Trade | null;
  status: ItemStatus;
  pin: Point | null;
  pin_status: PinStatus;
  blocked_by: number[];
  created_by: { name: string; role: JobRole };
  photos: Photo[];
  notes: Note[];
  updated_at: string;
  cost_note?: string | null;
  quantity?: string | null;
  unit_cost?: string | null;
  line_total?: string;
  sent_back_reason?: string | null;
  conflicts?: Conflict[];
};

/** A row the device holds but the server has not numbered yet. */
export type LocalItem = Item & {
  local?: boolean;
  clientItemId?: string;
  pendingKeys?: string[];
  notSaved?: string | null;
};

export type Member = {
  id: string;
  name: string;
  role: JobRole;
  trade: Trade | null;
  email?: string;
  phone?: string | null;
};

export type Occurrence = {
  date: string;
  starts_at: string;
  ends_at: string;
  starts_at_utc: string;
  ends_at_utc: string;
  status: 'scheduled' | 'moved' | 'cancelled';
  active: boolean;
};

export type Visit = {
  id: string;
  member_id: string;
  member_name: string;
  starts_at: string;
  ends_at: string;
  starts_at_utc: string;
  ends_at_utc: string;
  recurrence: unknown;
  occurrences: Occurrence[];
  active: boolean;
};

export type AccessCard = {
  lockbox_code: string;
  alarm_code: string;
  garage_code: string;
  house_note: string;
  visible_until: string | null;
};

export type Reveal = { name: string; role: JobRole; revealed_at: string };

export type Costs = {
  as_of: string;
  by_room: { room_id: string; name: string; subtotal: string }[];
  by_trade: { trade: Trade | null; subtotal: string }[];
  items_subtotal: string;
  change_orders_total: string;
  contingency_percent: string;
  contingency: string;
  total: string;
};

export type ChangeOrder = {
  id: string;
  description: string;
  amount: string;
  status: 'pending' | 'approved';
  created_at: string;
  approved_at: string | null;
};

export type OutboxEntry = {
  id: string;
  kind: 'assignment' | 'summary';
  to: string;
  subject: string;
  status: 'queued' | 'sent';
  created_at: string;
  sent_at: string | null;
};

export type PlanRevision = {
  revision: number;
  created_at: string;
  uploaded_by: { name: string; role: JobRole };
  moved: number;
  needs_review: number;
};

export type SyncResult = {
  op_id: string;
  seq: number;
  outcome: 'applied' | 'duplicate' | 'conflict' | 'rejected';
  item: Item | null;
  error: { error: string; message: string; fields?: Record<string, string> } | null;
};
