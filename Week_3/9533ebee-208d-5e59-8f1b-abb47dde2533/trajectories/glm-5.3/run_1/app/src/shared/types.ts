export type Role = 'risk_steward' | 'liquidity_provider' | 'borrower' | 'trader' | 'liquidator';

export type AssetCode = 'QUSD' | 'MBTC' | 'METH';

export type OracleStatus =
  | 'ok' | 'unreachable' | 'malformed' | 'old_round'
  | 'not_newer' | 'large_move' | 'evidence_unavailable';

export type MarketState = 'open' | 'stale_feed';

export type PositionState =
  | 'healthy' | 'warned' | 'liquidatable_grace' | 'liquidatable'
  | 'partially_liquidated' | 'closed';

export type SettlementKind = 'draw' | 'withdrawal' | 'liquidation';

export interface Leg {
  account: string;
  asset: AssetCode;
  amount: string;
}

export interface ProblemBody {
  type: string;
  status: number;
  code: string;
  detail: string;
  errors?: Record<string, string>;
}
