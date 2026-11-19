export type SeatState = 'on_sale' | 'held' | 'sold' | 'offered' | 'not_on_sale';

export type TicketStatus = 'payment_pending' | 'issued' | 'exchange_pending' | 'refund_pending' | 'refunded';

export type OrderStatus = 'pending_payment' | 'paid' | 'partially_refunded' | 'refunded' | 'cancelled';

export type EntryStatus = 'waiting' | 'offered' | 'accepted' | 'declined' | 'expired';

export type OfferStatus = 'open' | 'accepted' | 'declined' | 'expired';

export type ReceiptStatus = 'queued' | 'sent';

export type Tier = {
  id: string;
  name: string;
  faceCents: number;
  seatFeeCents: number;
  remaining: number;
  waitlistLength: number;
};

export type Performance = {
  id: string;
  title: string;
  startsAt: string;
  startsAtVenue: string;
  salesOpen: boolean;
  changesOpen: boolean;
  tiers: Tier[];
};

export type Seat = {
  id: string;
  section: 'ST' | 'CI' | 'BA';
  row: string;
  number: number;
  label: string;
  tierId: string | null;
  state: SeatState;
  mine: boolean;
  offCentreDeg: number;
  stageDistanceM: string;
};

export type CartLine = {
  seatId: string;
  label: string;
  tierId: string;
  tierName: string;
  faceCents: number;
  seatFeeCents: number;
};

export type Cart = {
  performanceId: string;
  seats: CartLine[];
  faceCents: number;
  seatFeesCents: number;
  orderFeeCents: number;
  totalCents: number;
  expiresAt: string | null;
  secondsLeft: number | null;
};

export type Ticket = {
  id: string;
  seatId: string;
  label: string;
  tierName: string;
  faceCents: number;
  seatFeeCents: number;
  status: TicketStatus;
};

export type Order = {
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
  receipt: ReceiptStatus | null;
  createdAt: string;
  killbillAccountId?: string;
  killbillPaymentIds?: string[];
};

export type Offer = {
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
};

export type Entry = {
  id: string;
  performanceId: string;
  tierId: string;
  tierName: string;
  position: number | null;
  status: EntryStatus;
  offer: Offer | null;
};

export type OutboxMessage = {
  id: number;
  to: string;
  subject: string;
  kind: 'receipt' | 'offer' | 'exchange' | 'refund';
  status: 'queued' | 'sent';
  attempts: number;
  createdAt: string;
  sentAt: string | null;
};
