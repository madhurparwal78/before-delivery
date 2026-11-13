import type { AssetCode, PositionState } from '../shared/types.js';

export interface SettlementEventData {
  settlement_id: string;
  kind: 'draw' | 'withdrawal' | 'liquidation';
  asset: AssetCode;
  amount: string;
  statement_key: string;
}

export interface PositionEventData {
  from: PositionState | null;
  to: PositionState;
  health_factor: string | null;
  grace_ends_at: string | null;
}

export interface OutboxEvent {
  event_id: string;
  type: 'settlement.committed' | 'position.state_changed';
  position_id: string | null;
  sequence: number | null;
  occurred_at: string;
  data: SettlementEventData | PositionEventData;
}

export type EventData = SettlementEventData | PositionEventData;
