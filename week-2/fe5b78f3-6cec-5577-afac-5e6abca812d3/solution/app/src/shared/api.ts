// The JSON bodies the API speaks, shared by the server that builds them and the browser that reads them.

export type ClassCode = "SL" | "3A";
export type Quota = "GN" | "TQ" | "LD" | "SS";
export type Accept = "CNF" | "RAC" | "WL";
export type Gender = "M" | "F" | "T";
export type BerthType = "LB" | "MB" | "UB" | "SL" | "SU";
export type BerthPreference = BerthType | "NONE";
export type BerthPool = Quota | "RAC";
export type BerthState = "free" | "taken" | "rac_free" | "rac_one_free" | "rac_full";
export type QueueList = "GNWL" | "RLWL" | "PQWL" | "TQWL";
type BookingStatusCode = "CNF" | "RAC" | QueueList | "NOSB";
export type StatusCode = BookingStatusCode | "CAN" | "CHART_NOT_CONFIRMED";
export type Window = "not_yet_open" | "open" | "chart_prepared";
export type BookingState = "booked" | "chart_prepared" | "journey_complete";
export type TicketKind = "booked" | "cancellation" | "chart";
export type Band =
  | "flat"
  | "quarter"
  | "half"
  | "tatkal_confirmed"
  | "clerkage"
  | "party_clerkage"
  | "rac_after_chart"
  | "after_chart"
  | "chart_full"
  | "no_fare";

export interface ApiErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  offer?: { accept: Accept; label: string };
  charged?: false;
  opens_at?: string;
}

export interface Account {
  id: string;
  name: string;
  email: string;
  phone: string;
}

export interface Station {
  code: string;
  name: string;
}

export interface ClockBody {
  now: string;
  zone: "Asia/Kolkata";
  rate: number;
}

export interface ClassEntry {
  class: ClassCode;
  quota: Quota;
  window: Window;
  opens_at: string;
  avl: number;
  rac: number | null;
  wl_type: QueueList | null;
  wl: number | null;
  wl_cap: number | null;
  label: string;
  adult_fare_paise: number;
}

export interface TrainResult {
  number: string;
  name: string;
  run_date: string;
  from: { code: string; name: string; departure_at: string };
  to: { code: string; name: string; arrival_at: string };
  stops: { code: string; name: string; km: number; departure_at: string }[];
  chart_at: string;
  chart_prepared: boolean;
  classes: ClassEntry[];
}

export interface CoachBerth {
  berth: number;
  bay: number;
  type: BerthType;
  quota: BerthPool;
  state: BerthState;
}

export interface CoachPlanBody {
  coaches: { coach: string; berths: CoachBerth[] }[];
}

export interface FareLine {
  label: string;
  amount_paise: number;
}

export interface FareQuote {
  lines: FareLine[];
  total_paise: number;
}

export interface PassengerStatus {
  status: StatusCode;
  position: number | null;
  coach: string | null;
  berth: number | null;
  berth_type: BerthType | null;
  label: string;
}

export interface Passenger {
  number: number;
  name: string;
  age: number;
  gender: Gender;
  berth_preference: BerthPreference;
  fare_paise: number;
  booking_status: PassengerStatus;
  current_status: PassengerStatus;
  history: { at: string; from_label: string; to_label: string }[];
}

export interface CancelledPassenger {
  number: number;
  band: Band;
  charge_paise: number;
  gst_paise: number;
  deduction_paise: number;
  refund_paise: number;
}

export interface Cancellation {
  number: number;
  requested_at: string;
  passengers: CancelledPassenger[];
  refund_paise: number;
}

export interface Refund {
  number: number;
  reason: "cancellation" | "chart";
  refund_paise: number;
  status: "pending" | "issued";
  issued_at: string | null;
}

export interface Booking {
  pnr: string;
  version: number;
  state: BookingState;
  train: { number: string; name: string };
  run_date: string;
  from: string;
  to: string;
  class: ClassCode;
  quota: Quota;
  departure_at: string;
  arrival_at: string;
  chart_at: string;
  chart_prepared: boolean;
  keep_in_one_coach: boolean;
  lower_berth_only: boolean;
  contact_phone: string;
  total_paise: number;
  fare_lines: FareLine[];
  passengers: Passenger[];
  tickets: { version: number; kind: TicketKind; created_at: string }[];
  cancellations: Cancellation[];
  refunds: Refund[];
}

export interface BookingSummary {
  pnr: string;
  train: { number: string; name: string };
  run_date: string;
  from: string;
  to: string;
  class: ClassCode;
  state: BookingState;
  summary: string;
}

export interface CancellationQuote {
  quoted_at: string;
  passengers: CancelledPassenger[];
  refund_paise: number;
}

export interface CancellationResult {
  cancellation: Cancellation;
  refund: Refund | null;
  booking: Booking;
}

export interface PublicPnr {
  pnr: string;
  train: { number: string; name: string };
  run_date: string;
  from: string;
  to: string;
  class: ClassCode;
  chart_prepared: boolean;
  passengers: { number: number; booking_status: string; current_status: string }[];
}

interface BookingRequestPassenger {
  name: string;
  age: number;
  gender: Gender | "";
  berth_preference: BerthPreference;
}

export interface BookingRequest {
  train: string;
  run_date: string;
  from: string;
  to: string;
  class: ClassCode;
  quota: Quota;
  passengers: BookingRequestPassenger[];
  keep_in_one_coach: boolean;
  lower_berth_only: boolean;
  accept: Accept;
  contact_phone: string;
}
