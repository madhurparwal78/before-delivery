import type { WeekdayKey } from '../../shared/calendar.js';
import type { BookingStatus, DocumentStatus, DocumentType } from '../../shared/format.js';
import type { PeakWindow, RateVersion } from './rates.js';

export type Role = 'operator' | 'shift_lead' | 'member';

export type Kitchen = {
  id: string;
  name: string;
  slug: string;
  timeZone: string;
  peakWindows: PeakWindow[];
  requiredDocuments: DocumentType[];
  rulesVersion: number;
  firstStartDate: string;
  firstStartAtMs: number;
};

export type Person = {
  id: string;
  kitchenId: string;
  email: string;
  name: string;
  role: Role;
  memberId: string | null;
};

export type Member = {
  id: string;
  kitchenId: string;
  personId: string;
  name: string;
  email: string;
  businessName: string;
  allowanceQuarters: number;
};

export type StationKind = 'hourly' | 'shelf';

export type Station = {
  id: string;
  kitchenId: string;
  name: string;
  kind: StationKind;
  capacity: number | null;
  laneOrder: number;
  rates: RateVersion[];
};

export type BookingRow = {
  id: string;
  kitchenId: string;
  memberId: string;
  stationId: string;
  kind: StationKind;
  localDate: string;
  localStart: string | null;
  localEnd: string | null;
  days: number | null;
  startMs: number;
  endMs: number;
  month: string;
  status: BookingStatus;
  quarterHours: number;
  peakQuarters: number;
  chargeCents: number;
  penaltyCents: number;
  penaltyWaived: boolean;
  conflict: boolean;
  seriesId: string | null;
  notes: string;
  holdExpiresAtMs: number | null;
  confirmedAtMs: number | null;
  version: number;
  seq: string;
};

export type BookingAction =
  | 'confirm'
  | 'cancel'
  | 'check_in'
  | 'check_out'
  | 'no_show'
  | 'move'
  | 'release'
  | 'waive_penalty';

export type OutOfServiceWindow = {
  id: string;
  kitchenId: string;
  stationId: string;
  startMs: number;
  endMs: number;
  localDate: string;
  localStart: string;
  localEnd: string;
  reason: string;
};

export type DocumentRow = {
  id: string;
  kitchenId: string;
  memberId: string;
  type: DocumentType;
  expiryDate: string;
  status: DocumentStatus;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAtMs: number;
  approvedAtMs: number | null;
  version: number;
  objectPending: boolean;
  seq: string;
};

export type SanitationEntry = {
  id: string;
  kitchenId: string;
  area: string;
  task: string;
  sanitizerPpm: number | null;
  initials: string;
  notes: string;
  loggedAtMs: number;
  loggedBy: string;
};

export type InspectorAccessRecord = {
  atMs: number;
  action: 'view' | 'document' | 'report';
  target: string | null;
};

export type InspectorLink = {
  id: string;
  kitchenId: string;
  email: string;
  token: string;
  expiresAtMs: number;
  revokedAtMs: number | null;
  records: InspectorAccessRecord[];
};

export type BillingLineKind = 'booking' | 'penalty' | 'credit';

export type BillingItem = {
  id: string;
  seq: string;
  kitchenId: string;
  memberId: string;
  month: string;
  bookingId: string;
  lineKind: BillingLineKind;
  itemKind: string;
  description: string;
  amountCents: number;
  filedDate: string;
  recorded: boolean;
};

export type { PeakWindow, RateVersion, WeekdayKey };
export type { BookingStatus, DocumentStatus, DocumentType };
