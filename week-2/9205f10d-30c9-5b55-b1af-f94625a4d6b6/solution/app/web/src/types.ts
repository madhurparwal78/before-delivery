/** The API's JSON shapes, as the brief publishes them. */

export type Role = "coordinator" | "interpreter" | "client_scheduler" | "billing_admin";

export interface Organisation {
  id: string;
  name: string;
  code: string;
}

export interface User {
  id: string;
  role: Role;
  display_name: string;
  email: string;
  organisation: Organisation | null;
}

export type RequestStatus =
  | "draft"
  | "submitted"
  | "half-staffed"
  | "staffed"
  | "completed"
  | "invoiced"
  | "cancelled_early"
  | "cancelled_late";

export type SeatLabel = "A" | "B";

export interface SeatInterpreter {
  display_name: string;
  credentials: string[];
  full_name?: string;
  phone?: string | null;
  home_area?: string | null;
}

export interface Seat {
  id: string;
  label: SeatLabel;
  status: "open" | "confirmed";
  interpreter: SeatInterpreter | null;
}

export interface HistoryEntry {
  at: string;
  actor: string;
  action: string;
  detail: string;
}

/** A request as the API projects it for the caller; optional fields depend on the caller's role. */
export interface ApiRequest {
  id: string;
  reference: string;
  setting: "medical" | "education" | "legal";
  required_credential: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  city: string;
  status: RequestStatus;
  team_size: number | null;
  rotation_minutes: number | null;
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

export interface SeatListing {
  seat_id: string;
  seat_label: SeatLabel;
  request: ApiRequest;
}

export interface Quote {
  kind: "early" | "late";
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
  kind: "interpreting" | "late_cancellation";
  billable_minutes: number;
  seats: number;
  hourly_rate: string;
  amount: string;
  billing_status: "pending" | "posted";
  killbill_invoice_id: string | null;
  created_at: string;
}

export interface Credential {
  id: string;
  credential_type: string;
  status: "uploaded" | "verified" | "expired";
  expires_on: string | null;
  uploaded_at: string;
  file_name: string | null;
  interpreter?: { id: string; display_name: string; full_name: string };
}

export interface ApiErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string>;
  quote?: Quote;
}
