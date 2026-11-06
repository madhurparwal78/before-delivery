export const INSTRUMENT_TYPES = ['flute', 'clarinet', 'trumpet', 'violin', 'cello'] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export const STRING_SIZES = ['1/4', '1/2', '3/4', '4/4'] as const;
export type Size = 'full' | (typeof STRING_SIZES)[number];

export const AVAILABILITY_ORDER: ReadonlyArray<{ instrument_type: InstrumentType; size: Size }> = [
  { instrument_type: 'flute', size: 'full' },
  { instrument_type: 'clarinet', size: 'full' },
  { instrument_type: 'trumpet', size: 'full' },
  { instrument_type: 'violin', size: '1/4' },
  { instrument_type: 'violin', size: '1/2' },
  { instrument_type: 'violin', size: '3/4' },
  { instrument_type: 'violin', size: '4/4' },
  { instrument_type: 'cello', size: '1/4' },
  { instrument_type: 'cello', size: '1/2' },
  { instrument_type: 'cello', size: '3/4' },
  { instrument_type: 'cello', size: '4/4' },
];

export type Role = 'owner' | 'parent' | 'director' | 'tech';

export type ContractStatus =
  | 'reserved'
  | 'agreement_sent'
  | 'signed'
  | 'active'
  | 'expired'
  | 'exchanged'
  | 'paid_off'
  | 'returned'
  | 'written_off';

export const OPEN_STATUSES: ReadonlyArray<ContractStatus> = ['reserved', 'agreement_sent', 'signed', 'active'];

export type DeliveryStatus = 'no_instrument' | 'awaiting_agreement' | 'scheduled' | 'delivered' | 'owned';

export const DELIVERY_STATUS_ORDER: ReadonlyArray<DeliveryStatus> = [
  'no_instrument',
  'awaiting_agreement',
  'scheduled',
  'delivered',
  'owned',
];

export type InstrumentStatus = 'available' | 'on_contract' | 'sold' | 'retired';

export type ConditionKind = 'checkout' | 'exchange' | 'return';

export type ReversalReason = 'returned_check' | 'chargeback' | 'entered_in_error';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  family_id: string | null;
  school_id: string | null;
}

export interface Tier {
  from_month: number;
  to_month: number | null;
  percent: number;
  name: string;
  label: string;
}

export interface PriceListItem {
  instrument_type: InstrumentType;
  base_rent_cents: number;
  waiver_cents: number;
  purchase_price_cents: number;
}

export interface PriceList {
  id: string;
  effective_date: string;
  created_at: string;
  withdrawn_at: string | null;
  tax_rate_bp: number;
  items: PriceListItem[];
  tiers: Tier[];
}

export interface ContractTerms {
  price_list_id: string;
  bound: boolean;
  base_rent_cents: number;
  waiver_cents: number;
  purchase_price_cents: number;
  tax_rate_bp: number;
  term_months: number;
  tiers: Tier[];
}

export interface HistoryEntry {
  from: string | null;
  to: string;
  at: string;
  actor: 'owner' | 'parent' | 'system';
  actor_name: string | null;
}

export interface SigningLinkState {
  status: 'none' | 'live' | 'revoked' | 'used' | 'expired';
  expires_at: string | null;
}

export interface Contract {
  id: string;
  status: ContractStatus;
  student: { id: string; name: string; grade: number };
  school: { id: string; name: string };
  family_id: string;
  instrument: {
    serial: string;
    instrument_type: InstrumentType;
    size: Size;
    model: string;
    label: string;
  };
  waiver: boolean;
  terms: ContractTerms;
  equity_cents: number;
  contract_month: number;
  delivery_date: string | null;
  hold_expires_at: string | null;
  signing_link: SigningLinkState;
  agreement_stored: boolean;
  bill_of_sale_stored: boolean;
  subscription_state: 'active' | 'cancelled' | null;
  signed_at: string | null;
  activated_at: string | null;
  closed_at: string | null;
  billing_anchor_date: string | null;
  next_billing_date: string | null;
  predecessor_id: string | null;
  successor_id: string | null;
  history: HistoryEntry[];
}

export interface ContractSummary {
  id: string;
  status: ContractStatus;
  student_name: string;
  instrument_label: string;
  serial: string;
  equity_cents: number;
  delivery_date: string | null;
}

export interface Quote {
  contract_id: string;
  month: number;
  term_months: number;
  paid: boolean;
  equity_cents: number;
  remaining_cents: number;
  tier: { label: string; percent: number };
  discount_cents: number;
  payoff_cents: number;
  tax_cents: number;
  total_cents: number;
  valid_until: string;
}

export interface InvoiceLine {
  code: 'base_rent' | 'waiver' | 'sales_tax';
  label: string;
  amount_cents: number;
}

export interface Invoice {
  contract_id: string;
  price_list_id: string;
  billing_date: string | null;
  upcoming_billing_dates: string[];
  tax_rate_bp: number;
  lines: InvoiceLine[];
  total_cents: number;
}

export type EquityKind = 'opening' | 'payment' | 'reversal' | 'exchange_out' | 'exchange_in' | 'buyout';

export interface EquityEntry {
  id: string;
  kind: EquityKind;
  amount_cents: number;
  transfer_id: string | null;
  payment_id: string | null;
  reversed: boolean | null;
  created_at: string;
}

export interface EquityStatement {
  equity_cents: number;
  purchase_price_cents: number;
  contract_month: number;
  closed: boolean;
  entries: EquityEntry[];
}

export interface Payment {
  id: string;
  amount_cents: number;
  base_rent_cents: number;
  waiver_cents: number;
  tax_cents: number;
  killbill_payment_id: string;
  created_at: string;
}

export interface Reversal {
  id: string;
  payment_id: string;
  reason: ReversalReason;
  amount_cents: number;
  base_rent_cents: number;
  waiver_cents: number;
  tax_cents: number;
  killbill_refund_id: string;
  created_at: string;
}

export interface School {
  id: string;
  name: string;
  delivery_weekday: number;
  next_delivery_date: string | null;
  cutoff_at: string | null;
  upcoming_delivery_days: Array<{ date: string; cutoff_at: string }>;
}

export interface AvailabilityItem {
  instrument_type: InstrumentType;
  size: Size;
  available: number;
}

export interface FleetInstrument {
  index: number;
  serial: string;
  instrument_type: InstrumentType;
  size: Size;
  model: string;
  label: string;
  status: InstrumentStatus;
  contract_id: string | null;
  school_name: string | null;
}

export interface RosterRow {
  student_id: string;
  student_name: string;
  grade: number;
  instrument_type: InstrumentType | null;
  size: Size | null;
  serial: string | null;
  delivery_date: string | null;
  delivery_status: DeliveryStatus;
}

export interface RosterResponse {
  school: { id: string; name: string; delivery_weekday: number };
  next_delivery_date: string | null;
  counts: Record<DeliveryStatus, number>;
  students: RosterRow[];
}

export interface FamilyResponse {
  family: { id: string; parent_name: string; email: string };
  totals: { open_contracts: number; equity_cents: number; owned: number };
  students: Array<{
    id: string;
    name: string;
    grade: number;
    school: { id: string; name: string };
    contracts: ContractSummary[];
  }>;
}

export interface ConditionPhoto {
  id: string;
  url: string;
}

export interface ConditionEvent {
  id: string;
  kind: ConditionKind;
  notes: string | null;
  recorded_by: string;
  created_at: string;
  photos: ConditionPhoto[];
}

export interface Agreement {
  contract_id: string;
  student_name: string;
  school_name: string;
  instrument_label: string;
  serial: string;
  waiver: boolean;
  terms: ContractTerms;
  link_expires_at: string;
  status: 'agreement_sent';
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
  fields?: Record<string, string>;
  alternatives?: AvailabilityItem[];
  quote?: Quote;
  photo_index?: number;
}
