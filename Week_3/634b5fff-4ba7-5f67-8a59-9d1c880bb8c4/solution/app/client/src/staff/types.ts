import type { BoxState, PaymentState, Plate, Role } from "../../../shared/domain.js";

/** The shapes of the staff API replies, as the brief publishes them. */

export interface Me {
  username: string;
  roles: Role[];
}

export interface Address {
  street: string;
  postcode: string;
  city: string;
}

export interface PackerOrder {
  reference: string;
  number: number;
  plate: Plate;
  recipientName: string;
  address: Address;
  boxState: BoxState;
  paymentState: PaymentState;
  trackingCode: string | null;
}

export interface StaffHit {
  number: number;
  plate: Plate;
  state: BoxState;
  recipientName: string | null;
  reference: string | null;
}

export interface DeadLetter {
  eventId: string;
  type: string;
  reference: string;
  boxNumber: number;
  failedAt: string;
  lastError: string;
}

export interface LedgerOrder {
  reference: string;
  number: number;
  paymentState: PaymentState;
  boxState: BoxState;
  grossOre: number;
  rateBasisPoints: number;
}

interface SplitLine {
  kind: "sale" | "refund";
  grossOre: number;
  netOre: number;
  vatOre: number;
  charityOre: number;
  makerOre: number;
  settledAt: string;
}

interface LedgerTotals {
  grossOre: number;
  netOre: number;
  vatOre: number;
  charityOre: number;
  makerOre: number;
}

export interface Ledger {
  reference: string;
  rateBasisPoints: number;
  grossOre: number;
  courierOre: number;
  totalOre: number;
  lines: SplitLine[];
  totals: LedgerTotals;
  gatewayFeeOre: number;
  makerAfterFeesOre: number;
  refunds: { refundId: string; state: "pending" | "settled"; amountOre: number }[];
  killbill: {
    invoiceId: string;
    items: { description: string; amountOre: number }[];
    transactions: { type: string; amountOre: number }[];
  } | null;
}

export interface Refund {
  refundId: string;
  state: "pending" | "settled";
}

export interface Rate {
  rateBasisPoints: number;
  effectiveFrom: string;
}

export interface Statement {
  id: string;
  month: string;
  revision: number;
  charityTotalOre: number;
  makerTotalOre: number;
  vatTotalOre: number;
  pdfUrl: string;
  issuedAt: string;
}

export interface Delivery {
  eventId: string;
  eventType: string;
  status: "delivered" | "retrying" | "failed";
  attempts: number;
  lastStatusCode: number | null;
}

export interface Stock {
  remaining: number;
  thresholds: number[];
}
