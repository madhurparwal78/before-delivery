/** The shapes the server publishes, as the browser reads them. */

import type { Asset } from '../domain/assets.ts';
import type { OracleStatus } from '../domain/oracle.ts';
import type { PositionState } from '../domain/position.ts';
import type { Role } from '../domain/roles.ts';

export interface MemberDto {
  readonly actor_id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
}

export interface PoolDto {
  readonly asset: Asset;
  readonly name: string;
  readonly decimals: number;
  readonly price: string;
  readonly price_posted_at: string;
  readonly price_age_seconds: number;
  readonly price_source: 'manual' | 'oracle';
  readonly oracle_round: number | null;
  readonly oracle_status: OracleStatus;
  readonly market_state: 'open' | 'stale_feed';
  readonly available_liquidity: string;
  readonly total_borrowed: string;
  readonly utilization_bps: number;
  readonly borrow_rate_bps: number;
  readonly supply_rate_bps: number;
  readonly borrow_index: string;
  readonly supply_balance: string;
  readonly reserve_balance: string;
  readonly swap_balance: string;
  readonly total_shares: string;
  readonly share_price: string;
  readonly params: {
    readonly ltv_bps: number;
    readonly liquidation_threshold_bps: number;
    readonly liquidation_bonus_bps: number;
    readonly reserve_factor_bps: number;
    readonly close_factor_bps: number;
    readonly swap_fee_bps: number;
    readonly warning_health_factor: string;
  };
  readonly curve: {
    readonly base_bps: number;
    readonly slope1_bps: number;
    readonly kink_bps: number;
    readonly slope2_bps: number;
  };
}

export interface PoolsDto {
  readonly pools: readonly PoolDto[];
  readonly staleness_limit: string;
  readonly grace_period: string;
  readonly quote_lifetime: string;
  readonly desk_time_zone: string;
  readonly server_time: string;
}

export interface NoticeDto {
  readonly notice_id: string;
  readonly kind: 'margin' | 'liquidation';
  readonly status: 'queued' | 'sent';
  readonly created_at: string;
  readonly sent_at: string | null;
}

export interface PositionDto {
  readonly position_id: string;
  readonly borrower_id: string;
  readonly collateral_asset: Asset;
  readonly debt_asset: Asset;
  readonly collateral_amount: string;
  readonly debt: string;
  readonly health_factor: string | null;
  readonly liquidation_price: string | null;
  readonly state: PositionState;
  readonly grace_ends_at: string | null;
  readonly round: number;
  readonly max_repay: string;
  readonly notices: readonly NoticeDto[];
  readonly created_at: string;
  readonly server_time: string;
}

export interface WalletDto {
  readonly actor_id: string;
  readonly balances: ReadonlyArray<{ readonly asset: Asset; readonly amount: string }>;
  readonly lp_holdings: ReadonlyArray<{
    readonly asset: Asset;
    readonly shares: string;
    readonly value: string;
  }>;
  readonly position_ids: readonly string[];
}

export interface LegDto {
  readonly account: string;
  readonly asset: Asset;
  readonly amount: string;
}

export interface SettlementDto {
  readonly settlement_id: string;
  readonly kind: 'draw' | 'withdrawal' | 'liquidation';
  readonly actor_id: string;
  readonly position_id: string | null;
  readonly asset: Asset;
  readonly amount: string;
  readonly legs: readonly LegDto[];
  readonly statement_key: string;
  readonly pdf_key: string;
  readonly pdf_rendered_at: string | null;
  readonly statement_status: 'stored' | 'pending_statement';
  readonly event_id: string;
  readonly webhook_status: 'queued' | 'delivered';
  readonly created_at: string;
  readonly debt_after?: string;
  readonly health_factor_after?: string | null;
  readonly state_after?: PositionState;
  readonly shares_burned?: string;
  readonly share_price_after?: string;
  readonly round?: number;
  readonly borrower_id?: string;
  readonly repaid?: string;
  readonly seized?: string;
  readonly bonus_amount?: string;
  readonly written_off?: string;
  readonly health_factor_before?: string | null;
  readonly price_collateral?: string;
  readonly price_debt?: string;
  readonly notice_status?: 'queued' | 'sent';
}

export interface QuoteDto {
  readonly quote_id: string;
  readonly from_asset: Asset;
  readonly to_asset: Asset;
  readonly amount_in: string;
  readonly fee: string;
  readonly fee_to_supply: string;
  readonly fee_to_reserve: string;
  readonly amount_out: string;
  readonly price_from: string;
  readonly price_to: string;
  readonly expires_at: string;
  readonly server_time: string;
}

export interface PreviewDto {
  readonly from_asset: Asset;
  readonly to_asset: Asset;
  readonly amount_in: string;
  readonly fee: string;
  readonly amount_out: string;
  readonly price_from: string;
  readonly price_to: string;
}

export interface SwapDto {
  readonly swap_id: string;
  readonly quote_id: string;
  readonly amount_in: string;
  readonly fee: string;
  readonly amount_out: string;
  readonly price_from: string;
  readonly price_to: string;
  readonly from_asset: Asset;
  readonly to_asset: Asset;
}

export interface RiskDto {
  readonly asset: Asset;
  readonly ltv_bps: number;
  readonly liquidation_threshold_bps: number;
  readonly liquidation_bonus_bps: number;
  readonly reserve_factor_bps: number;
  readonly positions_below_one?: number;
}

export interface SupplyDto {
  readonly supply_id: string;
  readonly asset: Asset;
  readonly amount: string;
  readonly shares_minted: string;
  readonly share_price: string;
}

export interface RepaymentDto {
  readonly repayment_id: string;
  readonly amount: string;
  readonly debt_after: string;
  readonly health_factor_after: string | null;
  readonly state_after: PositionState;
}

export interface PricePostDto {
  readonly price_post_id: string;
  readonly asset: Asset;
  readonly price: string;
  readonly previous_price: string;
  readonly posted_at: string;
  readonly source: 'manual';
  readonly positions_below_one: number;
  readonly evidence_key: string;
}

export interface LedgerTotalsDto {
  readonly assets: ReadonlyArray<{
    readonly asset: Asset;
    readonly debits: string;
    readonly credits: string;
    readonly net: string;
  }>;
}

export interface PostingDto {
  readonly posting_id: string;
  readonly kind: string;
  readonly ref: string | null;
  readonly created_at: string;
  readonly legs: readonly LegDto[];
}

export interface PostingsDto {
  readonly postings: readonly PostingDto[];
  readonly server_time: string;
}

export interface PositionsDto {
  readonly positions: readonly PositionDto[];
  readonly server_time: string;
}

export interface TransferDto {
  readonly transfer_id: string;
  readonly actor_id: string;
  readonly asset: Asset;
  readonly amount: string;
}
