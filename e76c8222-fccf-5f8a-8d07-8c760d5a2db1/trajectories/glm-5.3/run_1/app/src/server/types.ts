export type Role = 'coordinator' | 'interpreter' | 'requester' | 'consumer' | 'billing';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  org_id: string | null;
}

export const SETTING_NAMES = ['medical', 'legal', 'education', 'community'] as const;
export type Setting = (typeof SETTING_NAMES)[number];

export const CREDENTIAL_TYPES = ['NIC', 'CDI', 'SC:L', 'EIPA-4.0'] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export const SETTING_CREDENTIALS: Record<Setting, readonly CredentialType[]> = {
  medical: ['NIC', 'CDI'],
  legal: ['SC:L'],
  education: ['EIPA-4.0', 'NIC'],
  community: ['NIC', 'CDI'],
};

export type RequestStatus =
  | 'draft' | 'submitted' | 'partially_staffed' | 'staffed'
  | 'completed' | 'invoiced' | 'cancelled_on_time' | 'cancelled_late';

export type SeatStatus = 'open' | 'offered' | 'accepted';
export type OfferStatus = 'active' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
export type TimesheetStatus = 'submitted' | 'approved';

export interface GateResult {
  gate: 'credential' | 'validity' | 'schedule' | 'consumer';
  label: 'Credential' | 'Valid on date' | 'Schedule' | 'Consumer';
  pass: boolean;
  reason: string | null;
}

export interface Quote {
  late: boolean;
  window_hours: 48 | 72;
  hours_before_start: string;
  seated: number;
  charge_hours_per_interpreter: string;
  hourly_rate: string;
  fee_per_interpreter: string;
  fee: string;
}

export interface CredentialView {
  id: string;
  type: CredentialType;
  expires_on: string;
  expired: boolean;
}

export interface InterpreterBoardView {
  id: string;
  name: string;
  credentials: CredentialView[];
}

export interface SeatView {
  id: string;
  position: number;
  status: SeatStatus;
  interpreter: { id: string; name: string } | null;
  held_by: { id: string; name: string } | null;
  offer: {
    id: string;
    status: OfferStatus;
    sent_at: string;
    expires_at: string;
    email: 'sent' | 'queued';
  } | null;
  timesheet: {
    id: string;
    status: TimesheetStatus;
    billed_hours: string;
    amount: string | null;
  } | null;
}

export interface PrepFileView {
  id: string;
  filename: string;
  size: number;
  content_type: string;
}

export interface RequestView {
  id: string;
  ref: string;
  org_id: string;
  org_name: string;
  title: string;
  setting: Setting;
  location: string;
  start: string;
  end: string;
  duration_hours: string;
  consumer: { id: string; name: string };
  notes: string;
  status: RequestStatus;
  logged_after: boolean;
  seats_total: number;
  seats_claimed: number;
  seats_accepted: number;
  in_cancellation_window: boolean;
  cancellation_fee: string | null;
  seats: SeatView[];
  prep_files: PrepFileView[];
}

export interface MyOfferView {
  id: string;
  token: string;
  status: 'active';
  sent_at: string;
  expires_at: string;
  request: {
    id: string;
    ref: string;
    title: string;
    setting: Setting;
    location: string;
    start: string;
    end: string;
    org_name: string;
  };
  seat: { position: number; total: number };
}

export interface TimesheetQueueRow {
  id: string;
  ref: string;
  request_id: string;
  org_id: string;
  interpreter: { id: string; name: string };
  actual_start: string;
  actual_end: string;
  billed_hours: string;
  status: TimesheetStatus;
}

export interface AuditEntryView {
  at: string;
  actor: { id: string; name: string; role: Role } | null;
  action: string;
  entity: string;
  entity_id: string;
  from: string | null;
  to: string | null;
  detail: Record<string, unknown> | null;
}
