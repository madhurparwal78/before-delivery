// Same-origin JSON client. Every error body has the one shape {"error": "<code>"}.
import type { Mode, OrderStatus, Outcome, Plan, PlanState, Role, Side, MarketKind, MarketStatus } from "../shared/rules";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly errors: Record<string, string> = {},
  ) {
    super(code);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const response = await fetch(path, { method: init.method ?? (body ? "POST" : "GET"), headers, body, credentials: "same-origin" });
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({ error: "bad_response" }))) as T & { error?: string; errors?: Record<string, string> };
  if (!response.ok) throw new ApiError(response.status, data.error ?? "error", data.errors ?? {});
  return data;
}

export interface Venue {
  id: string;
  slug: string;
  name: string;
  time_zone: string;
}

export interface Me {
  id: string;
  username: string;
  display_name: string;
  email: string;
  roles: Role[];
  venue: Venue | null;
}

export interface Market {
  id: string;
  kind: MarketKind;
  symbol: string;
  title: string;
  status: MarketStatus;
  closes_at: string | null;
  outcome: Outcome | null;
  last_price: number | null;
  open_interest: number;
  taker_fee_bps: number;
  maker_fee_bps: number;
}

export interface Level {
  price: number;
  quantity: number;
  spot_quantity?: number;
  margin_quantity?: number;
}

export interface Book {
  market_id: string;
  sequence: number;
  last_price: number | null;
  bids: Level[];
  asks: Level[];
}

export interface Fill {
  id: string;
  order_id: string;
  market_id: string;
  mode: Mode | null;
  side: Side;
  outcome: Outcome | null;
  price: number;
  quantity: number;
  notional_cents: number;
  fee_cents: number;
  liquidity: "maker" | "taker";
  filled_at: string;
}

export interface Order {
  id: string;
  market_id: string;
  mode: Mode | null;
  side: Side;
  outcome: Outcome | null;
  price: number;
  quantity: number;
  filled_quantity: number;
  remaining_quantity: number;
  status: OrderStatus;
  hold_cents: number;
  taker_fee_bps: number;
  maker_fee_bps: number;
  created_at: string;
  fills: Fill[];
}

export interface Balance {
  available_cents: number;
  held_cents: number;
  collateral_cents: number;
  total_cents: number;
}

export interface Positions {
  spot: { market_id: string; quantity: number; reserved: number }[];
  margin: {
    id: string;
    market_id: string;
    side: "long" | "short";
    quantity: number;
    cost_cents: number;
    collateral_cents: number;
    status: "open" | "closed" | "liquidated";
    equity_cents: number;
    maintenance_cents: number;
  }[];
  event: { market_id: string; outcome: Outcome; quantity: number }[];
}

export interface Deposit {
  id: string;
  amount_cents: number;
  refunded_cents: number;
  status: "succeeded" | "declined";
  card_last4: string;
  killbill_payment_id: string | null;
  created_at: string;
}

export interface Billing {
  plan: Plan;
  effective_plan: Plan;
  state: PlanState;
  overdue_state: string;
  rate_per_second: number;
  pending_plan: Plan | null;
  pending_effective_date: string | null;
  provider: "ok" | "unavailable";
  invoices: {
    id: string;
    number: string;
    invoice_date: string;
    amount_cents: number;
    balance_cents: number;
    items: { description: string; amount_cents: number; start_date: string | null; end_date: string | null }[];
  }[];
}
