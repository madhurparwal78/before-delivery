export type Role = 'coordinator' | 'interpreter' | 'requester' | 'consumer' | 'billing';

export type Setting = 'medical' | 'legal' | 'education' | 'community';

export type RequestStatus =
  | 'draft'
  | 'submitted'
  | 'partially_staffed'
  | 'staffed'
  | 'completed'
  | 'invoiced'
  | 'cancelled_on_time'
  | 'cancelled_late';

export type SeatStatus = 'open' | 'offered' | 'accepted';

export type OfferStatus = 'active' | 'accepted' | 'declined' | 'expired' | 'withdrawn';

export type TimesheetStatus = 'submitted' | 'approved';

export type CredentialType = 'NIC' | 'CDI' | 'SC:L' | 'EIPA-4.0';

export type CredentialStatus = 'valid' | 'expiring' | 'expired';

export type GateName = 'credential' | 'validity' | 'schedule' | 'consumer';

export const SETTINGS: readonly Setting[] = ['medical', 'legal', 'education', 'community'];

export const CREDENTIAL_TYPES: readonly CredentialType[] = ['NIC', 'CDI', 'SC:L', 'EIPA-4.0'];

/** Credential types accepted for each setting (dispatch gate 1). */
export const SETTING_CREDENTIALS: Record<Setting, readonly CredentialType[]> = {
  medical: ['NIC', 'CDI'],
  legal: ['SC:L'],
  education: ['EIPA-4.0', 'NIC'],
  community: ['NIC', 'CDI'],
};

export const SETTING_LABELS: Record<Setting, string> = {
  medical: 'Medical',
  legal: 'Legal',
  education: 'Education',
  community: 'Community',
};

export const GATE_LABELS: Record<GateName, string> = {
  credential: 'Credential',
  validity: 'Valid on date',
  schedule: 'Schedule',
  consumer: 'Consumer',
};

export const GATE_ORDER: readonly GateName[] = ['credential', 'validity', 'schedule', 'consumer'];

export interface UserSummary {
  id: string;
  name: string;
}

export interface SessionUser extends UserSummary {
  email: string;
  role: Role;
  org_id: string | null;
}

export interface GateResult {
  gate: GateName;
  label: string;
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

export interface SeatOffer {
  id: string;
  status: OfferStatus;
  sent_at: string;
  expires_at: string;
  email: 'sent' | 'queued';
}

export interface SeatTimesheet {
  id: string;
  status: TimesheetStatus;
  billed_hours: string;
  amount: string | null;
}

export interface RequestSeat {
  id: string;
  position: number;
  status: SeatStatus;
  interpreter: UserSummary | null;
  held_by: UserSummary | null;
  offer: SeatOffer | null;
  timesheet: SeatTimesheet | null;
}

export interface PrepFile {
  id: string;
  filename: string;
  size: number;
  content_type: string;
}

export interface RequestObject {
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
  consumer: UserSummary;
  notes: string;
  status: RequestStatus;
  logged_after: boolean;
  seats_total: number;
  seats_claimed: number;
  seats_accepted: number;
  in_cancellation_window: boolean;
  cancellation_fee: string | null;
  seats: RequestSeat[];
  prep_files: PrepFile[];
}

export interface BoardCredential {
  id: string;
  type: CredentialType;
  expires_on: string;
  expired: boolean;
}

export interface BoardInterpreter {
  id: string;
  name: string;
  credentials: BoardCredential[];
}

export interface BoardPayload {
  interpreters: BoardInterpreter[];
  requests: RequestObject[];
}

export interface OfferRequestSummary {
  id: string;
  ref: string;
  title: string;
  setting: Setting;
  location: string;
  start: string;
  end: string;
  org_name: string;
}

export interface MyOffer {
  id: string;
  token: string;
  status: 'active';
  sent_at: string;
  expires_at: string;
  request: OfferRequestSummary;
  seat: { position: number; total: number };
}

export interface AssignmentsPayload {
  offers: MyOffer[];
  assignments: RequestObject[];
}

export interface OfferPagePayload {
  offer: { status: OfferStatus; expires_at: string };
  request: Omit<OfferRequestSummary, 'id'>;
  seat: { position: number; total: number };
  interpreter: { name: string };
}

export interface CredentialRecord {
  id: string;
  type: CredentialType;
  number: string;
  expires_on: string;
  status: CredentialStatus;
}

export interface TimesheetQueueRow {
  id: string;
  ref: string;
  request_id: string;
  org_id: string;
  interpreter: UserSummary;
  actual_start: string;
  actual_end: string;
  billed_hours: string;
  status: TimesheetStatus;
}

export interface InvoiceItem {
  description: string;
  amount: string;
}

export interface InvoiceRecord {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  amount: string;
  balance: string;
  currency: 'USD';
  items: InvoiceItem[];
}

export interface InvoicesPayload {
  org_id: string;
  killbill_account_id: string;
  invoices: InvoiceRecord[];
  total: string;
}

export interface SystemStatus {
  postgres: 'up' | 'down';
  killbill: 'up' | 'down';
  mail: 'up' | 'down';
  storage: 'up' | 'down';
}

export interface AuditEntry {
  at: string;
  actor: { id: string; name: string; role: Role } | null;
  action: string;
  entity: string;
  entity_id: string;
  from: string | null;
  to: string | null;
  detail: Record<string, unknown>;
}

export type Rates = Record<Setting, string>;

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
  [extra: string]: unknown;
}
