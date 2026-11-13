export type Role = 'owner' | 'prep_tech' | 'renter';

export type BookingState =
  | 'quote'
  | 'expired'
  | 'confirmed'
  | 'cancelled'
  | 'prepped'
  | 'out'
  | 'returned'
  | 'closed';

export type PaymentStatus = 'none' | 'pending' | 'paid' | 'failed' | 'refunded';

export type DayKind = 'billable' | 'free' | 'weekend';

export type UnitStatusForDates = 'free' | 'booked' | 'repair';

export type CertificateStatus = 'pending_review' | 'approved' | 'rejected';

export type PhotoPhase = 'checkout' | 'checkin';

export type PhotoStatus = 'pending' | 'stored' | 'failed';

export type MovementReason = 'opening' | 'checkout' | 'checkin' | 'to_repair' | 'from_repair';

export interface MovementEntry {
  location: string;
  delta: number;
}

export interface Movement {
  id: string;
  at: string;
  reason: MovementReason;
  from: string;
  to: string;
  bookingRef: string | null;
  entries: MovementEntry[];
}

export interface Blocker {
  code: string;
  message: string;
}

export interface BookingUnit {
  serial: string;
  classId: string;
  className: string;
  replacementValueCents: number;
  location: string;
  checkedOut: boolean;
  checkedIn: boolean;
  condition: 'ok' | 'damaged' | null;
  damageChargeCents: number;
}

export interface CertificateView {
  id: string;
  status: CertificateStatus;
  uploadedAt: string;
  sizeBytes: number;
  coverageStart: string | null;
  coverageEnd: string | null;
  limitCents: number | null;
  reason: string | null;
}

export interface PhotoView {
  id: string;
  phase: PhotoPhase;
  serial: string;
  status: PhotoStatus;
}

export interface Booking {
  ref: string;
  state: BookingState;
  kit: { id: string; name: string };
  pickupDate: string;
  returnDate: string;
  hireDays: number;
  renter: { name: string; email: string };
  units: BookingUnit[];
  replacementValueCents: number;
  billableDays: number;
  dayRateCents: number;
  hirePriceCents: number;
  depositCents: number;
  totalCents: number;
  rateCardVersion: number;
  rateCardEffectiveDate: string;
  holdExpiresAt: string | null;
  holdSecondsRemaining: number | null;
  confirmable: boolean;
  paymentStatus: PaymentStatus;
  damageCents: number;
  refundCents: number;
  certificate: CertificateView | null;
  photos: PhotoView[];
  checkout: { allowed: boolean; blockers: Blocker[] };
  close: { allowed: boolean; blockers: Blocker[] };
}

export interface KitComponent {
  classId: string;
  name: string;
  replacementValueCents: number;
}

export interface KitUnitView {
  serial: string;
  classId: string;
  location: string;
  status: UnitStatusForDates | null;
}

export interface KitPrice {
  billableDays: number;
  hirePriceCents: number;
}

export interface KitView {
  id: string;
  name: string;
  category: string;
  replacementValueCents: number;
  dayRateCents: number;
  depositCents: number;
  rateCardVersion: number;
  readyToGo: number;
  freeForDates: number | null;
  price: KitPrice | null;
  components: KitComponent[];
}

export interface KitDetailView extends KitView {
  units: KitUnitView[];
}

export interface PriceDay {
  day: number;
  date: string;
  kind: DayKind;
}

export interface PriceQuote {
  kitId: string;
  pickupDate: string;
  returnDate: string;
  hireDays: number;
  billableDays: number;
  dayRateCents: number;
  hirePriceCents: number;
  depositCents: number;
  totalCents: number;
  rateCardVersion: number;
  days: PriceDay[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    serial?: string | null;
    nextFreeSerial?: string | null;
    serials?: string[];
    blockers?: Blocker[];
    booking?: Booking;
  };
}

export interface ProviderStatus {
  payments: 'up' | 'down';
  storage: 'up' | 'down';
}

export interface RateCardView {
  version: number;
  effectiveDate: string;
  publishedAt: string;
  rates: { kitId: string; dayRateCents: number; depositCents: number }[];
}

export interface UtilisationView {
  totalUnits: number;
  onShelf: number;
  out: number;
  repair: number;
  utilisationPercent: number;
  kits: { kitId: string; readyToGo: number }[];
}

export interface CertificateQueueItem {
  id: string;
  bookingRef: string;
  status: CertificateStatus;
  uploadedAt: string;
  sizeBytes: number;
}

export interface UnitHistoryView {
  serial: string;
  classId: string;
  location: string;
  movements: Movement[];
  balances: Record<string, number>;
}
