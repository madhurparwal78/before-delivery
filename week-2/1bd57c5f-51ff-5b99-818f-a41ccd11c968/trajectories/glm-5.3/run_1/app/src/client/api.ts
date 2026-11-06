/** The API client, the offline queue and the live event stream. */

export type Pt = { x: number; y: number };
export type TradeKey = "electrical" | "plumbing" | "tile" | "paint" | "carpentry" | "hvac" | "flooring";
export type ItemStatus = "open" | "in_progress" | "ready_for_check" | "verified";
export type PinStatus = "placed" | "unpinned" | "needs_review";
export type JobStatus = "active" | "walkthrough" | "closed_out";
export type Role = "owner" | "lead" | "trade" | "homeowner";

export const TRADE_LABELS: Record<TradeKey, string> = {
  electrical: "Electrical", plumbing: "Plumbing", tile: "Tile", paint: "Paint",
  carpentry: "Carpentry", hvac: "HVAC", flooring: "Flooring",
};

export type User = { name: string; email: string; is_owner: boolean };

export type Job = {
  id: string;
  name: string;
  address: string;
  time_zone: string;
  status: JobStatus;
  progress: { verified: number; total: number; percent: number };
  my_role: Role;
  my_trade: TradeKey | null;
  plan_url: string | null;
  plan_revision: number | null;
  access_codes_available: boolean;
  next_visit: { starts_at: string; ends_at: string } | null;
};

export type Room = {
  id: string;
  name: string;
  outline: Pt[];
  bounds: { x: number; y: number; w: number; h: number };
  anchor: Pt;
  counts: { verified: number; total: number };
};

export type Photo = {
  id: string;
  kind: "defect" | "completion";
  content_type: string;
  bytes: number;
  url: string;
  uploaded_by: { name: string; role: Role };
  created_at: string;
};

export type Note = {
  id: string;
  body: string;
  audience: "crew" | "everyone";
  author: { name: string; role: Role };
  rev: number;
  created_at: string;
  replies?: Note[];
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
  trade: TradeKey | null;
  status: ItemStatus;
  pin: Pt | null;
  pin_status: PinStatus;
  blocked_by: number[];
  photos: Photo[];
  notes: Note[];
  created_by: { name: string; role: Role };
  updated_at: string;
  cost_note?: string;
  quantity?: string;
  unit_cost?: string;
  line_total?: string;
  sent_back_reason?: string | null;
  conflicts?: Conflict[];
};

export type Member = {
  id: string;
  name: string;
  role: Role;
  trade: TradeKey | null;
  email?: string;
  phone?: string | null;
};

export type Occurrence = {
  date: string;
  starts_at: string;
  ends_at: string;
  starts_at_utc: string;
  ends_at_utc: string;
  status: "scheduled" | "moved" | "cancelled";
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
  recurrence: { freq: "daily" | "weekly" | "every_n_days"; weekdays?: string[]; interval?: number; until?: string; count?: number } | null;
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

export type ChangeOrder = {
  id: string;
  description: string;
  amount: string;
  status: "pending" | "approved";
  created_at: string;
  approved_at: string | null;
};

export type Costs = {
  as_of: string;
  by_room: { room_id: string; name: string; subtotal: string }[];
  by_trade: { trade: TradeKey | null; subtotal: string }[];
  items_subtotal: string;
  change_orders_total: string;
  contingency_percent: string;
  contingency: string;
  total: string;
};

export type OutboxEntry = {
  id: string;
  kind: "assignment" | "summary";
  to: string;
  subject: string;
  status: "queued" | "sent";
  created_at: string;
  sent_at: string | null;
};

export type PlanRevision = {
  revision: number;
  created_at: string;
  uploaded_by: { name: string; role: Role };
  moved: number;
  needs_review: number;
};

export type ApiErrorBody = { error: string; message: string; fields?: Record<string, string> } & Record<string, unknown>;

export type JobData = {
  job: Job;
  rooms: Room[];
  items: Item[];
  members: Member[];
  visits: Visit[];
  costs: Costs | null;
  changeOrders: ChangeOrder[];
  outbox: OutboxEntry[];
  planRevisions: PlanRevision[];
  access: AccessCard | null;
};

export class ApiFailure extends Error {
  status: number;
  body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(method: string, path: string, body?: unknown, opts?: { multipart?: FormData }): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (opts?.multipart !== undefined) {
    init.body = opts.multipart;
  } else if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiFailure(0, { error: "offline", message: "You're offline." });
  }
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get("Content-Type") ?? "";
  const data: unknown = contentType.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    throw new ApiFailure(res.status, data as ApiErrorBody);
  }
  return data as T;
}

// --- The offline queue ---

export type QueuedOp =
  | { op_id: string; seq: number; type: "create_item"; client_item_id: string; plan_revision?: number; fields: Record<string, unknown>; status: "pending" | "synced" }
  | { op_id: string; seq: number; type: "update_item"; item_id: string; plan_revision?: number; changes: Record<string, { from: unknown; to: unknown }>; status: "pending" | "synced" }
  | { op_id: string; seq: number; type: "item_action"; item_id: string; action: string; reason?: string; status: "pending" | "synced" }
  | { op_id: string; seq: number; type: "add_note"; item_id: string; client_note_id?: string; body: string; audience: string; parent_id?: string; status: "pending" | "synced" }
  | { op_id: string; seq: number; type: "edit_note"; item_id: string; note_id: string; base_rev: number; pos: number; delete: number; insert: string; status: "pending" | "synced" };

const QUEUE_KEY = "snaglight_queue_v1";
const CACHE_KEY = "snaglight_jobcache_v1";

type QueueFile = { jobId: string; ops: QueuedOp[] };

function readQueueFile(): QueueFile | null {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw === null ? null : JSON.parse(raw) as QueueFile;
  } catch {
    return null;
  }
}

function writeQueueFile(file: QueueFile | null): void {
  if (file === null || file.ops.length === 0) localStorage.removeItem(QUEUE_KEY);
  else localStorage.setItem(QUEUE_KEY, JSON.stringify(file));
}

export function queueFor(jobId: string): QueuedOp[] {
  const file = readQueueFile();
  return file !== null && file.jobId === jobId ? file.ops : [];
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
export type OpSpec = DistributiveOmit<QueuedOp, "seq" | "status">;

export function enqueue(jobId: string, op: OpSpec): QueuedOp {
  const file = readQueueFile();
  const ops = file !== null && file.jobId === jobId ? file.ops : [];
  const seq = (ops.length > 0 ? ops[ops.length - 1].seq : 0) + 1;
  const queued = { ...op, seq, status: "pending" } as QueuedOp;
  ops.push(queued);
  writeQueueFile({ jobId, ops });
  return queued;
}

export function newOpId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newClientId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type SyncReport = {
  results: { op_id: string; seq: number; outcome: "applied" | "duplicate" | "conflict" | "rejected"; item: Item | null; error: ApiErrorBody | null }[];
  synced: number;
  conflicts: number;
};

export async function syncQueue(jobId: string): Promise<SyncReport> {
  const ops = queueFor(jobId).filter((op) => op.status === "pending");
  if (ops.length === 0) return { results: [], synced: 0, conflicts: 0 };
  const wire = ops.map(({ status: _status, ...rest }) => rest);
  const report = await api<SyncReport>("POST", `/api/jobs/${jobId}/sync`, { ops: wire });
  const done = new Set(report.results.filter((r) => r.outcome !== "rejected").map((r) => r.op_id));
  const removedIds = new Set(
    report.results
      .filter((r) => r.outcome === "rejected" && (r.error?.error === "not_found"))
      .map((r) => r.op_id),
  );
  const kept = readQueueFile();
  const remaining = (kept !== null && kept.jobId === jobId ? kept.ops : []).filter((op) => !done.has(op.op_id) && !removedIds.has(op.op_id));
  writeQueueFile(remaining.length === 0 ? null : { jobId, ops: remaining });
  return report;
}

export function clearQueue(jobId: string): void {
  const file = readQueueFile();
  if (file !== null && file.jobId === jobId) writeQueueFile(null);
}

// --- The cached job, for offline reloads ---

export function cacheJob(jobId: string, data: unknown): void {
  try {
    localStorage.setItem(`${CACHE_KEY}${jobId}`, JSON.stringify(data));
  } catch {
    // Storage full: the cache is best-effort.
  }
}

export function readCachedJob<T>(jobId: string): T | null {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY}${jobId}`);
    return raw === null ? null : JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function hasQueuedChanges(jobId: string): boolean {
  return queueFor(jobId).some((op) => op.status === "pending");
}
