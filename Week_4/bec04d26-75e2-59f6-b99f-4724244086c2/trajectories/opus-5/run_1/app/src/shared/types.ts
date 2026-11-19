export type Role = 'bookkeeper' | 'owner';

export type Frequency = 'monthly' | 'quarterly' | 'yearly';

export type Carry = 'next_business' | 'fixed';

export type ReturnStatus =
  | 'not_started'
  | 'prepared'
  | 'client_approved'
  | 'filed'
  | 'packeted'
  | 'amended';

export type PacketState = 'none' | 'pending' | 'ready';

export type ApprovalAction = 'approved' | 'sent_back';

export interface User {
  id: string;
  display_name: string;
  email: string;
  role: Role;
  client_id: string | null;
}

export interface Edition {
  effective_date: string;
  due_day: number;
  carry: Carry;
  rate: string;
  extension_days: number;
}

export interface StateRecord {
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

export interface ClientRecord {
  id: string;
  name: string;
  owner: { id: string; display_name: string; email: string };
  registrations: Registration[];
}

export interface Reminder {
  lead_days: 7 | 1;
  scheduled_for: string;
  sent_at: string | null;
  status: 'pending' | 'sent';
}

export interface Approval {
  action: ApprovalAction;
  by: string;
  at: string;
  reason: string | null;
}

export interface ExtensionRecord {
  granted_at: string;
  extension_days: number;
  due_date_before: string;
  due_at_before: string;
}

export interface Amendment {
  at: string;
  by: string;
  note: string | null;
  original: { gross_sales: string; tax_due: string };
  amended: { gross_sales: string; tax_due: string };
}

export interface ReturnRecord {
  id: string;
  client: { id: string; name: string };
  registration_id: string;
  state: string;
  state_name: string;
  /** The state's position in the practice's states sorted by code. */
  state_index: number;
  zone: string;
  zone_label: string;
  frequency: Frequency;
  period: string;
  period_label: string;
  status: ReturnStatus;
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
  extension: ExtensionRecord | null;
  amendments: Amendment[];
  filed_at: string | null;
  packet: PacketState;
  packet_revisions: number;
  changed_by: string;
}

export interface ReturnCounts {
  total: number;
  overdue: number;
  awaiting_approval: number;
}

export interface ReturnsResponse {
  returns: ReturnRecord[];
  counts: ReturnCounts;
}

export interface MeResponse {
  user: User;
  practice_id: string;
  now: string;
  practice_zone: 'America/Chicago';
  reminder_hour: number;
}

export const STATUS_LABELS: Record<ReturnStatus, string> = {
  not_started: 'Not started',
  prepared: 'Prepared',
  client_approved: 'Client approved',
  filed: 'Filed',
  packeted: 'Packeted',
  amended: 'Amended',
};

export const STATUS_ORDER: ReturnStatus[] = [
  'not_started',
  'prepared',
  'client_approved',
  'filed',
  'packeted',
  'amended',
];

export const PRACTICE_ZONE = 'America/Chicago';
