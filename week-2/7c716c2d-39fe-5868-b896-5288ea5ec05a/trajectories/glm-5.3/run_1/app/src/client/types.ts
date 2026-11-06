export interface Person {
  id: string;
  name: string;
  email: string;
  handle: string | null;
  role: "owner" | "member" | "guest" | null;
}

export interface Holiday {
  date: string;
  name: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  time_zone: string;
  working_weekdays: number[];
  holidays: Holiday[];
  cycle_anchor: string;
  today: string;
  is_working_day: boolean;
  next_digest_at: string | null;
  seats: { limit: number; active: number; pending: number } | null;
}

export interface Attachment {
  id: string;
  filename: string;
  size: number;
  content_type: string;
  parent: { type: "issue" | "message" | "doc"; id: string };
}

export interface Issue {
  key: string;
  project_id: string;
  title: string;
  description: string;
  status: string;
  assignee_id: string | null;
  parent_key: string | null;
  sub_issue_keys: string[];
  cycle_number: number | null;
  due_date: string | null;
  closed_at: string | null;
  attachments: Attachment[];
}

export interface CycleDay {
  date: string;
  counted: boolean;
  reason: string | null;
  clock_change: "forward" | "back" | null;
}

export interface Cycle {
  number: number;
  starts_at: string;
  ends_at: string;
  first_working_date: string;
  last_working_date: string;
  calendar_days: number;
  working_day_count: number;
  days: CycleDay[];
  burndown: { date: string; open: number }[];
  issue_keys: string[];
  is_current: boolean;
  is_finished: boolean;
}

export interface Message {
  id: number;
  channel_id: string;
  author_id: string;
  body: string;
  thread_root_id: number | null;
  reply_count: number;
  mentions: string[];
  created_at: string;
  attachments: Attachment[];
  client_key: string | null;
}

export interface Channel {
  id: string;
  name: string;
  unread: number;
}

export interface Doc {
  id: string;
  project_id: string;
  title: string;
  body: string;
  version: number;
  updated_by: string | null;
  updated_at: string;
  attachments: Attachment[];
}

export interface DocSummary {
  id: string;
  project_id: string;
  title: string;
  version: number;
  updated_by: string | null;
  updated_at: string;
}

export interface Room {
  id: string;
  name: string;
  kind: "open" | "private";
  x: number;
  y: number;
  w: number;
  h: number;
  occupants: { person_id: string; name: string; status: "active" | "away" }[];
}

export interface Knock {
  id: string;
  room_id: string;
  person_id: string;
  status: "waiting" | "let_in" | "not_now" | "expired";
  created_at: string;
  expires_at: string;
}

export interface Invite {
  id: string;
  email: string;
  role: string;
  project_ids: string[];
  channel_ids: string[];
  status: "pending" | "accepted" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
  workspace_name: string;
}

export interface Billing {
  limit: number;
  active: number;
  pending: number;
  price_per_seat: string;
  currency: string;
  monthly_total: string;
  billing_status: "ok" | "unavailable";
  account_external_key: string;
  scheduled_limit: number | null;
  scheduled_on: string | null;
}

export interface ServiceStatus {
  database: "ok" | "unavailable";
  mail: "ok" | "delayed";
  storage: "ok" | "unavailable";
  billing: "ok" | "unavailable";
  held_mail: number | null;
}

export interface UnreadBody {
  channels: Record<string, number>;
  inbox: number;
}

export type StreamEvent = { id?: number; name: string; data: unknown };

export const STATUS_ORDER = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"] as const;

export const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  cancelled: "Cancelled",
};

/** The only legal status moves; the picker offers exactly these. */
export const STATUS_EDGES: Record<string, string[]> = {
  backlog: ["todo", "cancelled"],
  todo: ["backlog", "in_progress", "cancelled"],
  in_progress: ["todo", "in_review", "cancelled"],
  in_review: ["in_progress", "done", "cancelled"],
  done: ["in_progress"],
  cancelled: ["backlog"],
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Dates on screen read like `Sat 24 Oct`. */
export function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function formatInstant(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(iso.slice(0, 10))}, ${h}:${m}`;
}
