export type Role = 'broker' | 'beekeeper' | 'grower';
export type OrderStatus =
  | 'draft'
  | 'open'
  | 'filled'
  | 'placed'
  | 'inspected'
  | 'settled'
  | 'cancelled';
export type SettlementStatus = 'none' | 'queued' | 'settled';
export type DropStatus = 'committed' | 'delivered' | 'inspected' | 'disputed' | 'accepted';
export type InspectionLinkStatus = 'issued' | 'used' | 'signed' | 'expired';
export type Tier = 'none' | 'reduced' | 'standard' | 'bonus';

export const TIER_ORDER: readonly Tier[] = ['none', 'reduced', 'standard', 'bonus'];

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  filled: 'Filled',
  placed: 'Placed',
  inspected: 'Inspected',
  settled: 'Settled',
  cancelled: 'Cancelled',
};

const DROP_STATUS_LABELS: Record<DropStatus, string> = {
  committed: 'Committed',
  delivered: 'Delivered',
  inspected: 'Inspected',
  disputed: 'Disputed',
  accepted: 'Accepted',
};

const LINK_STATUS_LABELS: Record<InspectionLinkStatus, string> = {
  issued: 'Issued',
  used: 'Used',
  signed: 'Signed',
  expired: 'Expired',
};

const TIER_LABELS: Record<Tier, string> = {
  none: 'None',
  reduced: 'Reduced',
  standard: 'Standard',
  bonus: 'Bonus',
};

export const NOT_INSPECTED_LABEL = 'Not inspected';

/** The status label shown on screen; a queued settlement reads "Settlement queued". */
export function orderStatusLabel(status: OrderStatus, settlementStatus: SettlementStatus): string {
  if (settlementStatus === 'queued') return 'Settlement queued';
  if (settlementStatus === 'settled') return ORDER_STATUS_LABELS.settled;
  return ORDER_STATUS_LABELS[status];
}

export function dropStatusLabel(status: DropStatus): string {
  return DROP_STATUS_LABELS[status];
}

export function inspectionLinkStatusLabel(status: InspectionLinkStatus): string {
  return LINK_STATUS_LABELS[status];
}

export function tierLabel(tier: Tier | null): string {
  return tier === null ? NOT_INSPECTED_LABEL : TIER_LABELS[tier];
}
