// The published JSON shapes. Server projections build exactly these; the client reads them.
import type { Cents, StationKind } from "./rules.ts";

/** Pack hours as a JSON number, always a multiple of 0.25. */
export type Hours = number;

export type Role = "member" | "kitchen_manager" | "finance_lead";
export type BookingStatus = "held" | "confirmed" | "checked_in" | "checked_out" | "no_show" | "cancelled" | "expired";
export type MovementKind =
  | "opening_balance"
  | "pack_purchase"
  | "booking_debit"
  | "hold_release"
  | "cancel_refund"
  | "forfeit"
  | "usage"
  | "late_checkout"
  | "pack_expiry";
export type Account = "available" | "committed" | "expired" | "pack_sales" | "opening_balance" | "used" | "forfeited";
export type SectorKind = "booked" | "buffer" | "own_held" | "own_confirmed" | "nonexistent";
export type DocumentType = "certificate_of_insurance" | "food_handler_certificate" | "business_licence";
export type DocumentStatus = "pending" | "verified" | "rejected";
export type DocumentContentType = "application/pdf" | "image/png" | "image/jpeg";
export type Service = "potable_water" | "grey_water" | "grease" | "food_storage" | "cleaning" | "restock";
export type LinkState = "live" | "expired" | "revoked";
export type RateState = "current" | "upcoming" | "past";

export interface PersonRef {
  user_id: string;
  name: string;
}

export interface Actor extends PersonRef {
  role: "member" | "kitchen_manager";
}

interface Overage {
  quarter_hours: number;
  hourly_rate_cents: Cents;
  tax_rate_percent: string;
  subtotal_cents: Cents;
  tax_cents: Cents;
  total_cents: Cents;
  killbill_invoice_id: string | null;
}

export interface Booking {
  id: string;
  reference: string;
  site_id: string;
  station_id: string;
  station_name: string;
  member_id: string;
  business_name: string;
  date: string;
  start: string;
  end: string;
  start_at: string;
  end_at: string;
  hours: Hours;
  status: BookingStatus;
  hold_expires_at: string | null;
  series_id: string | null;
  refunded_hours: Hours | null;
  forfeited_hours: Hours | null;
  cancelled_by: PersonRef | null;
  cancellation_reason: string | null;
  checked_in_at: string | null;
  checked_in_by: PersonRef | null;
  no_show_by: PersonRef | null;
  checked_out_at: string | null;
  checked_out_by: PersonRef | null;
  late_quarter_hours: number | null;
  pack_hours_applied: Hours | null;
  overage: Overage | null;
  created_at: string;
}

interface Lot {
  purchase_id: string | null;
  pack_name: string;
  hours: Hours;
  valid_through: string | null;
  expiring_soon: boolean;
}

export interface Balances {
  available_hours: Hours;
  committed_hours: Hours;
  lots: Lot[];
}

export interface Movement {
  id: string;
  kind: MovementKind;
  booking_id: string | null;
  purchase_id: string | null;
  hours: Hours;
  created_at: string;
  actor: Actor | null;
  lots: { purchase_id: string | null; hours: Hours }[];
  entries: { account: Account; hours: Hours }[];
}

export interface ValidThrough {
  certificate_of_insurance: string | null;
  food_handler_certificate: string | null;
  business_licence: string | null;
}

export interface Me {
  user: {
    id: string;
    name: string;
    email: string;
    role: Role;
    tenant: { id: string; name: string; legal_name: string };
    site_id: string | null;
  };
  member: null | {
    id: string;
    business_name: string;
    home_site_id: string;
    available_hours: Hours;
    committed_hours: Hours;
    valid_through: ValidThrough;
    truck: null | { id: string; name: string; permit_number: string };
  };
}

export interface Site {
  id: string;
  name: string;
  time_zone: string;
  address: string;
  local_now: string;
  local_date: string;
}

export interface Sector {
  kind: SectorKind;
  start: string;
  end: string;
  booking_id: string | null;
}

export interface Availability {
  site_id: string;
  date: string;
  stations: { id: string; name: string; kind: StationKind; sectors: Sector[] }[];
}

export interface Pack {
  id: string;
  name: string;
  hours: Hours;
  price_cents: Cents;
}

export interface Purchase {
  id: string;
  pack_id: string;
  pack_name: string;
  hours: Hours;
  price_cents: Cents;
  valid_through: string;
  killbill_payment_id: string;
  created_at: string;
}

export interface DocumentRecord {
  id: string;
  member_id: string;
  type: DocumentType;
  expiry_date: string;
  status: DocumentStatus;
  file_name: string;
  content_type: DocumentContentType;
  size_bytes: number;
  sha256: string;
  rejection_reason: string | null;
  created_at: string;
}

export interface MemberMatch {
  id: string;
  business_name: string;
  contact_name: string;
  home_site_id: string;
  truck: null | { id: string; name: string };
}

export interface Visit {
  id: string;
  truck_id: string;
  site_id: string;
  arrived_at: string;
  departed_at: string | null;
  services: Service[];
  operator_signature: string | null;
  manager_name: string;
  gap_hours: number | null;
  gap_flagged: boolean;
}

export interface TruckLog {
  truck: { id: string; name: string; permit_number: string; member_id: string; business_name: string };
  visits: Visit[];
  last_departed_at: string | null;
  overdue: boolean;
}

export interface InspectorLink {
  id: string;
  truck_id: string;
  inspector_email: string;
  url: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  state: LinkState;
}

export type InspectorVisit = Omit<Visit, "id" | "truck_id" | "site_id">;

export interface InspectorView {
  truck: { name: string; permit_number: string };
  operator: { business_name: string };
  commissary: { site_name: string; address: string; time_zone: string };
  expires_at: string;
  overdue: boolean;
  last_departed_at: string | null;
  visits: InspectorVisit[];
}

export interface Rate {
  id: string;
  effective_from: string;
  hourly_rate_cents: Cents;
  tax_rate_percent: string;
  state: RateState;
  created_at: string;
}

export interface ReportRow {
  site_id: string;
  site_name: string;
  scheduled_hours: Hours;
  used_hours: Hours;
  forfeited_hours: Hours;
  overage_cents: Cents;
}

export interface Report {
  month: string;
  member: null | { id: string; business_name: string };
  sites: ReportRow[];
  totals: Omit<ReportRow, "site_id" | "site_name">;
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string>; dates?: string[] };
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  certificate_of_insurance: "Certificate of insurance",
  food_handler_certificate: "Food handler certificate",
  business_licence: "Business licence",
};

export const SERVICE_LABELS: Record<Service, string> = {
  potable_water: "Potable water",
  grey_water: "Grey water",
  grease: "Grease",
  food_storage: "Food storage",
  cleaning: "Cleaning",
  restock: "Restock",
};
