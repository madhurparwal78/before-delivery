export type Role = 'trader' | 'builder' | 'market_admin' | 'org_owner' | 'founder_operator';
export const ROLES: readonly Role[] = ['trader', 'builder', 'market_admin', 'org_owner', 'founder_operator'];

export type MarketKind = 'pair' | 'event';
export type MarketStatus = 'listed' | 'trading' | 'halted' | 'closed' | 'resolved' | 'settled';
export type Outcome = 'yes' | 'no';
export type OrderMode = 'spot' | 'margin';
export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'resting' | 'partially_filled' | 'filled' | 'cancelled' | 'liquidated';
export type BookSide = 'bid' | 'ask';
export type Liquidity = 'maker' | 'taker';
export type PositionSide = 'long' | 'short';
export type Plan = 'sandbox' | 'builder' | 'desk';
export type BillingState = 'active' | 'payment_failed' | 'downgraded';

export interface Venue {
  id: string;
  slug: string;
  name: string;
  time_zone: string;
  taker_fee_bps: number;
  maker_fee_bps: number;
  flagship_symbol: string;
}

export interface Member {
  id: string;
  venue_id: string | null;
  keycloak_user_id: string;
  username: string;
  display_name: string;
  email: string;
  roles: Role[];
}

export interface MarketRow {
  id: string;
  venue_id: string;
  kind: MarketKind;
  symbol: string;
  title: string;
  status: MarketStatus;
  closes_at: Date | null;
  outcome: Outcome | null;
  last_price: number | null;
  book_sequence: number;
  resolved_at: Date | null;
  settled_at: Date | null;
}

export interface OrderRow {
  id: string;
  venue_id: string;
  market_id: string;
  member_id: string;
  mode: OrderMode | null;
  side: OrderSide;
  outcome: Outcome | null;
  price: number;
  quantity: number;
  filled_quantity: number;
  status: OrderStatus;
  hold_cents: number;
  reserved_units: number;
  taker_fee_bps: number;
  maker_fee_bps: number;
  book_side: BookSide;
  book_price: number;
  sequence: number;
  created_at: Date;
}

export interface FillRow {
  id: string;
  order_id: string;
  market_id: string;
  mode: OrderMode | null;
  side: OrderSide;
  outcome: Outcome | null;
  price: number;
  quantity: number;
  notional_cents: number;
  fee_cents: number;
  liquidity: Liquidity;
  filled_at: Date;
}

export interface Balance {
  available_cents: number;
  held_cents: number;
  collateral_cents: number;
  total_cents: number;
}

export interface MarginPositionRow {
  id: string;
  venue_id: string;
  member_id: string;
  market_id: string;
  side: PositionSide;
  quantity: number;
  cost_cents: number;
  collateral_cents: number;
  status: 'open' | 'closed' | 'liquidated';
}
