export type Role = "owner" | "parent" | "director" | "tech";
export type InstrumentType = "flute" | "clarinet" | "trumpet" | "violin" | "cello";
export type Size = "full" | "1/4" | "1/2" | "3/4" | "4/4";
export type ContractStatus =
  | "reserved"
  | "agreement_sent"
  | "signed"
  | "active"
  | "paid_off"
  | "exchanged"
  | "returned"
  | "written_off"
  | "expired";

export const INSTRUMENT_TYPES: InstrumentType[] = ["flute", "clarinet", "trumpet", "violin", "cello"];

export const SIZES_BY_TYPE: Record<InstrumentType, Size[]> = {
  flute: ["full"],
  clarinet: ["full"],
  trumpet: ["full"],
  violin: ["1/4", "1/2", "3/4", "4/4"],
  cello: ["1/4", "1/2", "3/4", "4/4"],
};

export const INSTRUMENT_NAMES: Record<InstrumentType, string> = {
  flute: "Flute",
  clarinet: "Clarinet",
  trumpet: "Trumpet",
  violin: "Violin",
  cello: "Cello",
};

export const SIZE_ORDER: Record<Size, number> = { "1/4": 0, "1/2": 1, "3/4": 2, "4/4": 3, full: 0 };

export function instrumentLabel(type: InstrumentType, size: Size): string {
  if (type === "violin" || type === "cello") return `${size} ${INSTRUMENT_NAMES[type]}`;
  return INSTRUMENT_NAMES[type];
}

export function visibleSize(type: InstrumentType, size: Size): string {
  if (type === "violin" || type === "cello") return size;
  return "Full size";
}

export type DeliveryStatus =
  | "no_instrument"
  | "awaiting_agreement"
  | "scheduled"
  | "delivered"
  | "owned";

export const DELIVERY_STATUS_ORDER: DeliveryStatus[] = [
  "no_instrument",
  "awaiting_agreement",
  "scheduled",
  "delivered",
  "owned",
];

export const DELIVERY_STATUS_WORDS: Record<DeliveryStatus, string> = {
  no_instrument: "No instrument",
  awaiting_agreement: "Awaiting agreement",
  scheduled: "Scheduled for delivery",
  delivered: "Delivered",
  owned: "Owned",
};

export const PRICE_LIST_STANDINGS = ["In force", "Scheduled", "Superseded", "Withdrawn"] as const;
export type PriceListStanding = (typeof PRICE_LIST_STANDINGS)[number];

export type Reason = "returned_check" | "chargeback" | "entered_in_error";

export const REASON_WORDS: Record<Reason, string> = {
  returned_check: "Returned check",
  chargeback: "Chargeback",
  entered_in_error: "Entered in error",
};

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

export interface HistoryEntry {
  from: string | null;
  to: string;
  at: string;
  actor: "owner" | "parent" | "system";
  actor_name: string | null;
}
