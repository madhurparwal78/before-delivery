/** Shapes that cross the wire between the server and the browser. */

export const STATUSES = ["not_started", "prepared", "client_approved", "filed", "packeted", "amended"] as const;
export type Status = (typeof STATUSES)[number];
export type Carry = "next_business" | "fixed";
export type Frequency = "monthly" | "quarterly" | "yearly";
export type Role = "bookkeeper" | "owner";
export type Tone = "orange" | "sage" | "yellow" | "black";

/** What a user can do to a return from its current status (the server decides; the browser only reads). */
export type ReturnAction = "prepare" | "save_amounts" | "approve" | "send_back" | "file" | "extend" | "amend";

export const STATUS_LABELS: Record<Status, string> = {
  not_started: "Not started",
  prepared: "Prepared",
  client_approved: "Client approved",
  filed: "Filed",
  packeted: "Packeted",
  amended: "Amended",
};

export interface User {
  id: string;
  display_name: string;
  email: string;
  role: Role;
  client_id: string | null;
}

export interface Me {
  user: User;
  /** The owner's business name; null for the bookkeeper. */
  client_name: string | null;
  practice_id: string;
  now: string;
  practice_zone: string;
  reminder_hour: number;
}

export interface Edition {
  effective_date: string;
  due_day: number;
  carry: Carry;
  rate: string;
  extension_days: number;
}

export interface StateInfo {
  code: string;
  name: string;
  zone: string;
  zone_label: string;
  holidays: string[];
  editions: Edition[];
}

export interface Registration {
  id: string;
  state: string;
  frequency: Frequency;
  first_period: string;
}

export interface Client {
  id: string;
  name: string;
  owner: { id: string; display_name: string; email: string };
  registrations: Registration[];
}

export interface Reminder {
  lead_days: 7 | 1;
  scheduled_for: string;
  /** `Thursday March 5, 9:00 am Central` */
  when: string;
  sent_at: string | null;
  status: "pending" | "sent";
}

export interface Approval {
  action: "approved" | "sent_back";
  by: string;
  at: string;
  when: string;
  reason: string | null;
}

export interface Extension {
  granted_at: string;
  extension_days: number;
  due_date_before: string;
  due_at_before: string;
}

interface AmountPair {
  gross_sales: string;
  tax_due: string;
}

export interface Amendment {
  at: string;
  when: string;
  by: string;
  note: string | null;
  original: AmountPair;
  amended: AmountPair;
}

export interface ReturnView {
  id: string;
  client: { id: string; name: string };
  registration_id: string;
  state: string;
  state_name: string;
  zone: string;
  zone_label: string;
  frequency: Frequency;
  period: string;
  period_label: string;
  status: Status;
  status_label: string;
  overdue: boolean;
  awaiting_approval: boolean;
  version: number;
  gross_sales: string | null;
  tax_due: string | null;
  nominal_due_date: string;
  due_date: string;
  carried_from: string | null;
  due_at: string;
  due_line: string;
  local_deadline_label: string;
  practice_deadline_label: string;
  offset_hours: number;
  edition: Edition;
  approvals: Approval[];
  extension: Extension | null;
  amendments: Amendment[];
  filed_at: string | null;
  packet: "none" | "pending" | "ready";
  packet_revisions: number;
  changed_by: string;
  /** The practice clock is at or after the deadline: a band strip's past mark. */
  past: boolean;
  /** Tile colour of the return's state within its practice. */
  tone: Tone;
  /** The actions the status move table allows now. */
  allowed: ReturnAction[];
}

export interface ReturnCounts {
  total: number;
  overdue: number;
  awaiting_approval: number;
}

export interface ReturnList {
  returns: ReturnView[];
  counts: ReturnCounts;
}

export interface ConflictBody {
  error: "conflict";
  return: { version: number; status: Status };
  changed_by: string;
}

export type FieldErrors = Record<string, string>;

/** The practice clock as the server reads it, pushed to every open screen. */
export interface ClockView {
  now: string;
  /** Central date on the practice clock. */
  today: string;
  /** Minutes since Central midnight on the practice clock. */
  minute: number;
  week_start: string;
  week_end: string;
}

export interface ServiceView {
  mail: boolean;
  pdf: boolean;
}

export type ReturnChange =
  | "prepared" | "amounts" | "approved" | "sent_back" | "filed" | "extended" | "amended" | "packet"
  | "overdue" | "recalculated" | "clock";

/** Messages on `GET /api/events`; the browser reacts to these and nothing else. */
export type LiveEvent =
  | { type: "clock"; clock: ClockView }
  | { type: "services"; services: ServiceView }
  | { type: "return"; change: ReturnChange; by: string; return: ReturnView }
  | { type: "reminder"; return_id: string; client: string; state: string; period_label: string; cause: string | null }
  | { type: "lists" }
  | { type: "clients" }
  | { type: "states" }
  | { type: "practice"; reminder_hour: number };
