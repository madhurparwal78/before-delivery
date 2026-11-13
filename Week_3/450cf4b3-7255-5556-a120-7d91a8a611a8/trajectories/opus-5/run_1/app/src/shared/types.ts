export type Role = 'owner' | 'shift_lead' | 'tenant';

export type TenantStatus = 'applied' | 'documents_pending' | 'approved' | 'suspended';
export type SuspendedReason = 'insurance_lapsed' | 'food_handler_lapsed';

export type StationKind = 'range' | 'prep_table' | 'mixer' | 'cooler_shelf';

export type BookingStatus = 'held' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';
export type CancelReason = 'tenant' | 'hold_expired';

export type SpanStatus = 'open' | 'started' | 'beyond_horizon';

export type DocumentKind = 'insurance_certificate' | 'food_handler_card';
export type CoverState = 'ok' | 'expires_soon' | 'expires_today' | 'lapsed' | 'superseded';
export type NoticePoint = 'seven_days' | 'today';

export type DoorAction = 'check_in' | 'check_out' | 'no_show';
export type ClearanceReason = 'not_approved' | 'insurance_lapsed' | 'food_handler_lapsed';

export type MovementKind = 'purchase' | 'booking_debit' | 'cancellation_credit' | 'move_adjustment' | 'refund';
export type BookingEmailKind = 'booking_confirmed' | 'booking_moved';
export type DeliveryStatus = 'queued' | 'sent';

export interface MeTenant {
  id: string;
  businessName: string;
  status: TenantStatus;
  suspendedReason: SuspendedReason | null;
}

export interface Me {
  id: string;
  role: Role;
  email: string;
  displayName: string;
  tenant: MeTenant | null;
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

export interface CoolerFreeCell {
  time: string;
  freeShelves: number;
}

export interface FloorResponse {
  date: string;
  from: string | null;
  to: string | null;
  now: string;
  spanStatus: SpanStatus | null;
  coolerFree: CoolerFreeCell[];
  stations: Station[];
}

export interface BookingEmailStatus {
  kind: BookingEmailKind;
  status: DeliveryStatus;
  sentAt: string | null;
}

export interface PackReceiptEmailStatus {
  status: DeliveryStatus;
  sentAt: string | null;
}

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
  holdExpiresAt: string | null;
  packId: string | null;
  debitedMinutes: number | null;
  refundedMinutes: number | null;
  cancelReason: CancelReason | null;
  createdAt: string;
  cutoffAt: string;
  cancelCreditMinutes: number | null;
  moveCount: number;
  movable: boolean;
  emails: BookingEmailStatus[];
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

export interface DoorResponse {
  date: string;
  now: string;
  entries: DoorEntry[];
}

export interface LedgerEntry {
  id: string;
  movementId: string;
  movement: MovementKind;
  side: 'pack' | 'kitchen';
  minutes: number;
  bookingId: string | null;
  createdAt: string;
}

export interface Pack {
  id: string;
  hours: number;
  purchasedMinutes: number;
  balanceMinutes: number;
  heldMinutes: number;
  availableMinutes: number;
  priceCents: number;
  status: 'active' | 'refunded';
  invoiceId: string;
  purchasedAt: string;
  receiptEmail: PackReceiptEmailStatus;
}

export interface PackDetail extends Pack {
  refundableCents: number;
  refundedCents: number | null;
  entries: LedgerEntry[];
}

export interface DocumentNotice {
  point: NoticePoint;
  status: DeliveryStatus;
  sentAt: string | null;
}

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

export interface TenantRecord {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  status: TenantStatus;
  suspendedReason: SuspendedReason | null;
  insuranceExpiresOn: string | null;
  foodHandlerExpiresOn: string | null;
  createdAt: string;
}

export interface TenantDetail extends TenantRecord {
  packs: PackDetail[];
  documents: DocumentRecord[];
}

export interface KitchenResponse {
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

export interface ReportStationRow {
  stationId: string;
  stationName: string;
  bookedMinutes: number;
  bookingCount: number;
}

export interface ReportTenantRow {
  tenantId: string;
  businessName: string;
  bookedMinutes: number;
  bookingCount: number;
  noShowCount: number;
}

export interface ReportResponse {
  date: string;
  timeZone: string;
  totalBookedMinutes: number;
  stations: ReportStationRow[];
  tenants: ReportTenantRow[];
}

export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}
