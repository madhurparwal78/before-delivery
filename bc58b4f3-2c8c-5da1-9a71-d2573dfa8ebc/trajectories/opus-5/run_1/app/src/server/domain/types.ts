export type Role = 'scheduler' | 'org_admin' | 'dispatcher' | 'billing_lead' | 'interpreter';

export type AssignmentStatus =
  | 'draft'
  | 'released'
  | 'partially_covered'
  | 'covered'
  | 'served'
  | 'verified'
  | 'invoiced'
  | 'cancelled';

export type SeatStatus = 'open' | 'held' | 'served';

export type Setting = 'hospital' | 'clinic' | 'school';

export type ServiceLine = 'asl' | 'spoken';

export type BillingStatus = 'none' | 'ready' | 'queued' | 'posted';

export type BillableKind = 'service' | 'late_cancellation';

export interface SessionUser {
  id: string;
  name: string;
  role: Role;
  initials: string;
  orgCode: string | null;
  orgName: string | null;
  languages: string[];
}

export interface SeatRecord {
  seat: number;
  status: SeatStatus;
  holderId: string | null;
  holderInitials: string | null;
  holderName: string | null;
  actualMinutes: number | null;
  roundTripMiles: number | null;
}

export interface AssignmentRecord {
  id: number;
  number: string;
  orgCode: string;
  orgName: string;
  schedulerId: string;
  schedulerName: string;
  schedulerPhone: string;
  languageCode: string;
  languageName: string;
  setting: Setting;
  startAt: Date;
  durationMinutes: number;
  streetAddress: string;
  city: string;
  patientInitials: string;
  medicalNotes: string;
  status: AssignmentStatus;
  seatCount: number;
  cancelledAt: Date | null;
  cancelFeeApplies: boolean | null;
  cancelBusinessMinutes: number | null;
  cancelFeeCents: number | null;
  billingStatus: BillingStatus;
  invoiceId: string | null;
  totalCents: number | null;
  seats: SeatRecord[];
}

export interface RateEntry {
  orgCode: string;
  serviceLine: ServiceLine;
  effectiveFrom: string;
  hourlyRateCents: number;
  mileageCentsPerMile: number;
}

export interface Language {
  code: string;
  name: string;
}
