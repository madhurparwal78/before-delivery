// Shapes of the API responses the browser renders. Every amount is an integer string of minor units.

export type Role = "risk_steward" | "liquidity_provider" | "borrower" | "trader" | "liquidator";

export interface Member {
  actor_id: string;
  name: string;
  email: string;
  role: Role;
}

export type OracleStatus = "ok" | "unreachable" | "malformed" | "old_round" | "not_newer" | "large_move" | "evidence_unavailable";

export interface Pool {
  asset: string;
  name: string;
  decimals: number;
  price: string;
  price_posted_at: string;
  price_age_seconds: number;
  price_source: "manual" | "oracle";
  oracle_round: number | null;
  oracle_status: OracleStatus;
  market_state: "open" | "stale_feed";
  available_liquidity: string;
  total_borrowed: string;
  utilization_bps: number;
  borrow_rate_bps: number;
  supply_rate_bps: number;
  share_price: string;
  params: { ltv_bps: number; liquidation_threshold_bps: number; liquidation_bonus_bps: number; reserve_factor_bps: number; warning_health_factor: string };
}

export interface PoolsResponse {
  pools: Pool[];
  staleness_limit: string;
  grace_period: string;
  quote_lifetime: string;
  desk_time_zone: string;
  server_time: string;
}

export type PositionState = "healthy" | "warned" | "liquidatable_grace" | "liquidatable" | "partially_liquidated" | "closed";

export interface Notice {
  notice_id: string;
  kind: "margin" | "liquidation";
  status: "queued" | "sent";
  created_at: string;
  sent_at: string | null;
}

export interface Position {
  position_id: string;
  borrower_id: string;
  collateral_asset: string;
  debt_asset: string;
  collateral_amount: string;
  debt: string;
  health_factor: string | null;
  liquidation_price: string | null;
  state: PositionState;
  grace_ends_at: string | null;
  round: number;
  max_repay: string;
  notices: Notice[];
}

export interface Leg {
  account: string;
  asset: string;
  amount: string;
}

export interface Settlement {
  settlement_id: string;
  kind: "draw" | "withdrawal" | "liquidation";
  actor_id: string;
  position_id: string | null;
  asset: string;
  amount: string;
  legs: Leg[];
  statement_key: string;
  statement_status: "stored" | "pending_statement";
  webhook_status: "queued" | "delivered";
  created_at: string;
  // draw
  debt_after?: string;
  health_factor_after?: string | null;
  state_after?: PositionState;
  // withdrawal
  shares_burned?: string;
  share_price_after?: string;
  // liquidation
  round?: number;
  repaid?: string;
  seized?: string;
  bonus_amount?: string;
  written_off?: string;
  health_factor_before?: string | null;
  price_collateral?: string;
  price_debt?: string;
  notice_status?: "queued" | "sent";
}

export interface Wallet {
  balances: { asset: string; amount: string }[];
  lp_holdings: { asset: string; shares: string; value: string }[];
  position_ids: string[];
}

export interface Quote {
  quote_id: string;
  from_asset: string;
  to_asset: string;
  amount_in: string;
  fee: string;
  amount_out: string;
  price_from: string;
  price_to: string;
  expires_at: string;
  server_time: string;
}

export interface Swap extends Omit<Quote, "expires_at" | "server_time"> {
  swap_id: string;
}

export const ROLE_LABEL: Record<Role, string> = {
  risk_steward: "Risk steward",
  liquidity_provider: "Liquidity provider",
  borrower: "Borrower",
  trader: "Trader",
  liquidator: "Liquidator",
};

export const STATE_LABEL: Record<PositionState, string> = {
  healthy: "Healthy",
  warned: "Margin warning",
  liquidatable_grace: "Liquidatable in grace",
  liquidatable: "Liquidatable now",
  partially_liquidated: "Partially liquidated",
  closed: "Closed",
};
