export interface Actor {
  actor_id: string;
  name: string;
  email: string;
  role: Role;
}

export type Role = 'risk_steward' | 'liquidity_provider' | 'borrower' | 'trader' | 'liquidator';
export type AssetCode = 'QUSD' | 'MBTC' | 'METH';
export type PositionState = 'healthy' | 'warned' | 'liquidatable_grace' | 'liquidatable' | 'partially_liquidated' | 'closed';
export type OracleStatus = 'ok' | 'unreachable' | 'malformed' | 'old_round' | 'not_newer' | 'large_move' | 'evidence_unavailable';

export interface Notice {
  notice_id: string;
  kind: 'margin' | 'liquidation';
  status: 'queued' | 'sent';
  created_at: string;
  sent_at: string | null;
}

export interface Position {
  position_id: string;
  borrower_id: string;
  collateral_asset: AssetCode;
  debt_asset: AssetCode;
  collateral_amount: string;
  debt: string;
  health_factor: string | null;
  liquidation_price: string | null;
  state: PositionState;
  grace_ends_at: string | null;
  round: string;
  max_repay: string;
  notices: Notice[];
  created_at: string;
  server_time: string;
}

export interface Pool {
  asset: AssetCode;
  name: string;
  decimals: number;
  price: string;
  price_posted_at: string;
  price_age_seconds: number;
  price_source: 'manual' | 'oracle';
  oracle_round: string | null;
  oracle_status: OracleStatus;
  market_state: 'open' | 'stale_feed';
  available_liquidity: string;
  total_borrowed: string;
  utilization_bps: number;
  borrow_rate_bps: number;
  supply_rate_bps: number;
  borrow_index: string;
  supply_balance: string;
  reserve_balance: string;
  swap_balance: string;
  total_shares: string;
  share_price: string;
  params: {
    ltv_bps: number;
    liquidation_threshold_bps: number;
    liquidation_bonus_bps: number;
    reserve_factor_bps: number;
    close_factor_bps: number;
    swap_fee_bps: number;
    warning_health_factor: string;
  };
  curve: { base_bps: number; slope1_bps: number; kink_bps: number; slope2_bps: number };
}

export interface PoolsResponse {
  pools: Pool[];
  staleness_limit: string;
  grace_period: string;
  quote_lifetime: string;
  desk_time_zone: string;
  server_time: string;
}

export interface WalletResponse {
  actor_id: string;
  balances: Array<{ asset: AssetCode; amount: string }>;
  lp_holdings: Array<{ asset: AssetCode; shares: string; value: string }>;
  position_ids: string[];
}

export interface Settlement {
  settlement_id: string;
  kind: 'draw' | 'withdrawal' | 'liquidation';
  actor_id: string;
  position_id: string | null;
  asset: AssetCode;
  amount: string;
  legs: Array<{ account: string; asset: AssetCode; amount: string }>;
  statement_key: string;
  pdf_key: string;
  pdf_rendered_at: string | null;
  statement_status: 'stored' | 'pending_statement';
  event_id: string;
  webhook_status: 'queued' | 'delivered';
  notice_status?: 'queued' | 'sent';
  created_at: string;
  round?: string;
  repaid?: string;
  seized?: string;
  bonus_amount?: string;
  written_off?: string;
  health_factor_after?: string | null;
  state_after?: string;
  debt_after?: string;
  shares_burned?: string;
  share_price_after?: string;
  posting_id?: number;
}

export interface LedgerTotals {
  assets: Array<{ asset: AssetCode; debits: string; credits: string; net: string }>;
}

export interface Posting {
  posting_id: string;
  kind: string;
  ref: string | null;
  created_at: string;
  legs: Array<{ account: string; asset: AssetCode; amount: string }>;
}

export const ASSET_CODES: AssetCode[] = ['QUSD', 'MBTC', 'METH'];
export const ASSET_DECIMALS: Record<AssetCode, number> = { QUSD: 6, MBTC: 8, METH: 18 };
export const ROLE_LABELS: Record<Role, string> = {
  risk_steward: 'Risk steward',
  liquidity_provider: 'Liquidity provider',
  borrower: 'Borrower',
  trader: 'Trader',
  liquidator: 'Liquidator',
};
export const STATE_LABELS: Record<PositionState, string> = {
  healthy: 'Healthy',
  warned: 'Margin warning',
  liquidatable_grace: 'Liquidatable in grace',
  liquidatable: 'Liquidatable now',
  partially_liquidated: 'Partially liquidated',
  closed: 'Closed',
};
export const ASSET_NAMES: Record<AssetCode, string> = {
  QUSD: 'Quill Dollar',
  MBTC: 'Moor Bitcoin',
  METH: 'Moor Ether',
};
