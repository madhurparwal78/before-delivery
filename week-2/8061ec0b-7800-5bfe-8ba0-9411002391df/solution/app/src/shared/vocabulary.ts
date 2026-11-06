// The brief's words: instrument types and sizes, labels, and the status words every screen shows.

export const INSTRUMENT_TYPES = ["flute", "clarinet", "trumpet", "violin", "cello"] as const;
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

export const STRING_SIZES = ["1/4", "1/2", "3/4", "4/4"] as const;
export type Size = "full" | (typeof STRING_SIZES)[number];

export function isInstrumentType(value: unknown): value is InstrumentType {
  return typeof value === "string" && (INSTRUMENT_TYPES as readonly string[]).includes(value);
}

export function isStringInstrument(type: InstrumentType): boolean {
  return type === "violin" || type === "cello";
}

export function sizesFor(type: InstrumentType): readonly Size[] {
  return isStringInstrument(type) ? STRING_SIZES : ["full"];
}

export function isSizeFor(type: InstrumentType, size: unknown): size is Size {
  return typeof size === "string" && (sizesFor(type) as readonly string[]).includes(size);
}

/** Type and size pairs in the order the availability listing publishes. */
export const AVAILABILITY_ORDER: readonly { instrument_type: InstrumentType; size: Size }[] =
  INSTRUMENT_TYPES.flatMap((instrument_type) => sizesFor(instrument_type).map((size) => ({ instrument_type, size })));

/** "Cello": the instrument name with a capital first letter. */
export function instrumentName(type: InstrumentType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** "Full size" for flute, clarinet and trumpet; the fraction for strings. */
export function sizeWord(size: Size): string {
  return size === "full" ? "Full size" : size;
}

/** "1/2 Cello" for strings, "Trumpet" for winds. */
export function instrumentLabel(type: InstrumentType, size: Size): string {
  return size === "full" ? instrumentName(type) : `${size} ${instrumentName(type)}`;
}

export const CONTRACT_STATUSES = ["reserved", "agreement_sent", "signed", "active", "exchanged", "paid_off", "returned",
  "written_off", "expired"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const OPEN_CONTRACT_STATUSES: readonly ContractStatus[] = ["reserved", "agreement_sent", "signed", "active"];

export const CONTRACT_STATUS_WORDS: Record<ContractStatus, string> = {
  reserved: "Reserved", agreement_sent: "Agreement sent", signed: "Signed", active: "Active", exchanged: "Exchanged",
  paid_off: "Owned", returned: "Returned", written_off: "Written off", expired: "Expired",
};

export type InstrumentStatus = "available" | "on_contract" | "sold" | "retired";

export const INSTRUMENT_STATUS_WORDS: Record<InstrumentStatus, string> = {
  available: "Available", on_contract: "On contract", sold: "Sold", retired: "Retired",
};

/** Roster statuses in the order of the roster status table. */
export const DELIVERY_STATUSES = ["no_instrument", "awaiting_agreement", "scheduled", "delivered", "owned"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_STATUS_WORDS: Record<DeliveryStatus, string> = {
  no_instrument: "No instrument", awaiting_agreement: "Awaiting agreement", scheduled: "Scheduled for delivery",
  delivered: "Delivered", owned: "Owned",
};

export const REVERSAL_REASONS = ["returned_check", "chargeback", "entered_in_error"] as const;
export type ReversalReason = (typeof REVERSAL_REASONS)[number];

export const REVERSAL_REASON_WORDS: Record<ReversalReason, string> = {
  returned_check: "Returned check", chargeback: "Chargeback", entered_in_error: "Entered in error",
};

export const CONDITION_KINDS = ["checkout", "exchange", "return"] as const;
export type ConditionKind = (typeof CONDITION_KINDS)[number];

export const CONDITION_KIND_WORDS: Record<ConditionKind, string> = {
  checkout: "Check-out", exchange: "Exchange", return: "Return",
};

export type LedgerKind = "opening" | "payment" | "reversal" | "exchange_out" | "exchange_in" | "buyout";

/** The Entry column wording of an equity ledger row. */
export function ledgerEntryText(entry: { kind: LedgerKind; payment_id: string | null; reversed: boolean | null },
  links: { predecessor_id: string | null; successor_id: string | null }): string {
  switch (entry.kind) {
    case "opening": return "Opening balance";
    case "payment": return `Payment ${entry.payment_id}${entry.reversed ? " (reversed)" : ""}`;
    case "reversal": return `Reversal of ${entry.payment_id}`;
    case "exchange_out": return `Exchange out to ${links.successor_id}`;
    case "exchange_in": return `Exchange in from ${links.predecessor_id}`;
    case "buyout": return "Buyout";
  }
}
