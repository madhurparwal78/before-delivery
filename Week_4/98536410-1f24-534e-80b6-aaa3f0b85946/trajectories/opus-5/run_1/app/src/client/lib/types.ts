export type DisplayState = 'open' | 'closing_soon' | 'closed' | 'stock_critical' | 'suspended';

export type Store = {
  id: string;
  name: string;
  city: string;
  region: string;
  lat: number;
  lon: number;
  timezone: string;
  vat_rate: number;
  display_state: DisplayState;
  state_label: string;
  suspended: boolean;
  suspension_reason: string | null;
  closes_local: string | null;
  critical_lines: number;
};

export type StoreList = { count: number; stores: Store[] };

export type DayEntry = {
  weekday: number;
  open: boolean;
  opens: string | null;
  closes: string | null;
};

export type Hours = {
  store_id: string;
  timezone: string;
  local_today: string;
  days: DayEntry[];
  upcoming: { effective_from: string; days: DayEntry[] } | null;
};

export type Slot = {
  start_local: string;
  start_utc: string;
  utc_offset: string;
  remaining: 0 | 1 | 2;
};

export type DayPlan = {
  store_id: string;
  date: string;
  timezone: string;
  open: boolean;
  opens_local: string | null;
  closes_local: string | null;
  slots: Slot[];
};

export type SlotDays = { store_id: string; timezone: string; days: { date: string; slots: Slot[] }[] };

export type Product = { sku: string; name: string; unit_price_milli: number };

export type Availability = {
  sku: string;
  shops: {
    store_id: string;
    name: string;
    city: string;
    distance_km: number;
    on_hand: number;
    held: number;
    available: number;
    display_state: DisplayState;
    holdable: boolean;
  }[];
};

export type Hold = {
  id: string;
  status: 'active' | 'released' | 'converted';
  store_id: string;
  lines: { sku: string; quantity: number }[];
  created_at: string;
  expires_at: string;
  seconds_left: number;
  released_at: string | null;
};

export type CartLine = {
  sku: string;
  name: string;
  quantity: number;
  unit_price_milli: number;
  line_total_cents: number;
  vat_cents: number | null;
  available: number | null;
  status: 'ok' | 'short';
};

export type Cart = {
  store_id: string | null;
  store_name: string | null;
  area: { lat: number; lon: number } | null;
  lines: CartLine[];
  total_cents: number;
  vat_cents: number | null;
  units: number;
  hold: Hold | null;
};

export type CartShops = {
  shops: { store_id: string; name: string; distance_km: number; complete: boolean }[];
};

export type OrderStatus = 'placed' | 'picking' | 'ready' | 'collected' | 'cancelled';

export type Order = {
  id: string;
  number: string;
  status: OrderStatus;
  store_id: string;
  store_name: string;
  timezone: string;
  slot_start_utc: string;
  slot_local_date: string;
  slot_local_time: string;
  customer: { name: string; email: string };
  lines: {
    sku: string;
    name: string;
    quantity: number;
    unit_price_milli: number;
    line_total_cents: number;
    vat_rate: number;
    vat_cents: number;
    returned_quantity: number;
  }[];
  total_cents: number;
  vat_cents: number;
  refunded_cents: number;
  created_at: string;
};

export type OrderSummary = {
  id: string;
  number: string;
  status: OrderStatus;
  store_id: string;
  store_name: string;
  slot_start_utc: string;
  total_cents: number;
  customer_email: string;
  created_at: string;
};

export type OrderPage = { count: number; orders: OrderSummary[]; next_before: string | null };

export type ReturnStatus = 'requested' | 'received' | 'settled' | 'declined';

export type ReturnRecord = {
  id: string;
  number: string;
  order_id: string;
  status: ReturnStatus;
  lines: { sku: string; quantity: number; refund_cents: number }[];
  refund_cents: number;
  reason: string;
  created_at: string;
};

export type StockLine = {
  sku: string;
  name: string;
  on_hand: number;
  held: number;
  available: number;
  critical: boolean;
};

export type HistoryEvent = {
  seq: number;
  type: string;
  at: string;
  data: Record<string, unknown>;
  digest: string;
};

export type ReviewEvent = {
  seq: number;
  at: string;
  order_id: string;
  order_number: string;
  store_id: string;
  type: string;
};

export type Review = { window_start: string; window_end: string; events: ReviewEvent[] };

export type StorageState = { storage: 'up' | 'down'; checked_at: string };
