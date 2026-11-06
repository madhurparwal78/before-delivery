// Client types mirror the API's shapes.
export type Role = 'coordinator' | 'interpreter' | 'requester' | 'consumer' | 'billing';
export type Setting = 'medical' | 'legal' | 'education' | 'community';
export type RequestStatus =
  | 'draft' | 'submitted' | 'partially_staffed' | 'staffed'
  | 'completed' | 'invoiced' | 'cancelled_on_time' | 'cancelled_late';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  org_id: string | null;
}

export interface GateResult {
  gate: 'credential' | 'validity' | 'schedule' | 'consumer';
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

export interface OfferView {
  id: string;
  status: 'active' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
  sent_at: string;
  expires_at: string;
  email: 'sent' | 'queued';
}

export interface SeatView {
  id: string;
  position: number;
  status: 'open' | 'offered' | 'accepted';
  interpreter: { id: string; name: string } | null;
  held_by: { id: string; name: string } | null;
  offer: OfferView | null;
  timesheet: { id: string; status: 'submitted' | 'approved'; billed_hours: string; amount: string | null } | null;
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
  prep_files: Array<{ id: string; filename: string; size: number; content_type: string }>;
}

export interface BoardData {
  interpreters: Array<{
    id: string;
    name: string;
    credentials: Array<{ id: string; type: string; expires_on: string; expired: boolean }>;
  }>;
  requests: RequestView[];
}

export interface MyOfferView {
  id: string;
  token: string;
  status: 'active';
  sent_at: string;
  expires_at: string;
  request: {
    id: string; ref: string; title: string; setting: Setting; location: string;
    start: string; end: string; org_name: string;
  };
  seat: { position: number; total: number };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    holder?: { id: string; name: string };
    from?: string;
    offer_status?: string;
    quote?: Quote;
    fields?: Record<string, string>;
    gate?: string;
    gates?: GateResult[];
  };
}

export interface InvoiceView {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  amount: string;
  balance: string;
  currency: string;
  items: Array<{ description: string; amount: string }>;
}

export interface TimesheetRow {
  id: string;
  ref: string;
  request_id: string;
  org_id: string;
  interpreter: { id: string; name: string };
  actual_start: string;
  actual_end: string;
  billed_hours: string;
  status: 'submitted' | 'approved';
}
