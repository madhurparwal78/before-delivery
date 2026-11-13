
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

export type CertificateStatus = 'pending_review' | 'approved' | 'rejected';

export type MovementReason = 'opening' | 'checkout' | 'checkin' | 'to_repair' | 'from_repair';

export type RenterRole = 'renter' | 'owner' | 'prep_tech';

export interface Kit {
  id: string;
  name: string;
  category: string;
  position: number;
}

export interface UnitClass {
  id: string;
  kitId: string;
  name: string;
  replacementValueCents: number;
  position: number;
}

export interface SerialUnit {
  serial: string;
  classId: string;
}

export interface RateCard {
  version: number;
  effectiveDate: string;
  publishedAt: string;
  rates: ReadonlyArray<{ kitId: string; dayRateCents: number; depositCents: number }>;
}

export interface BookingUnit {
  serial: string;
  classId: string;
  checkedOutAt: Date | null;
  checkedInAt: Date | null;
  condition: 'ok' | 'damaged' | null;
  damageChargeCents: number;
  checkoutNotes: string;
  checkinNotes: string;
}

export interface Booking {
  ref: string;
  state: BookingState;
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
  renterName: string;
  renterEmail: string;
  renterKey: string;
  holdExpiresAt: Date;
  paymentStatus: PaymentStatus;
  damageCents: number;
  refundCents: number;
  createdAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  closedAt: Date | null;
  confirmationMailAt: Date | null;
  receiptMailAt: Date | null;
  units: BookingUnit[];
}

export interface Certificate {
  id: string;
  ref: string;
  status: CertificateStatus;
  uploadedAt: Date;
  sizeBytes: number;
  storageKey: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  limitCents: number | null;
  lossPayeeNamed: boolean | null;
  reason: string | null;
  reviewedAt: Date | null;
}

export interface Photo {
  id: string;
  ref: string;
  phase: 'checkout' | 'checkin';
  serial: string;
  status: 'pending' | 'stored' | 'failed';
  uploadedAt: Date;
}

export interface Movement {
  id: number;
  serial: string;
  reason: MovementReason;
  fromLocation: string;
  toLocation: string;
  bookingRef: string | null;
  at: Date;
}

export const HOLD_STATES: ReadonlySet<BookingState> = new Set(['quote', 'confirmed', 'prepped', 'out', 'returned']);

export const BOOKING_STATES: ReadonlyArray<BookingState> = [
  'quote',
  'expired',
  'confirmed',
  'cancelled',
  'prepped',
  'out',
  'returned',
  'closed',
];
