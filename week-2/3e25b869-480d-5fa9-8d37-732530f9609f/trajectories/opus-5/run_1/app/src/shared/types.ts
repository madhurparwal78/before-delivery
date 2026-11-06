export type Locale = 'fr-CA' | 'en-CA';

export function isLocale(value: string): value is Locale {
  return value === 'fr-CA' || value === 'en-CA';
}

export type Money = { cents: number; currency: 'CAD' };

export type TaxCode = 'GST' | 'QST' | 'HST';

export type TaxLine = { code: TaxCode; rate: string; amount: Money };

export type Cadence = 'MONTHLY' | 'BIMESTRIAL' | 'QUARTERLY';

export type ProvinceCode =
  | 'AB'
  | 'BC'
  | 'MB'
  | 'NB'
  | 'NL'
  | 'NS'
  | 'NT'
  | 'NU'
  | 'ON'
  | 'PE'
  | 'QC'
  | 'SK'
  | 'YT';

export type BatchState = 'poured' | 'curing' | 'scheduled' | 'live' | 'sold_out' | 'withdrawn';

export type BarStatus = 'available' | 'held' | 'sold';

export type HoldStatus = 'active' | 'converted' | 'expired' | 'released';

export type OrderStatus = 'paid' | 'partially_refunded' | 'refunded';

export type Fulfilment = 'to_pack' | 'shipped';

export type SubscriptionState = 'active' | 'paused' | 'cancelled';

export type StaffRole = 'maker' | 'finance' | 'packing';

export type ContactTopic = 'order' | 'subscription' | 'wholesale' | 'other';

export type NoticeKind =
  | 'stepup_code'
  | 'order_confirmation'
  | 'subscription_started'
  | 'refund'
  | 'credit'
  | 'contact_reply';

export type NoticeStatus = 'queued' | 'retrying' | 'sent' | 'failed';

export type ReconciliationKind = 'order' | 'subscription' | 'credit' | 'payment';

export type ReconciliationStatus =
  | 'match'
  | 'mismatch'
  | 'shop_only'
  | 'kb_only'
  | 'accepted'
  | 'refunded';

export type AuditAction = 'refund' | 'credit' | 'reconciliation_accept' | 'orphan_refund';

export type ShippingAddress = {
  name: string;
  line1: string;
  city: string;
  province: ProvinceCode;
  postal_code: string;
};

export type Bar = { number: number; status: BarStatus };

export type Batch = {
  code: string;
  scent: string;
  state: BatchState;
  bars_cut: number;
  available: number;
  held: number;
  sold: number;
  bars: Bar[];
  unit_price: Money;
  cure_date: string;
  drop_at: string | null;
  drop_at_local: string | null;
};

export type StaffBatch = Batch & {
  poured_on: string;
  cure_days: number;
  holds: { bar: number; expires_at: string }[];
};

export type Hold = {
  id: string;
  batch: string;
  bar: number;
  status: HoldStatus;
  created_at: string;
  expires_at: string;
  amount: Money;
};

export type Cart = {
  server_now: string;
  holds: Hold[];
  batches: { code: string; available: number; held: number; sold: number }[];
  province: ProvinceCode;
  subtotal: Money;
  shipping_fee: Money;
  taxes: TaxLine[];
  total: Money;
};

export type OrderLine = {
  batch: string;
  scent: string;
  bar: number;
  unit_price: Money;
  refunded: boolean;
};

export type Order = {
  number: string;
  status: OrderStatus;
  fulfilment: Fulfilment;
  placed_at: string;
  ship_on: string;
  locale: Locale;
  email: string;
  shipping: ShippingAddress;
  lines: OrderLine[];
  subtotal: Money;
  shipping_fee: Money;
  taxes: TaxLine[];
  total: Money;
  refunded: Money;
  version: number;
};

export type SubscriptionPrice = {
  subtotal: Money;
  discount: Money;
  pre_tax: Money;
  taxes: TaxLine[];
  total: Money;
};

export type Subscription = {
  number: string;
  state: SubscriptionState;
  scent: string;
  cadence: Cadence;
  pending_cadence: Cadence | null;
  started_on: string;
  next_bill_date: string | null;
  skipped_bill_date: string | null;
  paused_from: string | null;
  locks_at: string | null;
  locked: boolean;
  shipping: ShippingAddress;
  price: SubscriptionPrice;
  version: number;
};

export type RefundAllocation = { bars: Money; shipping: Money; taxes: TaxLine[] };

export type Refund = {
  number: string;
  order: string;
  status: 'requested' | 'issued' | 'failed';
  bars: { batch: string; bar: number }[];
  restock: boolean;
  amount: Money;
  allocation: RefundAllocation;
  reason: string;
  killbill_ref: string | null;
  created_at: string;
};

export type Credit = {
  number: string;
  target: string;
  status: 'issued' | 'failed';
  amount: Money;
  reason: string;
  killbill_ref: string | null;
  created_at: string;
};

export type AuditEntry = {
  id: number;
  at: string;
  actor: string;
  role: StaffRole;
  action: AuditAction;
  target: string;
  reason: string;
  amount: Money;
  killbill_ref: string | null;
  outcome: 'issued' | 'failed';
};

export type Notice = {
  number: string;
  key: string;
  kind: NoticeKind;
  to: string;
  locale: Locale;
  subject: string;
  status: NoticeStatus;
  enqueued_at: string;
  attempts: { at: string; outcome: 'sent' | 'failed' }[];
};

export type ReconciliationLine = {
  key: string;
  kind: ReconciliationKind;
  shop: Money | null;
  killbill: Money | null;
  status: ReconciliationStatus;
};

export type PackingOrder = {
  number: string;
  ship_on: string;
  name: string;
  address: { line1: string; city: string; province: ProvinceCode; postal_code: string };
  bars: { batch: string; scent: string; bar: number }[];
  fulfilment: Fulfilment;
  version: number;
};

export type OrderSummary = {
  number: string;
  placed_at: string;
  total: Money;
  status: OrderStatus;
};

export type SubscriptionSummary = {
  number: string;
  state: SubscriptionState;
  scent: string;
  cadence: Cadence;
  next_bill_date: string | null;
};

export type ServiceStatus = {
  billing: 'up' | 'down';
  mail: 'up' | 'down';
  checked_at: string;
};

export type ApiErrorBody = {
  error: { code: string; message: string; fields?: Record<string, string> };
};
