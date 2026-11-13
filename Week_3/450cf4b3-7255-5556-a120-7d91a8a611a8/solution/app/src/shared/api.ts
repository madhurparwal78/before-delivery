// Response shapes of the published API, shared so the browser reads exactly what the server sends.

export type Role = "owner" | "shift_lead" | "tenant";
export type TenantStatus = "applied" | "documents_pending" | "approved" | "suspended";
export type Lapse = "insurance_lapsed" | "food_handler_lapsed";
export type ClearanceReason = "not_approved" | Lapse;
export type StationKind = "range" | "prep_table" | "mixer" | "cooler_shelf";
export type BookingStatus = "held" | "confirmed" | "checked_in" | "completed" | "cancelled" | "no_show";
export type CancelReason = "tenant" | "hold_expired";
export type DocumentKind = "insurance_certificate" | "food_handler_card";
export type Movement = "purchase" | "booking_debit" | "cancellation_credit" | "move_adjustment" | "refund";
export type SpanStatus = "open" | "started" | "beyond_horizon";
export type CoverState = "ok" | "expires_soon" | "expires_today" | "lapsed" | "superseded";
export type EmailKind = "booking_confirmed" | "booking_moved";

export interface Me {
  id: string;
  role: Role;
  email: string;
  displayName: string;
  tenant: { id: string; businessName: string; status: TenantStatus; suspendedReason: Lapse | null } | null;
}

export interface Kitchen {
  name: string;
  timeZone: string;
  opensAt: string;
  closesAt: string;
  cleanupMinutes: number;
  minimumBookingMinutes: number;
  holdSeconds: number;
  today: string;
  now: string;
}

export interface TenantInterval {
  start: string;
  end: string;
  bufferEnd: string;
  mine: boolean;
}

export interface StaffInterval {
  start: string;
  end: string;
  bufferEnd: string;
  bookingId: string;
  status: BookingStatus;
  tenantId: string;
  tenantName: string;
}

export type Interval = TenantInterval | StaffInterval;

export interface Station {
  id: string;
  name: string;
  kind: StationKind;
  cleanupMinutes: number;
  col: number;
  row: number;
  intervals: Interval[];
  occupiedMinutes?: number;
  bufferMinutes?: number;
  freeMinutes?: number;
}

export interface CoolerRow {
  time: string;
  freeShelves: number;
}

export interface Floor {
  date: string;
  from: string | null;
  to: string | null;
  now: string;
  spanStatus: SpanStatus | null;
  coolerFree: CoolerRow[];
  stations: Station[];
}

/** A booking email or a pack receipt: queued until the mail server acknowledged it, then sent. */
export type EmailStatus =
  | { status: "queued"; sentAt: null }
  | { status: "sent"; sentAt: string };

export type BookingEmail = { kind: EmailKind } & EmailStatus;

export type DoorAction = "check_in" | "check_out" | "no_show";

export interface DoorLogEntry {
  action: DoorAction;
  at: string;
  by: string;
}

export interface Booking {
  id: string;
  stationId: string;
  stationName: string;
  shelfId: string | null;
  shelfName: string | null;
  start: string;
  end: string;
  bufferEnd: string;
  status: BookingStatus;
  holdExpiresAt: string;
  packId: string;
  debitedMinutes: number | null;
  refundedMinutes: number | null;
  cancelReason: CancelReason | null;
  createdAt: string;
  cutoffAt: string;
  cancelCreditMinutes: number | null;
  moveCount: number;
  movable: boolean;
  emails: BookingEmail[];
  tenantId?: string;
  tenantName?: string;
  doorLog?: DoorLogEntry[];
  cleanupNote?: string | null;
}

export interface DoorEntry {
  bookingId: string;
  tenantId: string;
  tenantName: string;
  stationId: string;
  stationName: string;
  shelfId: string | null;
  shelfName: string | null;
  start: string;
  end: string;
  status: BookingStatus;
  cleared: boolean;
  reason: ClearanceReason | null;
  checkInOpensAt: string;
  actions: DoorAction[];
  doorLog: DoorLogEntry[];
  cleanupNote: string | null;
}

export interface DoorList {
  date: string;
  now: string;
  entries: DoorEntry[];
}

export interface Pack {
  id: string;
  hours: number;
  purchasedMinutes: number;
  balanceMinutes: number;
  heldMinutes: number;
  availableMinutes: number;
  priceCents: number;
  status: "active" | "refunded";
  invoiceId: string;
  purchasedAt: string;
  receiptEmail: EmailStatus;
}

export interface LedgerEntry {
  id: string;
  movementId: string;
  movement: Movement;
  side: "pack" | "kitchen";
  minutes: number;
  bookingId: string | null;
  createdAt: string;
}

export interface PackDetail extends Pack {
  refundableCents: number;
  refundedCents: number | null;
  entries: LedgerEntry[];
}

export type NoticePoint = "seven_days" | "today";

export type DocumentNotice = { point: NoticePoint } & EmailStatus;

export interface DocumentRecord {
  id: string;
  tenantId: string;
  kind: DocumentKind;
  expiresOn: string;
  perOccurrenceLimit: number | null;
  additionalInsured: boolean | null;
  contentType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  hasFile: boolean;
  current: boolean;
  coverState: CoverState;
  daysLeft: number | null;
  uploadedAt: string;
  notices: DocumentNotice[];
}

export interface Tenant {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  status: TenantStatus;
  suspendedReason: Lapse | null;
  insuranceExpiresOn: string | null;
  foodHandlerExpiresOn: string | null;
  createdAt: string;
}

export interface TenantDetail extends Tenant {
  packs: PackDetail[];
  documents: DocumentRecord[];
}

export interface DailyReport {
  date: string;
  timeZone: string;
  totalBookedMinutes: number;
  stations: { stationId: string; stationName: string; bookedMinutes: number; bookingCount: number }[];
  tenants: { tenantId: string; businessName: string; bookedMinutes: number; bookingCount: number; noShowCount: number }[];
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

export const PACK_HOURS = [10, 20, 40] as const;
export type PackHours = (typeof PACK_HOURS)[number];
