// JSON calls to the app's own API. Every error answer becomes an ApiFailure carrying the
// published code; a 503 also asks the page to re-read the service status.
import type { IssueStatus } from "../shared/status-edges";

export interface Person {
  id: string;
  name: string;
  email: string;
  handle: string;
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
  next_digest_at: string;
  seats: { limit: number; active: number; pending: number } | null;
}

export interface Me {
  person: Person;
  workspace: Workspace | null;
}

export interface Attachment {
  id: string;
  filename: string;
  size: number;
  content_type: string;
}

export interface Issue {
  key: string;
  project_id: string;
  title: string;
  description: string;
  status: IssueStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  parent_key: string | null;
  sub_issue_keys: string[];
  cycle_number: number | null;
  due_date: string | null;
  closed_at: string | null;
  updated_at: string;
  attachments: Attachment[];
  due_date_snapped?: boolean;
}

export interface Day {
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
  days: Day[];
  burndown: { date: string; open: number }[];
  issue_keys: string[];
  is_current: boolean;
  is_finished: boolean;
}

export interface Project {
  id: string;
  key: string;
  name: string;
}

export interface Channel {
  id: string;
  name: string;
  unread: number;
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

export interface Doc {
  id: string;
  project_id: string;
  title: string;
  body?: string;
  version: number;
  updated_by: string;
  updated_at: string;
  attachments: Attachment[];
}

export interface DocVersion {
  version: number;
  saved_at: string;
  saved_by: string;
  title: string;
  body: string;
}

interface Occupant {
  person_id: string;
  name: string;
  status: "active" | "away";
}

export interface Room {
  id: string;
  name: string;
  kind: "open" | "private";
  x: number;
  y: number;
  w: number;
  h: number;
  occupants: Occupant[];
}

export interface Floor {
  rooms: Room[];
  me: { room_id: string | null; status: string };
}

export type KnockState = "waiting" | "let_in" | "not_now" | "expired";

export interface Knock {
  id: string;
  room_id: string;
  person_id: string;
  status: KnockState;
  created_at: string;
  expires_at: string;
}

export interface Invite {
  id: string;
  email: string;
  role: "member" | "guest";
  project_ids: string[];
  channel_ids: string[];
  status: "pending" | "accepted" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
  workspace_name: string;
  owner_name: string;
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

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields: Record<string, string>,
    readonly payload: Record<string, unknown>,
  ) {
    super(code);
  }

  /** A network error or any 5xx: the request may or may not have landed. */
  get unreachable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

let onServiceTrouble: () => void = () => undefined;
let onSignedOut: () => void = () => undefined;

export function watchApi(handlers: { serviceTrouble: () => void; signedOut: () => void }): void {
  onServiceTrouble = handlers.serviceTrouble;
  onSignedOut = handlers.signedOut;
}

let generation = 0;

/** The person on this tab changed: answers to requests made before now are discarded. */
export function nextPerson(): void {
  generation++;
}

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const startedUnder = generation;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    onServiceTrouble();
    throw new ApiFailure(0, "network", {}, {});
  }
  const text = await response.text();
  if (startedUnder !== generation) throw new ApiFailure(0, "discarded", {}, {});
  const payload = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  if (response.ok) return payload as T;
  const error = (payload.error ?? {}) as { code?: string; fields?: Record<string, string> };
  if (response.status >= 500) onServiceTrouble();
  if (response.status === 401 && error.code === "unauthenticated" && path !== "/api/me") onSignedOut();
  throw new ApiFailure(response.status, error.code ?? "unknown", error.fields ?? {}, payload);
}

export const get = <T>(path: string): Promise<T> => api<T>("GET", path);
