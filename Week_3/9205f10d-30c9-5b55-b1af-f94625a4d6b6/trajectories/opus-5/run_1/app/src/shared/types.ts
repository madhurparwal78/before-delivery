export type Role = 'coordinator' | 'interpreter' | 'client_scheduler' | 'billing_admin';

export const SETTINGS = ['medical', 'education', 'legal'] as const;
export type Setting = (typeof SETTINGS)[number];

export const CREDENTIAL_TYPES = ['NIC', 'CDI', 'SC:L', 'EIPA'] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export type RequestStatus =
  | 'draft'
  | 'submitted'
  | 'half-staffed'
  | 'staffed'
  | 'completed'
  | 'invoiced'
  | 'cancelled_early'
  | 'cancelled_late';

export type SeatLabel = 'A' | 'B';
export type SeatStatus = 'open' | 'confirmed';
export type CredentialStatus = 'uploaded' | 'verified' | 'expired';
export type InvoiceKind = 'interpreting' | 'late_cancellation';
export type BillingStatus = 'pending' | 'posted';

export interface Organisation {
  id: string;
  name: string;
  code: string;
}

export interface SessionUser {
  id: string;
  role: Role;
  display_name: string;
  email: string;
  organisation: Organisation | null;
}

export interface SeatInterpreter {
  id?: string;
  display_name: string;
  full_name?: string;
  email?: string;
  phone?: string;
  home_area?: string;
  pay_rate?: string;
  credentials: CredentialType[];
}

export interface Seat {
  id: string;
  label: SeatLabel;
  status: SeatStatus;
  interpreter: SeatInterpreter | null;
}

export interface HistoryEntry {
  at: string;
  actor: string;
  action: string;
  detail: string;
}

export interface RequestView {
  id: string;
  reference: string;
  setting: Setting;
  required_credential: CredentialType;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  city: string;
  status: RequestStatus;
  team_size: number;
  rotation_minutes: number;
  seats: Seat[];
  organisation?: Organisation;
  free_cancel_until?: string;
  consumer_name?: string;
  location_address?: string;
  notes?: string;
  hourly_rate?: string;
  actual_minutes?: number | null;
  team_reason?: string | null;
  history?: HistoryEntry[];
}

export interface Quote {
  kind: 'early' | 'late';
  fee: string;
  free_cancel_until: string;
  billable_minutes: number;
  seats_charged: number;
  hourly_rate: string;
}

export interface Invoice {
  id: string;
  request_reference: string;
  organisation: Organisation;
  kind: InvoiceKind;
  billable_minutes: number;
  seats: number;
  hourly_rate: string;
  amount: string;
  billing_status: BillingStatus;
  killbill_invoice_id: string | null;
  created_at: string;
}

export interface Credential {
  id: string;
  credential_type: CredentialType;
  status: CredentialStatus;
  expires_on: string | null;
  uploaded_at: string;
  file_name: string | null;
}

export interface CredentialForReview extends Credential {
  interpreter: { id: string; display_name: string; full_name: string };
}

export interface SeatOnRequest {
  seat_id: string;
  seat_label: SeatLabel;
  request: RequestView;
}

export type ErrorCode =
  | 'payload_too_large'
  | 'unauthenticated'
  | 'invalid_credentials'
  | 'not_found'
  | 'forbidden'
  | 'idempotency_key_reused'
  | 'invalid_transition'
  | 'seat_taken'
  | 'credential_invalid'
  | 'schedule_conflict'
  | 'fee_changed'
  | 'unsupported_type'
  | 'validation'
  | 'storage_unavailable';

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string>;
    quote?: Quote;
  };
}
