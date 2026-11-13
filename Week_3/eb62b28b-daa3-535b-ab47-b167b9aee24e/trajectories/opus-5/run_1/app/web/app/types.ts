export { copy, cadenceLabel, sexLabel, flagLabel, drawStateLabel, packetTimeLabel } from '../../src/shared/copy';
export {
  accountStateLabel,
  membershipStateLabel,
  roleLabel,
  ageBandLabel,
  visitPageStateLabel,
  planStateLabel,
  threadStateLabel,
  twoTimeForm,
  oneTimeForm,
} from '../../src/shared/copy';
export {
  displayDate,
  displayDateOfInstant,
  displayDateTime,
  displayTimeOfInstant,
  localDate,
  localTime,
  zoneCity,
  zoneLabel,
  PRACTICE_ZONE,
} from '../../src/shared/time';
export type { TimeZoneId } from '../../src/shared/time';
export { formatMoney, plusPriceCents, perMonthCents, CADENCE_MONTHS } from '../../src/shared/money';
export type { Cadence } from '../../src/shared/money';
export { CATEGORIES, INGREDIENTS, MARKERS, STATES, strengthLabel } from '../../src/shared/catalog';
export type { CategoryId, IngredientDefinition, MarkerDefinition } from '../../src/shared/catalog';
export { SLOT_TIMES } from '../../src/shared/slots';

export type Role = 'owner' | 'specialist' | 'coordinator' | 'billingLead' | 'member';

export interface MembershipView {
  state: 'free' | 'pending' | 'active' | 'cancelled';
  cadence: 'sixMonths' | 'yearly' | null;
  renewalDate: string | null;
  plusUntil: string | null;
  pendingCadence: 'sixMonths' | 'yearly' | null;
  pendingFrom: string | null;
}

export interface AddressView {
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
}

export interface MemberView {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  sex: string | null;
  state: string | null;
  timeZone: import('../../src/shared/time').TimeZoneId | null;
  address: AddressView | null;
  gateNotes: string | null;
  accountState: 'active' | 'closing' | 'erasing' | 'erased';
  erasesAt: string | null;
  membership: MembershipView;
}

export interface DrawView {
  id: string;
  memberId: string;
  memberName?: string;
  phlebotomistId: string;
  phlebotomistName: string;
  state: 'booked' | 'collected' | 'ready' | 'released' | 'cancelled';
  startsAt: string;
  localDate: string;
  localTime: string;
  timeZone: import('../../src/shared/time').TimeZoneId;
  collectedAt: string | null;
  kitCodes: string[];
  hasResults: boolean;
  changesCloseAt: string;
  visitPage: { state: 'live' | 'ended' | 'none'; endsAt: string | null };
}

export interface SlotView {
  phlebotomistId: string;
  phlebotomistName: string;
  localTime: string;
  startsAt: string;
  free: boolean;
}

export interface PhlebotomistView {
  id: string;
  name: string;
  states: string[];
}

export interface RangeView {
  low: string;
  high: string;
  optimalLow: string;
  optimalHigh: string;
  effectiveFrom: string;
}

export interface ResultDrawView {
  drawId: string;
  collectedAt: string;
  resultId: string;
  value: string;
  flag: 'belowRange' | 'inRange' | 'optimal' | 'aboveRange';
  ageBand: 'age18To39' | 'age40To59' | 'age60Plus';
  range: RangeView;
  note: string | null;
  correctedBy: string | null;
  correctedAt: string | null;
}

export interface MarkerResultsView {
  marker: string;
  name: string;
  category: string;
  unit: string;
  decimals: number;
  scale: { min: string; max: string };
  draws: ResultDrawView[];
}

export interface BlendView {
  id?: string;
  memberId: string;
  items: { ingredient: string; capsulesPerDay: number; morning: number; evening: number }[];
  morningCapsules: number;
  eveningCapsules: number;
  listPriceCents: number;
  memberPriceCents: number;
  savedBy: string;
  savedAt: string;
}

export interface PlanView {
  id: string;
  memberId: string;
  state: 'draft' | 'published';
  basedOnPlanId: string | null;
  sections: { nutrition: string; movement: string; sleep: string; supplements: string };
  publishedAt: string | null;
  publishedBy: string | null;
  blend: BlendView | null;
  updatedAt: string;
}

export interface MessageView {
  id: string;
  from: { role: string; name: string };
  body: string;
  attachment: { id: string; kind: string; bytes: number } | null;
  sentAt: string;
}

export interface ThreadView {
  memberId: string;
  memberName: string;
  state: 'open' | 'handled';
  lastMessageAt: string | null;
}

export interface ReceiptListItem {
  id: string;
  number: string;
  memberName: string;
  paidAt: string;
  paidDate: string;
  amountCents: number;
  currency: string;
}

export interface ReceiptView extends ReceiptListItem {
  invoiceId: string;
  items: { description: string; periodStart: string; periodEnd: string; amountCents: number }[];
  practice: { name: string; address: string; taxNumber: string };
}

export interface VisitView {
  memberName: string;
  startsAt: string;
  localDate: string;
  localTime: string;
  timeZone: import('../../src/shared/time').TimeZoneId;
  isDrawDay: boolean;
  address: (AddressView & { state: string }) | null;
  gateNotes: string | null;
  kitCodes: string[];
  state: 'booked' | 'collected';
  collectedAt: string | null;
  endsAt: string;
}

export interface StaffView {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface RangeChangeView {
  id: string;
  marker: string;
  effectiveFrom: string;
  createdBy: string;
  createdAt: string;
}

export interface PreviewRow {
  row: number;
  status: 'matched' | 'unknown' | 'refused';
  kitCode?: string;
  marker?: string;
  value?: string;
  unit?: string;
  reason?: string;
  source?: { marker: string; value: string; unit: string };
}
