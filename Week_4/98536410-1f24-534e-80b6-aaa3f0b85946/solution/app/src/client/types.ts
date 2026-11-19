// Shapes of the API answers the screens read.

import type { Role } from "../shared/routes";
import type { OrderStatus, ReturnStatus } from "../shared/transitions";

export type { Role };

export interface Me {
  user: { id: string; name: string; email: string; role: Role; operator_id: string };
  operator: { id: string; name: string };
  store_ids: string[];
  session_expires_at: string;
}

export type DisplayState = "open" | "closing_soon" | "closed" | "stock_critical" | "suspended";

export interface Shop {
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
}

export interface ShopList {
  count: number;
  stores: Shop[];
}

export interface StockLine {
  sku: string;
  name: string;
  on_hand: number;
  held: number;
  available: number;
  critical: boolean;
}

export interface Product {
  sku: string;
  name: string;
  unit_price_milli: number;
}

export interface AvailabilityShop {
  store_id: string;
  name: string;
  city: string;
  distance_km: number;
  on_hand: number;
  held: number;
  available: number;
  display_state: DisplayState;
  holdable: boolean;
}

export interface Hold {
  id: string;
  status: "active" | "released" | "converted";
  store_id: string;
  lines: { sku: string; quantity: number }[];
  created_at: string;
  expires_at: string;
  seconds_left: number;
  released_at: string | null;
}

interface CartLine {
  sku: string;
  name: string;
  quantity: number;
  unit_price_milli: number;
  line_total_cents: number;
  vat_cents: number | null;
  available: number | null;
  status: "ok" | "short";
}

export interface Cart {
  store_id: string | null;
  store_name: string | null;
  area: { lat: number; lon: number } | null;
  lines: CartLine[];
  total_cents: number;
  vat_cents: number | null;
  units: number;
  hold: Hold | null;
}

interface Slot {
  start_local: string;
  start_utc: string;
  utc_offset: string;
  remaining: number;
}

export interface SlotDay {
  date: string;
  slots: Slot[];
}

interface OrderLine {
  sku: string;
  name: string;
  quantity: number;
  unit_price_milli: number;
  line_total_cents: number;
  vat_rate: number;
  vat_cents: number;
  returned_quantity: number;
}

export interface Order {
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
  lines: OrderLine[];
  total_cents: number;
  vat_cents: number;
  refunded_cents: number;
  created_at: string;
}

export interface OrderRow {
  id: string;
  number: string;
  status: OrderStatus;
  store_id: string;
  store_name: string;
  slot_start_utc: string;
  total_cents: number;
  customer_email: string;
  created_at: string;
}

export interface OrderList {
  count: number;
  orders: OrderRow[];
  next_before: string | null;
}

export interface ReturnRecord {
  id: string;
  number: string;
  order_id: string;
  status: ReturnStatus;
  lines: { sku: string; quantity: number; refund_cents: number }[];
  refund_cents: number;
  reason: string;
  created_at: string;
}

export interface HistoryEntry {
  seq: number;
  type: string;
  at: string;
  data: unknown;
  digest: string;
}

export interface DayHours {
  weekday: number;
  open: boolean;
  opens: string | null;
  closes: string | null;
}

export interface Hours {
  store_id: string;
  timezone: string;
  local_today: string;
  days: DayHours[];
  upcoming: { effective_from: string; days: DayHours[] } | null;
}

export interface DayPlan {
  store_id: string;
  date: string;
  timezone: string;
  slots: Slot[];
}

interface ReviewEvent {
  seq: number;
  at: string;
  order_id: string;
  order_number: string;
  store_id: string;
  type: string;
}

export interface Review {
  window_start: string;
  window_end: string;
  events: ReviewEvent[];
}


