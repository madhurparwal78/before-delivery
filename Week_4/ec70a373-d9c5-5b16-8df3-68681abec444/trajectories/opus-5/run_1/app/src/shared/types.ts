/** Domain vocabulary shared by the server and the browser. */

export type Role = 'member' | 'kitchen_manager' | 'finance_lead';

export type StationKind = 'oven' | 'mixer' | 'blast_chiller' | 'prep_table';

export type SectorKind = 'booked' | 'buffer' | 'own_held' | 'own_confirmed' | 'nonexistent';

export type BookingStatus =
  | 'held'
  | 'confirmed'
  | 'checked_in'
  | 'checked_out'
  | 'no_show'
  | 'cancelled'
  | 'expired';

export type MovementKind =
  | 'opening_balance'
  | 'pack_purchase'
  | 'booking_debit'
  | 'hold_release'
  | 'cancel_refund'
  | 'forfeit'
  | 'usage'
  | 'late_checkout'
  | 'pack_expiry';

export type LedgerAccount =
  | 'available'
  | 'committed'
  | 'expired'
  | 'pack_sales'
  | 'opening_balance'
  | 'used'
  | 'forfeited';

export type DocumentType =
  | 'certificate_of_insurance'
  | 'food_handler_certificate'
  | 'business_licence';

export type DocumentStatus = 'pending' | 'verified' | 'rejected';

export type ServiceCode =
  | 'potable_water'
  | 'grey_water'
  | 'grease'
  | 'food_storage'
  | 'cleaning'
  | 'restock';

export type LinkState = 'live' | 'expired' | 'revoked';

export type RateState = 'current' | 'upcoming' | 'past';

export type AuditOutcome =
  | 'allowed'
  | 'refused_session'
  | 'refused_csrf'
  | 'refused_rate'
  | 'refused_role'
  | 'refused_scope'
  | 'refused_validation'
  | 'refused_conflict'
  | 'failed_dependency';

/** Sanitation buffer, in whole minutes, by station kind. */
export const SANITATION_BUFFER_MINUTES: Record<StationKind, number> = {
  blast_chiller: 45,
  oven: 30,
  mixer: 30,
  prep_table: 15,
};

/** The booking step, in whole minutes. */
export const BOOKING_STEP_MINUTES = 15;

/** Degrees per minute on the 24-hour Burner Dial ring. */
export const DEGREES_PER_MINUTE = 0.25;

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  opening_balance: 'Opening balance',
  pack_purchase: 'Pack purchase',
  booking_debit: 'Booking',
  hold_release: 'Hold released',
  cancel_refund: 'Cancellation refund',
  forfeit: 'Forfeit',
  usage: 'Station time used',
  late_checkout: 'Late check-out',
  pack_expiry: 'Pack hours expired',
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  certificate_of_insurance: 'Certificate of insurance',
  food_handler_certificate: 'Food handler certificate',
  business_licence: 'Business licence',
};

export const SERVICE_LABELS: Record<ServiceCode, string> = {
  potable_water: 'Potable water',
  grey_water: 'Grey water',
  grease: 'Grease',
  food_storage: 'Food storage',
  cleaning: 'Cleaning',
  restock: 'Restock',
};

export const STATION_KIND_LABELS: Record<StationKind, string> = {
  oven: 'Oven',
  mixer: 'Mixer',
  blast_chiller: 'Blast chiller',
  prep_table: 'Prep table',
};

export const BOOKING_STATUS_WORDS: Record<BookingStatus, string> = {
  held: 'Held',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  checked_out: 'Checked out',
  no_show: 'No-show',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export interface ActorJson {
  user_id: string;
  name: string;
  role: Role;
}

export interface PersonJson {
  user_id: string;
  name: string;
}

export interface OverageJson {
  quarter_hours: number;
  hourly_rate_cents: number;
  tax_rate_percent: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  killbill_invoice_id: string | null;
}

export interface BookingJson {
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
  hours: number;
  status: BookingStatus;
  hold_expires_at: string | null;
  series_id: string | null;
  refunded_hours: number | null;
  forfeited_hours: number | null;
  cancelled_by: PersonJson | null;
  cancellation_reason: string | null;
  checked_in_at: string | null;
  checked_in_by: PersonJson | null;
  no_show_by: PersonJson | null;
  checked_out_at: string | null;
  checked_out_by: PersonJson | null;
  late_quarter_hours: number | null;
  pack_hours_applied: number | null;
  overage: OverageJson | null;
  created_at: string;
}

export interface LotJson {
  purchase_id: string | null;
  pack_name: string;
  hours: number;
  valid_through: string | null;
  expiring_soon: boolean;
}

export interface BalancesJson {
  available_hours: number;
  committed_hours: number;
  lots: LotJson[];
}

export interface MovementJson {
  id: string;
  kind: MovementKind;
  booking_id: string | null;
  purchase_id: string | null;
  hours: number;
  created_at: string;
  actor: ActorJson | null;
  lots: { purchase_id: string | null; hours: number }[];
  entries: { account: LedgerAccount; hours: number }[];
}

export interface DocumentJson {
  id: string;
  member_id: string;
  type: DocumentType;
  expiry_date: string;
  status: DocumentStatus;
  file_name: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  rejection_reason: string | null;
  created_at: string;
}

export interface VisitJson {
  id: string;
  truck_id: string;
  site_id: string;
  arrived_at: string;
  departed_at: string | null;
  services: ServiceCode[];
  operator_signature: string;
  manager_name: string;
  gap_hours: number | null;
  gap_flagged: boolean;
}

export interface InspectorLinkJson {
  id: string;
  truck_id: string;
  inspector_email: string;
  url: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  state: LinkState;
}

export interface RateJson {
  id: string;
  effective_from: string;
  hourly_rate_cents: number;
  tax_rate_percent: string;
  state: RateState;
  created_at: string;
}

export interface SiteJson {
  id: string;
  name: string;
  time_zone: string;
  address: string;
  local_now: string;
  local_date: string;
}

export interface MeJson {
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
    available_hours: number;
    committed_hours: number;
    valid_through: Record<DocumentType, string | null>;
    truck: null | { id: string; name: string; permit_number: string };
  };
}

export interface AvailabilitySector {
  kind: SectorKind;
  start: string;
  end: string;
  booking_id: string | null;
}

export interface AvailabilityStation {
  id: string;
  name: string;
  kind: StationKind;
  sectors: AvailabilitySector[];
}

export interface AvailabilityJson {
  site_id: string;
  date: string;
  stations: AvailabilityStation[];
}

export interface MemberSearchJson {
  id: string;
  business_name: string;
  contact_name: string;
  home_site_id: string;
  truck: null | { id: string; name: string };
}

export interface ReportSiteRow {
  site_id: string;
  site_name: string;
  scheduled_hours: number;
  used_hours: number;
  forfeited_hours: number;
  overage_cents: number;
}

export interface ReportJson {
  month: string;
  member: null | { id: string; business_name: string };
  sites: ReportSiteRow[];
  totals: {
    scheduled_hours: number;
    used_hours: number;
    forfeited_hours: number;
    overage_cents: number;
  };
}

export interface InspectVisitJson {
  arrived_at: string;
  departed_at: string | null;
  services: ServiceCode[];
  operator_signature: string;
  manager_name: string;
  gap_hours: number | null;
  gap_flagged: boolean;
}

export interface InspectJson {
  truck: { name: string; permit_number: string };
  operator: { business_name: string };
  commissary: { site_name: string; address: string; time_zone: string };
  expires_at: string;
  overdue: boolean;
  last_departed_at: string | null;
  visits: InspectVisitJson[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    dates?: string[];
  };
}
