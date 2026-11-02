// Shapes of the API's JSON bodies, as published in the brief.

export type Role = "customer" | "fulfilment" | "support" | "owner";
export interface User { id: string; email: string; name: string; role: Role }

export interface Flavour {
  slug: string;
  name: string;
  can_price_cents: number;
  limited: boolean;
  subscribable: boolean;
  stock_left: number;
}

export type Cadence = "monthly" | "bimonthly";

export interface Cart {
  slots: ({ flavour: string; status: "held" } | null)[];
  count: number;
  province: string;
  subscribe: boolean;
  subscribe_eligible: boolean;
  cadence: Cadence;
  hold: { status: "active" | "expired" | "none"; expires_at: string | null };
  server_time: string;
}

export interface QuoteLine {
  flavour: string;
  quantity: number;
  unit_price_cents: number;
  goods_cents: number;
  discount_cents: number;
  deposit_cents: number;
}
export interface TaxLine { name: string; rate: string; cents: number }

export interface Quote {
  province: string;
  subscribe: boolean;
  lines: QuoteLine[];
  goods_cents: number;
  discount_cents: number;
  discounted_goods_cents: number;
  shipping_cents: number;
  deposit_cents: number;
  taxes: TaxLine[];
  total_cents: number;
  free_shipping: { threshold_cents: number; remaining_cents: number; progress_percent: number };
}

export interface Address {
  id: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  province: string;
  postal_code: string;
  is_default: boolean;
}

export interface Refund {
  id: string;
  status: "pending_provider" | "applied" | "rejected";
  amount_cents: number;
  reason: string;
  split: {
    lines: { flavour: string; goods_cents: number; deposit_cents: number }[];
    shipping_cents: number;
    taxes: { name: string; cents: number }[];
  };
  created_at: string;
}

export type OrderStatus = "pending_payment" | "paid" | "picking" | "packed" | "shipped" | "refunded";

export interface Order {
  number: string;
  status: OrderStatus;
  refund_status: "none" | "partially_refunded" | "refunded";
  placed_at: string;
  province: string;
  subscription_id: string | null;
  lines: QuoteLine[];
  goods_cents: number;
  discount_cents: number;
  discounted_goods_cents: number;
  shipping_cents: number;
  deposit_cents: number;
  taxes: TaxLine[];
  total_cents: number;
  refunded_cents: number;
  refundable_cents: number;
  ship_to: Omit<Address, "id" | "is_default">;
  refunds: Refund[];
  thank_you_url: string;
  invoice_url: string;
}

export interface Change {
  id: string;
  kind: "pause" | "resume" | "skip" | "swap" | "cancel";
  status: "pending_provider" | "applied" | "rejected";
  effective_date: string;
  requested_at: string;
}

export interface Subscription {
  id: string;
  plan: string;
  plan_label: string;
  cadence: Cadence;
  state: "active" | "paused" | "past_due" | "cancel_pending" | "cancelled";
  next_renewal_date: string;
  billing_end_date: string | null;
  pause: { from: string; resumes_on: string } | null;
  skip: { date: string } | null;
  change_cutoff: string;
  changes_apply_to: string;
  pending_change: Change | null;
  last_change: Change | null;
  dunning: {
    step: string;
    failed_at: string | null;
    next_retry_at: string | null;
    shipments_held: boolean;
    cancels_at: string | null;
  } | null;
  card: { brand: string; last4: string };
}

export type ServiceName = "killbill" | "postgres" | "pocketbase" | "minio" | "mailpit";
export type Services = Record<ServiceName, "up" | "down">;
