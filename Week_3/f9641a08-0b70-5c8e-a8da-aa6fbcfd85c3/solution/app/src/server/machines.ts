import type { CaseKind, OrderStatus } from "../shared/api";
import { CLAIM_STATUS_WORDS, RETURN_STATUS_WORDS, TRIAL_STATUS_WORDS } from "../shared/format";

// The status machines, defined once: orders, returns, trial returns and warranty claims.

const CASE_MOVES: Record<CaseKind, Record<string, string[]>> = {
  return: {
    requested: ["approved", "rejected"],
    approved: ["in_transit"],
    in_transit: ["received"],
    received: ["inspected"],
    inspected: ["refunded", "exchanged"],
  },
  trial: {
    requested: ["approved", "rejected"],
    approved: ["returned"],
    returned: ["refunded"],
  },
  claim: {
    submitted: ["under_review"],
    under_review: ["approved", "rejected"],
    approved: ["repair", "replacement"],
    repair: ["resolved"],
    replacement: ["resolved"],
  },
};

export const CASE_WORDS: Record<CaseKind, Record<string, string>> = {
  return: RETURN_STATUS_WORDS,
  trial: TRIAL_STATUS_WORDS,
  claim: CLAIM_STATUS_WORDS,
};

export function knownCaseStatus(kind: CaseKind, status: string): boolean {
  return status in CASE_WORDS[kind];
}

export function canMoveCase(kind: CaseKind, from: string, to: string): boolean {
  return CASE_MOVES[kind][from]?.includes(to) ?? false;
}

export const CASE_NUMBER_PREFIX: Record<CaseKind, string> = { return: "RT", trial: "TR", claim: "WC" };

const ORDER_MOVES: Record<OrderStatus, OrderStatus[]> = {
  placed: ["packed", "cancelled"],
  packed: ["partially_shipped", "shipped", "cancelled"],
  partially_shipped: ["shipped"],
  shipped: ["out_for_delivery"],
  out_for_delivery: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function canMoveOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_MOVES[from].includes(to);
}

/** The statuses the status endpoint accepts; shipments reach the shipped states. */
export const STAFF_ORDER_TARGETS: OrderStatus[] = ["packed", "out_for_delivery", "delivered", "cancelled"];

export const RETURN_REASONS = ["Changed my mind", "Wrong size", "Colour not as expected", "Arrived damaged", "Other"];
export const CLAIM_COMPONENTS = ["Wheels", "Handle", "Shell", "Zipper", "Lock"];
