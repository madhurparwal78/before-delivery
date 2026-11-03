// JSON shapes of the API, as the brief's API section defines them.
import type {
  CredentialType,
  GateKey,
  GateLabel,
  OfferStatus,
  RequestStatus,
  Role,
  SeatStatus,
  Setting,
  TimesheetStatus,
} from "./domain.js";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  org_id: string | null;
}

export interface Named {
  id: string;
  name: string;
}

export interface OfferSummary {
  id: string;
  status: OfferStatus;
  sent_at: string;
  expires_at: string;
  email: "sent" | "queued";
}

export interface TimesheetSummary {
  id: string;
  status: TimesheetStatus;
  billed_hours: string;
  amount: string | null;
}

export interface SeatView {
  id: string;
  position: number;
  status: SeatStatus;
  interpreter: Named | null;
  held_by: Named | null;
  offer: OfferSummary | null;
  timesheet: TimesheetSummary | null;
}

export interface PrepFile {
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
  consumer: Named;
  notes: string;
  status: RequestStatus;
  logged_after: boolean;
  seats_total: number;
  seats_claimed: number;
  seats_accepted: number;
  in_cancellation_window: boolean;
  cancellation_fee: string | null;
  seats: SeatView[];
  prep_files: PrepFile[];
}

export interface GateResult {
  gate: GateKey;
  label: GateLabel;
  pass: boolean;
  reason: string | null;
}

export interface DryRun {
  seat_id: string;
  interpreter_id: string;
  gates: GateResult[];
  all_pass: boolean;
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

export interface Board {
  interpreters: BoardInterpreter[];
  requests: RequestView[];
}

export interface OfferPage {
  offer: { status: OfferStatus; expires_at: string };
  request: { ref: string; title: string; setting: Setting; location: string; start: string; end: string; org_name: string };
  seat: { position: number; total: number };
  interpreter: { name: string };
}

export interface MyOffer {
  id: string;
  token: string;
  status: "active";
  sent_at: string;
  expires_at: string;
  request: { id: string; ref: string; title: string; setting: Setting; location: string; start: string; end: string; org_name: string };
  seat: { position: number; total: number };
}

export interface Assignments {
  offers: MyOffer[];
  assignments: RequestView[];
}

export interface CredentialView {
  id: string;
  type: CredentialType;
  number: string;
  expires_on: string;
  status: "valid" | "expiring" | "expired";
}

export interface QueuedTimesheet {
  id: string;
  ref: string;
  request_id: string;
  org_id: string;
  interpreter: Named;
  actual_start: string;
  actual_end: string;
  billed_hours: string;
  status: TimesheetStatus;
}

export interface Rates {
  medical: string;
  legal: string;
  education: string;
  community: string;
}

interface InvoiceItem {
  description: string;
  amount: string;
}

export interface Invoice {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  amount: string;
  balance: string;
  currency: "USD";
  items: InvoiceItem[];
}

export interface Invoices {
  org_id: string;
  killbill_account_id: string;
  invoices: Invoice[];
  total: string;
}

export interface MyPreferences {
  preferred: string[];
  blocked: string[];
  interpreters: Named[];
}

export interface ConsumerPreferences {
  consumer: Named;
  preferred: string[];
  blocked: string[];
}

export interface SystemStatus {
  postgres: "up";
  killbill: "up" | "down";
  mail: "up" | "down";
  storage: "up" | "down";
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    from?: string;
    holder?: Named;
    quote?: Quote;
    offer_status?: OfferStatus;
    fields?: Record<string, string>;
    gate?: GateKey;
    gates?: GateResult[];
  };
}
