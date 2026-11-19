// The API's JSON objects, as the brief defines them.

export type SeatState = "on_sale" | "held" | "sold" | "offered" | "not_on_sale";
export type TicketStatus = "payment_pending" | "issued" | "exchange_pending" | "refund_pending" | "refunded";
export type OrderStatus = "pending_payment" | "paid" | "partially_refunded" | "refunded" | "cancelled";
export type EntryStatus = "waiting" | "offered" | "accepted" | "declined" | "expired";
export type OfferStatus = "open" | "accepted" | "declined" | "expired";

export interface Tier {
  id: string;
  name: string;
  faceCents: number;
  seatFeeCents: number;
  remaining: number;
  waitlistLength: number;
}

export interface OwnerTier extends Tier {
  onSale: number;
  held: number;
  sold: number;
  offered: number;
}

export interface Performance<T extends Tier = Tier> {
  id: string;
  title: string;
  startsAt: string;
  startsAtVenue: string;
  salesOpen: boolean;
  changesOpen: boolean;
  tiers: T[];
}

export interface Seat {
  id: string;
  section: string;
  row: string;
  number: number;
  label: string;
  tierId: string | null;
  state: SeatState;
  mine: boolean;
  offCentreDeg: number;
  stageDistanceM: number;
}

interface CartLine {
  seatId: string;
  label: string;
  tierId: string;
  tierName: string;
  faceCents: number;
  seatFeeCents: number;
}

export interface Cart {
  performanceId: string;
  seats: CartLine[];
  faceCents: number;
  seatFeesCents: number;
  orderFeeCents: number;
  totalCents: number;
  expiresAt: string | null;
  secondsLeft: number | null;
}

export interface Ticket {
  id: string;
  seatId: string;
  label: string;
  tierName: string;
  faceCents: number;
  seatFeeCents: number;
  status: TicketStatus;
}

export interface Order {
  id: string;
  performanceId: string;
  performanceTitle: string;
  startsAtVenue: string;
  name: string;
  email: string;
  status: OrderStatus;
  tickets: Ticket[];
  faceCents: number;
  seatFeesCents: number;
  orderFeeCents: number;
  totalCents: number;
  netPaidCents: number;
  receipt: "queued" | "sent" | null;
  createdAt: string;
}

export interface OwnerOrder extends Order {
  killbillAccountId: string | null;
  killbillPaymentIds: string[];
}

export interface Offer {
  token: string;
  performanceId: string;
  seatId: string;
  label: string;
  tierName: string;
  faceCents: number;
  seatFeeCents: number;
  orderFeeCents: number;
  totalCents: number;
  status: OfferStatus;
  expiresAt: string;
  secondsLeft: number;
}

export interface Entry {
  id: string;
  performanceId: string;
  tierId: string;
  tierName: string;
  position: number | null;
  status: EntryStatus;
  offer: Offer | null;
}

export interface OutboxMessage {
  id: string;
  to: string;
  subject: string;
  kind: "receipt" | "offer" | "exchange" | "refund";
  status: "queued" | "sent";
  attempts: number;
  createdAt: string;
  sentAt: string | null;
}

export interface ApiError {
  error: string;
  fields?: Record<string, string>;
  taken?: string[];
  cart?: Cart;
}

/** Messages the server pushes on `GET /api/events`. */
export type LiveEvent =
  | { type: "seats"; performanceId: string }
  | { type: "performances" }
  | { type: "buyer" }
  | { type: "hold_ended"; performanceId: string; expiresAt: string }
  | { type: "offer"; token: string; label: string }
  | { type: "offer_closed"; token: string; byThisBrowser: boolean }
  | { type: "outbox" };
