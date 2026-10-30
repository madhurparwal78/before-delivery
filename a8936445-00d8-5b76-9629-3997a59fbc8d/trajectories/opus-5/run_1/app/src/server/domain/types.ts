import type {
  BookingStatus,
  DocumentKind,
  InvoiceLineKind,
  LedgerAccount,
  LedgerReason,
  PayWith,
  StationKind,
  TenantStatus,
  UserRole,
} from './constants.js';

export interface TenantRecord {
  id: string;
  businessName: string;
  ownerName: string;
  ownerEmail: string;
  storedStatus: TenantStatus;
  killbillAccountId: string | null;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string | null;
}

export interface StationRecord {
  id: string;
  name: string;
  kind: StationKind;
  hourlyRateCents: number;
  position: number;
}

export interface ShelfRecord {
  id: string;
  name: string;
  monthlyRateCents: number;
  tenantId: string | null;
  position: number;
}

export interface HourPackRecord {
  id: string;
  name: string;
  minutes: number;
  priceCents: number;
}

export interface PolicyRecord {
  version: number;
  freeWindowHours: number;
  lateFeePercent: number;
  effectiveAt: Date;
}

export interface HoldRecord {
  ref: string;
  tenantId: string;
  stationId: string;
  weeks: number;
  notes: string;
  createdAt: Date;
  expiresAt: Date;
  confirmedAt: Date | null;
  releasedAt: Date | null;
}

export interface BookingRecord {
  id: string;
  ref: string;
  holdRef: string;
  tenantId: string;
  stationId: string;
  date: string;
  startLocal: string;
  endLocal: string;
  startAt: Date;
  endAt: Date;
  startMinute: number;
  endMinute: number;
  elapsedMinutes: number;
  status: BookingStatus;
  payWith: PayWith | null;
  amountCents: number | null;
  policyVersion: number | null;
  notes: string;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
  holdoverReportedMinutes: number | null;
  holdoverBilledMinutes: number | null;
  holdoverAmountCents: number | null;
  cancelledAt: Date | null;
  cancellationLate: boolean | null;
  cancellationFeeCents: number | null;
  cancellationFeeMinutes: number | null;
  cancellationFeeRefunded: boolean;
  stationTimeInvoiceId: string | null;
  holdoverInvoiceId: string | null;
  lateFeeInvoiceId: string | null;
  createdAt: Date;
}

export interface DocumentRecord {
  id: string;
  tenantId: string;
  kind: DocumentKind;
  holderName: string | null;
  expiresOn: string;
  status: 'pending_review' | 'approved' | 'rejected';
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  uploadedAt: Date;
  reviewedAt: Date | null;
  rejectionReason: string | null;
}

export interface LedgerEntryRecord {
  id: string;
  movementId: string;
  tenantId: string;
  account: LedgerAccount;
  minutes: number;
  reason: LedgerReason;
  bookingId: string | null;
  createdAt: Date;
}

export interface InvoiceLineRecord {
  kind: InvoiceLineKind;
  description: string;
  bookingRef: string | null;
  shelfId: string | null;
  amountCents: number;
}

export interface InvoiceRecord {
  id: string;
  number: string;
  tenantId: string;
  period: string;
  status: 'issued' | 'paid';
  lines: InvoiceLineRecord[];
  subtotalCents: number;
  taxRatePercent: string;
  taxCents: number;
  totalCents: number;
  pdfKey: string;
  issuedAt: Date;
  paidAt: Date | null;
}

export interface InspectionLinkRecord {
  id: string;
  tenantId: string;
  token: string;
  expiresAt: Date;
  revokedAt: Date | null;
}
