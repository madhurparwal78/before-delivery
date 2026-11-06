// The API shapes the client reads.
import type { BatchState, Cadence, StaffRole } from '../shared/catalog.js';
import type { Money, TaxLine } from '../shared/money.js';

export type BarStatus = 'available' | 'held' | 'sold';

export interface Batch {
  code: string;
  scent: string;
  state: BatchState;
  bars_cut: number;
  available: number;
  held: number;
  sold: number;
  bars: { number: number; status: BarStatus }[];
  unit_price: Money;
  cure_date: string;
  drop_at: string | null;
  drop_at_local: string | null;
}

export interface StaffBatch extends Batch {
  poured_on: string;
  cure_days: number;
  holds: { bar: number; expires_at: string }[];
}

export interface Hold {
  id: string;
  batch: string;
  bar: number;
  status: string;
  created_at: string;
  expires_at: string;
  amount: Money;
}

export interface Cart {
  server_now: string;
  holds: Hold[];
  batches: { code: string; available: number; held: number; sold: number }[];
  province: string;
  subtotal: Money;
  shipping_fee: Money;
  taxes: TaxLine[];
  total: Money;
}

export interface Shipping {
  name: string;
  line1: string;
  city: string;
  province: string;
  postal_code: string;
}

export interface Order {
  number: string;
  status: 'paid' | 'partially_refunded' | 'refunded';
  fulfilment: 'to_pack' | 'shipped';
  placed_at: string;
  ship_on: string;
  locale: string;
  email: string;
  shipping: Shipping;
  lines: { batch: string; scent: string; bar: number; unit_price: Money; refunded: boolean }[];
  subtotal: Money;
  shipping_fee: Money;
  taxes: TaxLine[];
  total: Money;
  refunded: Money;
  version: number;
}

export interface Refund {
  number: string;
  status: string;
  bars: { batch: string; bar: number }[];
  amount: Money;
  allocation: { bars: Money; shipping: Money; taxes: TaxLine[] };
  reason: string;
}

export interface Credit {
  number: string;
  target: string;
  status: string;
  amount: Money;
  reason: string;
  created_at: string;
}

export interface StaffOrder extends Order {
  refunds: Refund[];
  credits: Credit[];
}

export interface Subscription {
  number: string;
  state: 'active' | 'paused' | 'cancelled';
  scent: string;
  cadence: Cadence;
  pending_cadence: Cadence | null;
  started_on: string;
  next_bill_date: string | null;
  skipped_bill_date: string | null;
  paused_from: string | null;
  locks_at: string | null;
  locked: boolean;
  shipping: Shipping;
  price: { subtotal: Money; discount: Money; pre_tax: Money; taxes: TaxLine[]; total: Money };
  version: number;
}

export interface StaffSubscription extends Subscription {
  email: string;
  credits: Credit[];
}

export interface Account {
  customer: { email: string; locale: string };
  orders: { number: string; placed_at: string; total: Money; status: Order['status'] }[];
  subscriptions: { number: string; state: Subscription['state']; scent: string; cadence: Cadence; next_bill_date: string | null }[];
}

export interface StaffMember {
  email: string;
  name: string;
  role: StaffRole;
}

export interface PackingOrder {
  number: string;
  ship_on: string;
  name: string;
  address: { line1: string; city: string; province: string; postal_code: string };
  bars: { batch: string; scent: string; bar: number }[];
}

export interface ReconLine {
  key: string;
  kind: string;
  shop: Money | null;
  killbill: Money | null;
  status: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  role: string;
  action: string;
  target: string;
  reason: string;
  amount: Money;
  killbill_ref: string | null;
  outcome: string;
}

export interface Notice {
  number: string;
  key: string;
  kind: string;
  to: string;
  subject: string;
  status: string;
  enqueued_at: string;
  attempts: { at: string; outcome: string }[];
}

