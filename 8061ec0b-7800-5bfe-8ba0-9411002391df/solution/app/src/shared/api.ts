// The JSON bodies the API publishes, shared by the server's serialisers and the browser.

import type { ConditionKind, ContractStatus, DeliveryStatus, InstrumentStatus, InstrumentType, LedgerKind,
  ReversalReason, Size } from "./vocabulary.js";

export type Role = "owner" | "parent" | "director" | "tech";

export interface User {
  id: string; name: string; email: string; role: Role; family_id: string | null; school_id: string | null;
}

export interface Tier { from_month: number; to_month: number | null; percent: number; name: string; label: string }

export interface HistoryEntry {
  from: ContractStatus | null; to: ContractStatus; at: string; actor: "owner" | "parent" | "system";
  actor_name: string | null;
}

export interface Terms {
  price_list_id: string; bound: boolean; base_rent_cents: number; waiver_cents: number;
  purchase_price_cents: number; tax_rate_bp: number; term_months: number; tiers: Tier[];
}

export interface Contract {
  id: string; status: ContractStatus;
  student: { id: string; name: string; grade: number };
  school: { id: string; name: string };
  family_id: string;
  instrument: { serial: string; instrument_type: InstrumentType; size: Size; model: string; label: string };
  waiver: boolean; terms: Terms; equity_cents: number; contract_month: number; delivery_date: string;
  hold_expires_at: string | null;
  signing_link: { status: "none" | "live" | "revoked" | "used" | "expired"; expires_at: string | null };
  agreement_stored: boolean; bill_of_sale_stored: boolean; subscription_state: "active" | "cancelled" | null;
  signed_at: string | null; activated_at: string | null; closed_at: string | null;
  billing_anchor_date: string | null; next_billing_date: string | null;
  predecessor_id: string | null; successor_id: string | null; history: HistoryEntry[];
}

export interface ContractSummary {
  id: string; status: ContractStatus; student_name: string; instrument_label: string; serial: string;
  equity_cents: number; delivery_date: string;
}

export interface Quote {
  contract_id: string; month: number; term_months: number; paid: boolean; equity_cents: number;
  remaining_cents: number; tier: { label: string; percent: number }; discount_cents: number; payoff_cents: number;
  tax_cents: number; total_cents: number; valid_until: string;
}

export interface PriceListItem {
  instrument_type: InstrumentType; base_rent_cents: number; waiver_cents: number; purchase_price_cents: number;
}

export interface PriceList {
  id: string; effective_date: string; created_at: string; withdrawn_at: string | null; tax_rate_bp: number;
  items: PriceListItem[]; tiers: Tier[];
}

export interface DeliveryDay { date: string; cutoff_at: string }

export interface School {
  id: string; name: string; delivery_weekday: number; next_delivery_date: string; cutoff_at: string;
  upcoming_delivery_days: DeliveryDay[];
}

export interface Payment {
  id: string; amount_cents: number; base_rent_cents: number; waiver_cents: number; tax_cents: number;
  killbill_payment_id: string; created_at: string;
}

export interface Reversal {
  id: string; payment_id: string; reason: ReversalReason; amount_cents: number; base_rent_cents: number;
  waiver_cents: number; tax_cents: number; killbill_refund_id: string; created_at: string;
}

export interface InvoiceLine { code: "base_rent" | "waiver" | "sales_tax"; label: string; amount_cents: number }

export interface Invoice {
  contract_id: string; price_list_id: string; billing_date: string | null; upcoming_billing_dates: string[];
  tax_rate_bp: number; lines: InvoiceLine[]; total_cents: number;
}

export interface EquityEntry {
  id: string; kind: LedgerKind; amount_cents: number; transfer_id: string | null; payment_id: string | null;
  reversed: boolean | null; created_at: string;
  /** The amount charged for a `payment` entry (the reversal dialog refunds it); null on every other entry. */
  payment_amount_cents: number | null;
}

export interface EquityStatement {
  equity_cents: number; purchase_price_cents: number; contract_month: number; closed: boolean;
  entries: EquityEntry[];
}

export interface Instrument {
  index: number; serial: string; instrument_type: InstrumentType; size: Size; model: string; label: string;
  status: InstrumentStatus; contract_id: string | null; school_name: string | null;
}

export interface AvailabilityItem { instrument_type: InstrumentType; size: Size; available: number }

export interface Family {
  id: string; parent_name: string; email: string; phone: string; address: string;
  students: { id: string; name: string; grade: number; school_id: string }[];
}

export interface FamilyOverview {
  family: { id: string; parent_name: string; email: string };
  totals: { open_contracts: number; equity_cents: number; owned: number };
  students: { id: string; name: string; grade: number; school: { id: string; name: string };
    contracts: ContractSummary[] }[];
}

export interface RosterRow {
  student_id: string; student_name: string; grade: number; instrument_type: InstrumentType | null;
  size: Size | null; serial: string | null; delivery_date: string | null; delivery_status: DeliveryStatus;
}

export interface Roster {
  school: { id: string; name: string; delivery_weekday: number }; next_delivery_date: string;
  counts: Record<DeliveryStatus, number>; students: RosterRow[];
}

export interface ConditionEvent {
  id: string; kind: ConditionKind; notes: string; recorded_by: string; created_at: string;
  photos: { id: string; url: string }[];
}

export interface SigningAgreement {
  contract_id: string; student_name: string; school_name: string; instrument_label: string; serial: string;
  waiver: boolean; terms: Terms; link_expires_at: string; status: "agreement_sent";
}

export interface ApiErrorBody {
  error: {
    code: string; message: string; fields?: Record<string, string>; alternatives?: AvailabilityItem[];
    quote?: Quote; photo_index?: number;
  };
}
